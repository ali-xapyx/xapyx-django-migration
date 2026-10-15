import os
import functools
import bcrypt
from datetime import datetime

from django.db import connection
from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from .models import Admin, AdminLog, SupportTicket, SupportMessage, Auth
from .views import (
    _upload_to_s3,
    _notify,
    SUPPORT_S3_FOLDER,
    SUPPORT_MAX_MB,
    SUPPORT_ALLOWED_MIME,
    _support_media_type,
    _support_time_ago,
)


def admin_required(view_func):
    """Decorator to enforce admin authentication via session['admin_id']."""
    @functools.wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        if not request.session.get('admin_id'):
            if request.headers.get('x-requested-with') == 'XMLHttpRequest' or request.path.startswith('/portal-admin/api/'):
                return JsonResponse({'success': False, 'error': 'Authentication required'}, status=401)
            return redirect('/portal-admin/login/')
        return view_func(request, *args, **kwargs)
    return _wrapped_view


def _verify_admin_password(plain_password, password_hash):
    """
    Verifies plain password against bcrypt or Django hash in 'admins' or 'auth' table.
    Handles $2y$, $2b$, bcrypt$$2b$, and bcrypt_sha256$ seamlessly.
    """
    if not plain_password or not password_hash:
        return False
    try:
        norm = password_hash
        if norm.startswith('bcrypt$'):
            norm = norm[len('bcrypt$'):]
        if norm.startswith('$2y$'):
            norm = '$2b$' + norm[4:]
        if norm.startswith(('$2a$', '$2b$')):
            if bcrypt.checkpw(plain_password.encode('utf-8'), norm.encode('utf-8')):
                return True
        from django.contrib.auth.hashers import check_password as django_check_password
        return django_check_password(plain_password, password_hash)
    except Exception:
        return False


def _get_base_metrics():
    with connection.cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*),
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END),
                SUM(CASE WHEN urgency = 'critical' THEN 1 ELSE 0 END),
                SUM(CASE WHEN urgency = 'high' THEN 1 ELSE 0 END),
                SUM(CASE WHEN urgency = 'medium' THEN 1 ELSE 0 END),
                SUM(CASE WHEN urgency = 'low' THEN 1 ELSE 0 END)
            FROM support_tickets
        """)
        row = cur.fetchone() or (0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

        cur.execute("SELECT COUNT(*) FROM auth")
        u_row = cur.fetchone()
        users_total = u_row[0] if u_row else 0

    return {
        'tickets_total': int(row[0] or 0),
        'tickets_open': int(row[1] or 0),
        'tickets_in_progress': int(row[2] or 0),
        'tickets_pending': int(row[3] or 0),
        'tickets_resolved': int(row[4] or 0),
        'tickets_closed': int(row[5] or 0),
        'tickets_critical': int(row[6] or 0),
        'tickets_high': int(row[7] or 0),
        'tickets_medium': int(row[8] or 0),
        'tickets_low': int(row[9] or 0),
        'users_total': int(users_total or 0),
    }


@csrf_protect
def admin_login_view(request):
    """
    GET /portal-admin/ or /portal-admin/login/ -- Admin login form.
    POST /portal-admin/login/ -- Authenticate admin credentials and set session.
    """
    if request.session.get('admin_id'):
        return redirect('/portal-admin/dashboard/')

    error = None
    email = ''

    if request.method == 'POST':
        email = request.POST.get('email', '').strip()
        password = request.POST.get('password', '')

        if not email or not password:
            error = "Please provide both email and password."
        else:
            admin = Admin.objects.filter(email=email, status='active').first()
            if admin and _verify_admin_password(password, admin.password):
                request.session['admin_id'] = admin.id
                request.session['admin_role'] = admin.role
                request.session['admin_name'] = admin.name
                request.session['admin_email'] = admin.email
                request.session.modified = True

                try:
                    admin.last_login = timezone.now()
                    admin.save(update_fields=['last_login'])
                except Exception:
                    pass

                try:
                    ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR', ''))
                    if ip and ',' in ip:
                        ip = ip.split(',')[0].strip()
                    AdminLog.objects.create(
                        admin_id=admin.id,
                        admin_name=admin.name,
                        action='login',
                        details=f'Admin logged in from {ip}',
                        ip_address=ip[:45],
                        user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
                        page_url=request.build_absolute_uri()[:500],
                    )
                except Exception:
                    pass

                if request.headers.get('x-requested-with') == 'XMLHttpRequest':
                    return JsonResponse({'success': True, 'redirect': '/portal-admin/dashboard/'})
                return redirect('/portal-admin/dashboard/')
            else:
                error = "Invalid admin email or password."

        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
            return JsonResponse({'success': False, 'error': error}, status=400)

    return render(request, 'admin_portal/login.html', {
        'error': error,
        'email': email,
    })


def admin_logout(request):
    """
    GET/POST /portal-admin/logout/ -- Clear admin session keys without clobbering end-user session.
    """
    for key in ['admin_id', 'admin_role', 'admin_name', 'admin_email']:
        if key in request.session:
            del request.session[key]
    request.session.modified = True
    return redirect('/portal-admin/login/')


@admin_required
def admin_dashboard(request):
    """
    GET /portal-admin/dashboard/ -- Admin home dashboard with key metrics and tables.
    """
    metrics = _get_base_metrics()
    latest_tickets = SupportTicket.objects.select_related('user').order_by('-created_at')[:5]
    latest_users = Auth.objects.order_by('-created_at')[:5]

    context = {
        'active_page': 'dashboard',
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': metrics,
        'latest_tickets': latest_tickets,
        'latest_users': latest_users,
    }
    return render(request, 'admin_portal/dashboard.html', context)


@admin_required
def api_admin_metrics(request):
    """
    GET /portal-admin/api/metrics/ -- Real-time JSON metrics endpoint for dashboard polling.
    """
    metrics = _get_base_metrics()
    latest_tickets_qs = SupportTicket.objects.select_related('user').order_by('-created_at')[:5]
    latest_users_qs = Auth.objects.order_by('-created_at')[:5]

    tickets_list = []
    for t in latest_tickets_qs:
        user_display = t.user.name or t.user.username if t.user else (t.user_name or f"User #{t.user_id}")
        tickets_list.append({
            'id': t.id,
            'subject': t.subject,
            'type': t.type,
            'urgency': t.urgency,
            'status': t.status,
            'user_name': user_display,
            'user_email': t.user.email if t.user else (t.user_email or ''),
            'created_at': t.created_at.strftime('%Y-%m-%d %H:%M') if t.created_at else '',
        })

    users_list = []
    for u in latest_users_qs:
        users_list.append({
            'id': u.id,
            'name': u.name or u.username,
            'username': u.username,
            'email': u.email or '',
            'created_at': u.created_at.strftime('%Y-%m-%d %H:%M') if u.created_at else '',
        })

    return JsonResponse({
        'success': True,
        'metrics': metrics,
        'latest_5_tickets': tickets_list,
        'latest_5_users': users_list,
        'timestamp': timezone.now().strftime('%H:%M:%S'),
    })


@admin_required
def admin_support_view(request):
    """
    GET /portal-admin/support/ -- Admin Support Center (Phase 2).
    Matches /opt/bitnami/apache/htdocs/admin/model/support.php
    """
    metrics = _get_base_metrics()

    with connection.cursor() as cur:
        cur.execute("""
            SELECT
                st.id, st.user_id, st.type, st.subject, st.message,
                st.urgency, st.status, st.created_at, st.updated_at,
                st.last_message_at, st.firebase_id,
                COALESCE(a.name, st.user_name, a.username, 'Unknown User') AS resolved_user_name,
                COALESCE(a.email, st.user_email, '') AS resolved_user_email,
                COALESCE(a.username, '') AS resolved_username,
                (SELECT COUNT(*) FROM support_messages sm
                 WHERE sm.ticket_id = st.id
                   AND (sm.message_type = 'user' OR sm.sender_type = 'user')
                   AND sm.is_read = 0) AS calc_unread
            FROM support_tickets st
            LEFT JOIN auth a ON st.user_id = a.id
            ORDER BY COALESCE(st.last_message_at, st.updated_at, st.created_at) DESC
            LIMIT 100
        """)
        rows = cur.fetchall()

    recent_tickets = []
    for r in rows:
        ref_dt = r[9] or r[8] or r[7]
        recent_tickets.append({
            'id': r[0],
            'user_id': r[1],
            'type': r[2] or 'query',
            'subject': r[3] or 'No Subject',
            'message': r[4] or '',
            'urgency': r[5] or 'medium',
            'status': r[6] or 'open',
            'created_at': r[7],
            'last_message_at': r[9],
            'firebase_id': r[10] or f'ticket_{r[0]}',
            'user_name': r[11],
            'user_email': r[12],
            'user_username': r[13],
            'unread_count': int(r[14] or 0),
            'time_ago': _support_time_ago(ref_dt),
        })

    context = {
        'active_page': 'support',
        'admin_id': request.session.get('admin_id'),
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': metrics,
        'recent_tickets': recent_tickets,
    }
    return render(request, 'admin_portal/support.html', context)


@admin_required
def api_admin_support(request):
    """
    POST/GET /portal-admin/api/support/
    Unified AJAX controller matching PHP /admin/controller/support-sync.php actions:
      - get_all_tickets
      - get_ticket_details
      - get_ticket_messages
      - send_admin_message
      - update_ticket_status
      - mark_messages_read
      - upload_admin_media
    """
    action = (request.POST.get('action') or request.GET.get('action') or '').strip()
    admin_id = request.session.get('admin_id')
    admin_name = request.session.get('admin_name') or 'Support Team'

    if not action:
        return JsonResponse({'success': False, 'error': 'No action specified'}, status=400)

    try:
        if action == 'get_all_tickets':
            status_filter = (request.POST.get('status') or request.GET.get('status') or 'all').strip()
            priority_filter = (request.POST.get('priority') or request.GET.get('priority') or request.POST.get('urgency') or request.GET.get('urgency') or 'all').strip()
            search_q = (request.POST.get('search') or request.GET.get('search') or '').strip()
            try:
                limit = int(request.POST.get('limit') or request.GET.get('limit') or 100)
                offset = int(request.POST.get('offset') or request.GET.get('offset') or 0)
            except (TypeError, ValueError):
                limit, offset = 100, 0

            where_clauses = ["1=1"]
            params = []

            if status_filter and status_filter != 'all':
                if status_filter in ('critical', 'high', 'medium', 'low'):
                    where_clauses.append("st.urgency = %s")
                    params.append(status_filter)
                else:
                    where_clauses.append("st.status = %s")
                    params.append(status_filter)

            if priority_filter and priority_filter != 'all':
                if priority_filter in ('critical', 'high', 'medium', 'low'):
                    where_clauses.append("st.urgency = %s")
                    params.append(priority_filter)

            if search_q:
                where_clauses.append(
                    "(st.subject LIKE %s OR st.user_name LIKE %s OR a.name LIKE %s OR a.email LIKE %s OR a.username LIKE %s OR CAST(st.id AS CHAR) LIKE %s)"
                )
                like_val = f"%{search_q}%"
                params.extend([like_val, like_val, like_val, like_val, like_val, like_val])

            where_sql = " AND ".join(where_clauses)
            params.extend([limit, offset])

            with connection.cursor() as cur:
                cur.execute(f"""
                    SELECT
                        st.id, st.user_id, st.type, st.subject, st.message,
                        st.urgency, st.status, st.created_at, st.updated_at,
                        st.last_message_at, st.firebase_id,
                        COALESCE(a.name, st.user_name, a.username, 'Unknown User') AS user_name,
                        COALESCE(a.email, st.user_email, '') AS user_email,
                        COALESCE(a.username, '') AS user_username,
                        (SELECT COUNT(*) FROM support_messages sm
                         WHERE sm.ticket_id = st.id
                           AND (sm.message_type = 'user' OR sm.sender_type = 'user')
                           AND sm.is_read = 0) AS unread_count,
                        (SELECT sm2.message FROM support_messages sm2
                         WHERE sm2.ticket_id = st.id
                         ORDER BY sm2.created_at DESC LIMIT 1) AS last_msg
                    FROM support_tickets st
                    LEFT JOIN auth a ON st.user_id = a.id
                    WHERE {where_sql}
                    ORDER BY COALESCE(st.last_message_at, st.updated_at, st.created_at) DESC
                    LIMIT %s OFFSET %s
                """, params)
                rows = cur.fetchall()

            tickets = []
            for r in rows:
                ref_dt = r[9] or r[8] or r[7]
                tickets.append({
                    'id': r[0],
                    'user_id': r[1],
                    'type': r[2] or 'query',
                    'subject': r[3] or 'No Subject',
                    'message': r[4] or '',
                    'urgency': r[5] or 'medium',
                    'status': r[6] or 'open',
                    'created_at': r[7].strftime('%Y-%m-%d %H:%M:%S') if r[7] else '',
                    'updated_at': r[8].strftime('%Y-%m-%d %H:%M:%S') if r[8] else '',
                    'last_message_at': r[9].strftime('%Y-%m-%d %H:%M:%S') if r[9] else '',
                    'firebase_id': r[10] or f'ticket_{r[0]}',
                    'user_name': r[11] or 'Unknown User',
                    'user_email': r[12] or '',
                    'user_username': r[13] or '',
                    'unread_count': int(r[14] or 0),
                    'last_message': (r[15] or r[4] or '')[:100],
                    'time_ago': _support_time_ago(ref_dt),
                })

            return JsonResponse({
                'success': True,
                'tickets': tickets,
                'metrics': _get_base_metrics(),
            })

        elif action == 'get_ticket_details':
            ticket_id = int(request.POST.get('ticket_id') or request.GET.get('ticket_id') or 0)
            if not ticket_id:
                return JsonResponse({'success': False, 'error': 'Ticket ID required'}, status=400)

            with connection.cursor() as cur:
                cur.execute("""
                    SELECT
                        st.id, st.user_id, st.type, st.subject, st.message,
                        st.urgency, st.status, st.created_at, st.updated_at,
                        st.last_message_at, st.firebase_id,
                        COALESCE(a.name, st.user_name, a.username, 'Unknown User') AS user_name,
                        COALESCE(a.email, st.user_email, '') AS user_email,
                        COALESCE(a.username, '') AS user_username
                    FROM support_tickets st
                    LEFT JOIN auth a ON st.user_id = a.id
                    WHERE st.id = %s
                """, [ticket_id])
                r = cur.fetchone()

            if not r:
                return JsonResponse({'success': False, 'error': 'Ticket not found'}, status=404)

            ticket = {
                'id': r[0],
                'user_id': r[1],
                'type': r[2] or 'query',
                'subject': r[3] or 'No Subject',
                'message': r[4] or '',
                'urgency': r[5] or 'medium',
                'status': r[6] or 'open',
                'created_at': r[7].strftime('%Y-%m-%d %H:%M:%S') if r[7] else '',
                'updated_at': r[8].strftime('%Y-%m-%d %H:%M:%S') if r[8] else '',
                'last_message_at': r[9].strftime('%Y-%m-%d %H:%M:%S') if r[9] else '',
                'firebase_id': r[10] or f'ticket_{r[0]}',
                'user_name': r[11] or 'Unknown User',
                'user_email': r[12] or '',
                'user_username': r[13] or '',
            }
            return JsonResponse({'success': True, 'ticket': ticket})

        elif action == 'get_ticket_messages':
            ticket_id = int(request.POST.get('ticket_id') or request.GET.get('ticket_id') or 0)
            if not ticket_id:
                return JsonResponse({'success': False, 'error': 'Ticket ID required'}, status=400)

            with connection.cursor() as cur:
                cur.execute("""
                    SELECT
                        sm.id, sm.firebase_id, sm.ticket_id, sm.user_id, sm.admin_id,
                        sm.message, sm.media_url, sm.s3_key, sm.s3_url,
                        sm.file_name, sm.file_size, sm.message_type,
                        sm.is_read, sm.created_at, sm.sender_type, sm.sender_name,
                        a.name AS user_name,
                        ad.name AS admin_name
                    FROM support_messages sm
                    LEFT JOIN auth a ON sm.user_id = a.id
                    LEFT JOIN admins ad ON sm.admin_id = ad.id
                    WHERE sm.ticket_id = %s
                    ORDER BY sm.created_at ASC, sm.id ASC
                """, [ticket_id])
                rows = cur.fetchall()

                # Mark user messages as read
                cur.execute("""
                    UPDATE support_messages
                    SET is_read = 1
                    WHERE ticket_id = %s
                      AND (message_type = 'user' OR sender_type = 'user')
                      AND is_read = 0
                """, [ticket_id])

                cur.execute("""
                    UPDATE support_tickets
                    SET unread_count = 0
                    WHERE id = %s
                """, [ticket_id])

            messages = []
            for r in rows:
                raw_sender_type = r[14] or ''
                raw_msg_type = r[11] or 'text'
                is_admin_msg = (raw_sender_type == 'admin' or raw_msg_type == 'admin' or bool(r[4]))
                resolved_sender_type = 'admin' if is_admin_msg else 'user'
                if is_admin_msg:
                    resolved_sender_name = r[17] or r[15] or 'Support Team'
                else:
                    resolved_sender_name = r[16] or r[15] or 'User'

                media_url = r[6] or r[8] or ''
                if media_url and not media_url.startswith('http') and not media_url.startswith('/'):
                    media_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{media_url}'

                messages.append({
                    'id': r[0],
                    'firebase_id': r[1] or '',
                    'ticket_id': r[2],
                    'user_id': r[3],
                    'admin_id': r[4],
                    'message': r[5] or '',
                    'media_url': media_url,
                    's3_key': r[7] or '',
                    's3_url': r[8] or '',
                    'file_name': r[9] or '',
                    'file_size': int(r[10] or 0),
                    'message_type': raw_msg_type if raw_msg_type in ('image', 'video', 'file', 'text') else 'text',
                    'is_read': bool(r[12]),
                    'created_at': r[13].strftime('%Y-%m-%d %H:%M:%S') if r[13] else '',
                    'sender_type': resolved_sender_type,
                    'sender_name': resolved_sender_name,
                })

            return JsonResponse({'success': True, 'messages': messages})

        elif action == 'send_admin_message':
            ticket_id = int(request.POST.get('ticket_id') or 0)
            message = (request.POST.get('message') or '').strip()

            if not ticket_id:
                return JsonResponse({'success': False, 'error': 'Ticket ID required'}, status=400)
            if not message:
                return JsonResponse({'success': False, 'error': 'Message cannot be empty'}, status=400)

            with connection.cursor() as cur:
                cur.execute("SELECT id, user_id, subject, status FROM support_tickets WHERE id = %s", [ticket_id])
                t_row = cur.fetchone()
                if not t_row:
                    return JsonResponse({'success': False, 'error': 'Ticket not found'}, status=404)

                target_user_id = t_row[1]
                ticket_subject = t_row[2] or f'Ticket #{ticket_id}'
                current_status = t_row[3] or 'open'
                new_status = 'in_progress' if current_status == 'open' else current_status

                cur.execute("""
                    INSERT INTO support_messages
                        (ticket_id, user_id, admin_id, message, message_type, is_read, created_at, sender_type, sender_name)
                    VALUES (%s, %s, %s, %s, 'text', 0, NOW(), 'admin', %s)
                """, [ticket_id, target_user_id, admin_id, message, admin_name])
                message_id = cur.lastrowid

                cur.execute("""
                    UPDATE support_tickets
                    SET last_message_at = NOW(),
                        updated_at = NOW(),
                        status = %s
                    WHERE id = %s
                """, [new_status, ticket_id])

            # Send real-time notification to user
            if target_user_id:
                try:
                    _notify(
                        user_id=target_user_id,
                        notif_type='support_reply',
                        title='💬 Support Team Replied',
                        message=f'{ticket_subject}: {message[:80]}',
                        icon='headset',
                        link='/support/',
                    )
                except Exception:
                    pass

                try:
                    from landing.push_notifications import send_web_push
                    send_web_push(
                        user_id=target_user_id,
                        title='Support Team Replied',
                        body=f'{ticket_subject}: {message[:100]}',
                        url='/support/',
                        tag=f'support_{ticket_id}'
                    )
                except Exception:
                    pass

            return JsonResponse({
                'success': True,
                'message_id': message_id,
                'timestamp': timezone.now().strftime('%Y-%m-%d %H:%M:%S'),
                'admin_name': admin_name,
                'user_id': target_user_id,
                'new_status': new_status,
                'metrics': _get_base_metrics(),
            })

        elif action == 'update_ticket_status':
            ticket_id = int(request.POST.get('ticket_id') or 0)
            new_status = (request.POST.get('status') or '').strip()
            valid_statuses = {'open', 'in_progress', 'resolved', 'closed', 'pending'}

            if not ticket_id or new_status not in valid_statuses:
                return JsonResponse({'success': False, 'error': 'Invalid ticket ID or status'}, status=400)

            with connection.cursor() as cur:
                cur.execute("SELECT user_id, subject FROM support_tickets WHERE id = %s", [ticket_id])
                _t = cur.fetchone()
                cur.execute("""
                    UPDATE support_tickets
                    SET status = %s, updated_at = NOW()
                    WHERE id = %s
                """, [new_status, ticket_id])

            if _t and _t[0]:
                try:
                    from landing.push_notifications import send_web_push
                    send_web_push(
                        user_id=_t[0],
                        title='Support Ticket Updated',
                        body=f"Your ticket '{_t[1] or ticket_id}' status is now {new_status.replace('_', ' ').capitalize()}.",
                        url='/support/',
                        tag=f'support_{ticket_id}'
                    )
                except Exception:
                    pass

            return JsonResponse({
                'success': True,
                'message': 'Status updated successfully',
                'new_status': new_status,
                'metrics': _get_base_metrics(),
            })

        elif action in ('update_ticket_urgency', 'update_ticket_priority', 'update_ticket_criticality'):
            ticket_id = int(request.POST.get('ticket_id') or 0)
            new_urgency = (request.POST.get('urgency') or request.POST.get('priority') or request.POST.get('criticality') or '').strip().lower()
            valid_urgencies = {'low', 'medium', 'high', 'critical'}

            if not ticket_id or new_urgency not in valid_urgencies:
                return JsonResponse({'success': False, 'error': 'Invalid ticket ID or priority/urgency'}, status=400)

            with connection.cursor() as cur:
                cur.execute("""
                    UPDATE support_tickets
                    SET urgency = %s, updated_at = NOW()
                    WHERE id = %s
                """, [new_urgency, ticket_id])

            return JsonResponse({
                'success': True,
                'message': 'Priority updated successfully',
                'new_urgency': new_urgency,
                'metrics': _get_base_metrics(),
            })

        elif action == 'mark_messages_read':
            ticket_id = int(request.POST.get('ticket_id') or 0)
            if not ticket_id:
                return JsonResponse({'success': False, 'error': 'Ticket ID required'}, status=400)

            with connection.cursor() as cur:
                cur.execute("""
                    UPDATE support_messages
                    SET is_read = 1
                    WHERE ticket_id = %s
                      AND (message_type = 'user' OR sender_type = 'user')
                      AND is_read = 0
                """, [ticket_id])
                cur.execute("UPDATE support_tickets SET unread_count = 0 WHERE id = %s", [ticket_id])

            return JsonResponse({'success': True, 'message': 'Messages marked as read'})

        elif action == 'upload_admin_media':
            ticket_id = int(request.POST.get('ticket_id') or 0)
            caption = (request.POST.get('message') or '').strip()
            file = request.FILES.get('file')

            if not ticket_id:
                return JsonResponse({'success': False, 'error': 'Ticket ID required'}, status=400)
            if not file:
                return JsonResponse({'success': False, 'error': 'No file uploaded'}, status=400)
            if file.size > SUPPORT_MAX_MB * 1024 * 1024:
                return JsonResponse({'success': False, 'error': f'File too large (max {SUPPORT_MAX_MB}MB)'}, status=400)

            mime = file.content_type or 'application/octet-stream'
            if mime not in SUPPORT_ALLOWED_MIME:
                return JsonResponse({'success': False, 'error': f'File type not allowed: {mime}'}, status=400)

            key = _upload_to_s3(file, folder=SUPPORT_S3_FOLDER)
            if not key:
                return JsonResponse({'success': False, 'error': 'S3 upload failed'}, status=500)

            public_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{key}'
            media_type = _support_media_type(mime)

            with connection.cursor() as cur:
                cur.execute("SELECT user_id, subject, status FROM support_tickets WHERE id = %s", [ticket_id])
                t_row = cur.fetchone()
                if not t_row:
                    return JsonResponse({'success': False, 'error': 'Ticket not found'}, status=404)

                target_user_id = t_row[0]
                ticket_subject = t_row[1] or f'Ticket #{ticket_id}'
                current_status = t_row[2] or 'open'
                new_status = 'in_progress' if current_status == 'open' else current_status

                cur.execute("""
                    INSERT INTO support_messages
                        (ticket_id, user_id, admin_id, message, message_type,
                         media_url, s3_key, s3_url, file_name, file_size,
                         created_at, sender_type, sender_name, is_read)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 'admin', %s, 0)
                """, [
                    ticket_id, target_user_id, admin_id, caption, media_type,
                    public_url, key, public_url, file.name[:255], file.size,
                    admin_name
                ])
                message_id = cur.lastrowid

                cur.execute("""
                    UPDATE support_tickets
                    SET last_message_at = NOW(),
                        updated_at = NOW(),
                        status = %s
                    WHERE id = %s
                """, [new_status, ticket_id])

            if target_user_id:
                try:
                    _notify(
                        user_id=target_user_id,
                        notif_type='support_reply',
                        title='📎 Support Sent an Attachment',
                        message=f'{ticket_subject}: {caption or file.name}',
                        icon='headset',
                        link='/support/',
                    )
                except Exception:
                    pass

            return JsonResponse({
                'success': True,
                'message_id': message_id,
                'filename': os.path.basename(key),
                's3_key': key,
                'public_url': public_url,
                'original_name': file.name,
                'size': file.size,
                'type': media_type,
                'mime_type': mime,
                'new_status': new_status,
                'metrics': _get_base_metrics(),
            })

        else:
            return JsonResponse({'success': False, 'error': f'Invalid action: {action}'}, status=400)

    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


def _log_admin_action(request, action, details):
    """Helper to record an audit entry in admin_logs."""
    try:
        admin_id = request.session.get('admin_id') or 0
        admin_name = request.session.get('admin_name') or 'Admin'
        ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR', ''))
        if ip and ',' in ip:
            ip = ip.split(',')[0].strip()
        AdminLog.objects.create(
            admin_id=admin_id,
            admin_name=admin_name,
            action=action[:100],
            details=details,
            ip_address=(ip or '')[:45],
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
            page_url=request.build_absolute_uri()[:500],
        )
    except Exception:
        pass


@admin_required
def admin_users_view(request):
    """
    GET/POST /portal-admin/users/ -- Searchable User Directory & Role Management.
    """
    msg = None
    err = None

    if request.method == 'POST':
        action = request.POST.get('action', '')
        target_id = int(request.POST.get('user_id') or 0)
        if action == 'update_role' and target_id:
            new_role = request.POST.get('role', 'user').strip()
            if new_role in ('user', 'moderator', 'admin'):
                Auth.objects.filter(id=target_id).update(role=new_role)
                target_u = Auth.objects.filter(id=target_id).first()
                if target_u and target_u.email and new_role == 'admin':
                    # Also sync to 'admins' table so they can log into /portal-admin/login/ with their password
                    raw_pw = target_u.pass_org or ''
                    if raw_pw:
                        pw_hash = bcrypt.hashpw(raw_pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                    else:
                        pw_hash = target_u.password
                    with connection.cursor() as cur:
                        cur.execute("SELECT id FROM admins WHERE email = %s", [target_u.email])
                        adm_row = cur.fetchone()
                        if adm_row:
                            cur.execute("UPDATE admins SET status = 'active', role = 'admin', password = %s WHERE id = %s", [pw_hash, adm_row[0]])
                        elif pw_hash:
                            cur.execute(
                                "INSERT INTO admins (name, email, password, role, status, created_at) VALUES (%s, %s, %s, 'admin', 'active', NOW())",
                                [target_u.name or target_u.username, target_u.email, pw_hash]
                            )
                _log_admin_action(request, 'user_role_update', f'Updated user #{target_id} role to {new_role}')
                msg = f'User #{target_id} role updated to {new_role}.'
            else:
                err = 'Invalid role selected.'

    search_q = (request.GET.get('q') or '').strip()
    role_filter = (request.GET.get('role') or 'all').strip()
    try:
        page = max(1, int(request.GET.get('page') or 1))
    except (TypeError, ValueError):
        page = 1
    per_page = 25
    offset = (page - 1) * per_page

    where_clauses = ["1=1"]
    params = []
    if search_q:
        where_clauses.append("(u.name LIKE %s OR u.username LIKE %s OR u.email LIKE %s OR CAST(u.id AS CHAR) LIKE %s)")
        like_q = f"%{search_q}%"
        params.extend([like_q, like_q, like_q, like_q])
    if role_filter and role_filter != 'all':
        where_clauses.append("u.role = %s")
        params.append(role_filter)

    where_sql = " AND ".join(where_clauses)

    with connection.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM auth u WHERE {where_sql}", params)
        total_filtered = cur.fetchone()[0] or 0

        cur.execute(f"""
            SELECT
                u.id, u.name, u.username, u.email, u.picture, u.role,
                u.location, u.created_at, u.last_seen, u.auth_method,
                (SELECT COUNT(*) FROM support_tickets st WHERE st.user_id = u.id) AS ticket_count
            FROM auth u
            WHERE {where_sql}
            ORDER BY u.created_at DESC
            LIMIT %s OFFSET %s
        """, params + [per_page, offset])
        rows = cur.fetchall()

    users_list = []
    for r in rows:
        users_list.append({
            'id': r[0],
            'name': r[1] or r[2],
            'username': r[2],
            'email': r[3] or 'N/A',
            'picture': r[4] or '',
            'role': r[5] or 'user',
            'location': r[6] or '—',
            'created_at': r[7],
            'last_seen': r[8],
            'auth_method': r[9] or 'email',
            'ticket_count': r[10] or 0,
        })

    total_pages = max(1, (total_filtered + per_page - 1) // per_page)

    context = {
        'active_page': 'dashboard',
        'active_page': 'users',
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': _get_base_metrics(),
        'users_list': users_list,
        'search_q': search_q,
        'role_filter': role_filter,
        'page': page,
        'total_pages': total_pages,
        'total_filtered': total_filtered,
        'msg': msg,
        'err': err,
    }
    return render(request, 'admin_portal/users.html', context)


@admin_required
def admin_profile_settings_view(request):
    """
    GET/POST /portal-admin/profile/ and /portal-admin/settings/
    Matches /opt/bitnami/apache/htdocs/admin/model/profile.php + Admin Settings & Team Management.
    """
    admin_id = request.session.get('admin_id')
    admin_obj = Admin.objects.filter(id=admin_id).first()
    msg = None
    err = None

    if request.method == 'POST' and admin_obj:
        form_type = request.POST.get('form_type', '')

        if form_type == 'update_profile':
            new_name = (request.POST.get('name') or '').strip()
            new_email = (request.POST.get('email') or '').strip()
            if not new_name or not new_email:
                err = 'Name and email are required.'
            elif Admin.objects.filter(email=new_email).exclude(id=admin_obj.id).exists():
                err = 'That email address is already in use by another admin.'
            else:
                admin_obj.name = new_name
                admin_obj.email = new_email
                admin_obj.save(update_fields=['name', 'email'])
                request.session['admin_name'] = new_name
                request.session['admin_email'] = new_email
                request.session.modified = True
                _log_admin_action(request, 'profile_update', f'Admin updated profile ({new_name}, {new_email})')
                msg = 'Profile updated successfully.'

        elif form_type == 'change_password':
            curr_pw = request.POST.get('current_password') or ''
            new_pw = request.POST.get('new_password') or ''
            conf_pw = request.POST.get('confirm_password') or ''

            if not _verify_admin_password(curr_pw, admin_obj.password):
                err = 'Current password is incorrect.'
            elif len(new_pw) < 6:
                err = 'New password must be at least 6 characters.'
            elif new_pw != conf_pw:
                err = 'New password and confirmation do not match.'
            else:
                hashed = bcrypt.hashpw(new_pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                admin_obj.password = hashed
                admin_obj.save(update_fields=['password'])
                _log_admin_action(request, 'password_change', 'Admin changed their account password')
                msg = 'Password updated successfully.'

        elif form_type == 'create_admin':
            c_name = (request.POST.get('new_admin_name') or '').strip()
            c_email = (request.POST.get('new_admin_email') or '').strip()
            c_role = (request.POST.get('new_admin_role') or 'support').strip()
            c_pass = request.POST.get('new_admin_password') or ''

            if not c_name or not c_email or len(c_pass) < 6:
                err = 'Please provide name, email, and a password (min 6 chars).'
            elif Admin.objects.filter(email=c_email).exists():
                err = 'An admin with that email already exists.'
            else:
                hashed = bcrypt.hashpw(c_pass.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                with connection.cursor() as cur:
                    cur.execute("""
                        INSERT INTO admins (name, email, password, role, status, created_at)
                        VALUES (%s, %s, %s, %s, 'active', NOW())
                    """, [c_name, c_email, hashed, c_role])
                _log_admin_action(request, 'admin_create', f'Created new admin {c_name} ({c_email}) [{c_role}]')
                msg = f'Admin account for {c_name} created successfully.'

        elif form_type == 'toggle_admin_status':
            target_admin_id = int(request.POST.get('target_admin_id') or 0)
            if target_admin_id and target_admin_id != admin_obj.id:
                target_adm = Admin.objects.filter(id=target_admin_id).first()
                if target_adm:
                    new_st = 'inactive' if target_adm.status == 'active' else 'active'
                    target_adm.status = new_st
                    target_adm.save(update_fields=['status'])
                    _log_admin_action(request, 'admin_status_toggle', f'Set admin #{target_admin_id} ({target_adm.email}) to {new_st}')
                    msg = f'Admin {target_adm.name} status changed to {new_st}.'

    all_admins = Admin.objects.all().order_by('id')

    context = {
        'admin_obj': admin_obj,
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': _get_base_metrics(),
        'all_admins': all_admins,
        'is_settings_tab': 'settings' in request.path,
        'msg': msg,
        'err': err,
    }
    return render(request, 'admin_portal/profile_settings.html', context)


@admin_required
def admin_reports_view(request):
    """
    GET /portal-admin/reports/ -- Platform & Support Reports + CSV Export.
    """
    import csv
    from django.http import HttpResponse

    export_type = request.GET.get('export', '').strip()
    if export_type == 'tickets_csv':
        _log_admin_action(request, 'export_csv', 'Exported Support Tickets CSV report')
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="xapyx_support_tickets.csv"'
        writer = csv.writer(response)
        writer.writerow(['Ticket ID', 'Subject', 'User Name', 'User Email', 'Type', 'Urgency', 'Status', 'Created At'])
        for t in SupportTicket.objects.select_related('user').order_by('-created_at')[:1000]:
            u_name = t.user.name if t.user else (t.user_name or 'Unknown')
            u_email = t.user.email if t.user else (t.user_email or '')
            writer.writerow([t.id, t.subject, u_name, u_email, t.type, t.urgency, t.status, t.created_at])
        return response

    elif export_type == 'users_csv':
        _log_admin_action(request, 'export_csv', 'Exported Users Directory CSV report')
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="xapyx_users.csv"'
        writer = csv.writer(response)
        writer.writerow(['User ID', 'Name', 'Username', 'Email', 'Role', 'Location', 'Joined At'])
        for u in Auth.objects.order_by('-created_at')[:2000]:
            writer.writerow([u.id, u.name, u.username, u.email, u.role, u.location, u.created_at])
        return response

    metrics = _get_base_metrics()
    report_stats = {
        'users_7d': 0,
        'users_30d': 0,
        'posts_total': 0,
        'groups_total': 0,
        'pages_total': 0,
        'messages_total': 0,
        'urgency_critical': metrics['tickets_critical'],
        'urgency_high': 0,
        'urgency_medium': 0,
        'urgency_low': 0,
    }

    with connection.cursor() as cur:
        try:
            cur.execute("SELECT COUNT(*) FROM auth WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)")
            report_stats['users_7d'] = cur.fetchone()[0] or 0
            cur.execute("SELECT COUNT(*) FROM auth WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)")
            report_stats['users_30d'] = cur.fetchone()[0] or 0
        except Exception:
            pass

        for tbl, key in [('space_posts', 'posts_total'), ('groups', 'groups_total'), ('pages', 'pages_total'), ('support_messages', 'messages_total')]:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {tbl}")
                report_stats[key] = cur.fetchone()[0] or 0
            except Exception:
                pass

        try:
            cur.execute("SELECT urgency, COUNT(*) FROM support_tickets GROUP BY urgency")
            for urg, cnt in cur.fetchall():
                u_key = f"urgency_{(urg or 'medium').lower()}"
                if u_key in report_stats:
                    report_stats[u_key] = cnt
        except Exception:
            pass

    context = {
        'active_page': 'dashboard',
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': metrics,
        'report': report_stats,
    }
    return render(request, 'admin_portal/reports.html', context)


@admin_required
def admin_logs_view(request):
    """
    GET /portal-admin/logs/ -- Audit Trail from 'admin_logs' table.
    """
    search_q = (request.GET.get('q') or '').strip()
    action_filter = (request.GET.get('action_type') or 'all').strip()

    logs_qs = AdminLog.objects.all()
    if action_filter and action_filter != 'all':
        logs_qs = logs_qs.filter(action=action_filter)
    if search_q:
        from django.db.models import Q
        logs_qs = logs_qs.filter(
            Q(admin_name__icontains=search_q) |
            Q(details__icontains=search_q) |
            Q(ip_address__icontains=search_q) |
            Q(action__icontains=search_q)
        )

    logs_list = logs_qs.order_by('-created_at', '-id')[:150]

    with connection.cursor() as cur:
        cur.execute("SELECT DISTINCT action FROM admin_logs WHERE action IS NOT NULL ORDER BY action")
        distinct_actions = [r[0] for r in cur.fetchall() if r[0]]

    context = {
        'active_page': 'dashboard',
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': _get_base_metrics(),
        'logs_list': logs_list,
        'distinct_actions': distinct_actions,
        'search_q': search_q,
        'action_filter': action_filter,
    }
    return render(request, 'admin_portal/logs.html', context)


def _store_image_url(key):
    if not key:
        return '/static/images/products/product.jpg'
    key = str(key).strip()
    if key.startswith('http://') or key.startswith('https://') or key.startswith('/static/'):
        return key
    clean = key if key.startswith('uploads/') else f'uploads/store/{key}'
    return f"https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{clean}"


DEFAULT_STORE_CATEGORIES = ['Electronics', 'Sports', 'Books', 'Fashion', 'Home', 'Vehicles']


@admin_required
def admin_store_view(request):
    """
    GET/POST /portal-admin/store/ -- Store & Marketplace moderation, inventory review, and category management.
    """
    msg = None
    err = None

    # Handle POST Actions (approve, reject, delete, add_category, delete_category)
    if request.method == 'POST':
        action = (request.POST.get('action') or '').strip()

        if action == 'approve':
            product_id = request.POST.get('product_id')
            if product_id:
                with connection.cursor() as cur:
                    cur.execute("UPDATE products SET status = 'approved', updated_at = NOW() WHERE id = %s", [product_id])
                _log_admin_action(request, 'store_product_approve', f"Approved product #{product_id}")
                msg = f"Product #{product_id} approved successfully."
            else:
                err = "Product ID is required."

        elif action == 'reject':
            product_id = request.POST.get('product_id')
            if product_id:
                with connection.cursor() as cur:
                    cur.execute("UPDATE products SET status = 'rejected', updated_at = NOW() WHERE id = %s", [product_id])
                _log_admin_action(request, 'store_product_reject', f"Rejected product #{product_id}")
                msg = f"Product #{product_id} has been marked as rejected."
            else:
                err = "Product ID is required."

        elif action == 'delete':
            product_id = request.POST.get('product_id')
            if product_id:
                with connection.cursor() as cur:
                    cur.execute("DELETE FROM products WHERE id = %s", [product_id])
                _log_admin_action(request, 'store_product_delete', f"Deleted product #{product_id}")
                msg = f"Product #{product_id} deleted permanently."
            else:
                err = "Product ID is required."

        elif action == 'add_category':
            cat_name = (request.POST.get('category_name') or request.POST.get('name') or '').strip()
            if cat_name:
                with connection.cursor() as cur:
                    cur.execute("SELECT id FROM product_categories WHERE LOWER(name) = LOWER(%s)", [cat_name])
                    if cur.fetchone():
                        err = f"Category '{cat_name}' already exists."
                    else:
                        cat_img = '/static/images/products/product.jpg'
                        if 'category_image' in request.FILES:
                            file = request.FILES['category_image']
                            key = _upload_to_s3(file, folder='uploads/store/categories')
                            if key:
                                cat_img = key
                        cur.execute("INSERT INTO product_categories (name, image) VALUES (%s, %s)", [cat_name, cat_img])
                        _log_admin_action(request, 'store_category_add', f"Added category '{cat_name}'")
                        msg = f"Category '{cat_name}' added successfully."
            else:
                err = "Category name cannot be empty."

        elif action == 'delete_category':
            cat_id = request.POST.get('category_id')
            if cat_id:
                with connection.cursor() as cur:
                    cur.execute("DELETE FROM product_categories WHERE id = %s", [cat_id])
                _log_admin_action(request, 'store_category_delete', f"Deleted category #{cat_id}")
                msg = f"Category #{cat_id} deleted."
            else:
                err = "Category ID is required."

        else:
            err = f"Unknown action: {action}"

        if request.headers.get('x-requested-with') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', ''):
            return JsonResponse({'success': True if not err else False, 'message': msg, 'error': err})

    # Filters & Pagination
    search_q = (request.GET.get('q') or '').strip()
    status_filter = (request.GET.get('status') or 'all').strip()
    category_filter = (request.GET.get('category') or 'all').strip()

    try:
        page = max(1, int(request.GET.get('page') or 1))
    except (TypeError, ValueError):
        page = 1
    per_page = 20
    offset = (page - 1) * per_page

    where_clauses = ["1=1"]
    params = []

    if search_q:
        where_clauses.append("(p.title LIKE %s OR p.desc LIKE %s OR p.location LIKE %s OR a.username LIKE %s OR CAST(p.id AS CHAR) LIKE %s OR p.ad_id LIKE %s)")
        like_q = f"%{search_q}%"
        params.extend([like_q, like_q, like_q, like_q, like_q, like_q])

    if status_filter and status_filter != 'all':
        if status_filter == 'sold':
            where_clauses.append("p.title LIKE %s")
            params.append('[SOLD]%')
        else:
            where_clauses.append("p.status = %s")
            params.append(status_filter)

    if category_filter and category_filter != 'all':
        where_clauses.append("p.category = %s")
        params.append(category_filter)

    where_sql = " AND ".join(where_clauses)

    with connection.cursor() as cur:
        # Pre-seed categories if empty
        cur.execute("SELECT COUNT(*) FROM product_categories")
        cat_count_row = cur.fetchone()
        if not cat_count_row or cat_count_row[0] == 0:
            for def_cat in DEFAULT_STORE_CATEGORIES:
                cur.execute("INSERT IGNORE INTO product_categories (name, image) VALUES (%s, %s)",
                            [def_cat, '/static/images/products/product.jpg'])

        # Aggregate counts
        cur.execute("SELECT COUNT(*) FROM products")
        products_count = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM product_categories")
        categories_count = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM products WHERE status = 'pending'")
        pending_count = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM products WHERE status = 'approved'")
        approved_count = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM products WHERE status = 'rejected'")
        rejected_count = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM products WHERE title LIKE '[SOLD]%'")
        sold_count = cur.fetchone()[0] or 0

        # Filtered total
        cur.execute(f"""
            SELECT COUNT(*)
            FROM products p
            LEFT JOIN auth a ON p.user_id = a.id
            WHERE {where_sql}
        """, params)
        total_filtered = cur.fetchone()[0] or 0

        # Paginated product list
        cur.execute(f"""
            SELECT p.id, p.ad_id, p.title, p.price, p.location, p.category, p.status, p.image,
                   p.created_at, p.updated_at, p.user_id, a.username, a.name AS user_name, a.picture AS user_picture
            FROM products p
            LEFT JOIN auth a ON p.user_id = a.id
            WHERE {where_sql}
            ORDER BY (p.status = 'pending') DESC, p.created_at DESC
            LIMIT %s OFFSET %s
        """, params + [per_page, offset])

        products_list = []
        for r in cur.fetchall():
            raw_images = [img.strip() for img in (r[7] or '').split(',') if img.strip()]
            first_img = _store_image_url(raw_images[0] if raw_images else '')

            raw_pic = r[13]
            if raw_pic:
                user_pic = raw_pic if (raw_pic.startswith('http') or raw_pic.startswith('/')) else f"https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{raw_pic}"
            else:
                user_pic = '/static/images/avatars/default.png'

            t_val = r[2] or ''
            is_sold = t_val.startswith('[SOLD] ')
            c_title = t_val[7:] if is_sold else t_val

            products_list.append({
                'id': r[0],
                'ad_id': r[1],
                'title': c_title,
                'full_title': t_val,
                'is_sold': is_sold,
                'price': float(r[3] or 0),
                'location': r[4] or 'Unspecified',
                'category': r[5] or 'General',
                'status': r[6] or 'pending',
                'first_image': first_img,
                'created_at': r[8],
                'updated_at': r[9],
                'user_id': r[10],
                'username': r[11] or f'user_{r[10]}',
                'user_name': r[12] or r[11] or 'Unknown',
                'user_picture': user_pic,
            })

        # Category list with product count
        cur.execute("""
            SELECT pc.id, pc.name, pc.image,
                   (SELECT COUNT(*) FROM products p WHERE p.category = pc.name) AS product_count
            FROM product_categories pc
            ORDER BY pc.name ASC
        """)
        categories_list = []
        for crow in cur.fetchall():
            c_img = crow[2]
            if c_img and not (c_img.startswith('http') or c_img.startswith('/')):
                c_img = _store_image_url(c_img)
            categories_list.append({
                'id': crow[0],
                'name': crow[1],
                'image': c_img or '/static/images/products/product.jpg',
                'product_count': crow[3] or 0
            })

    total_pages = max(1, (total_filtered + per_page - 1) // per_page)
    has_next = page < total_pages
    has_prev = page > 1

    # Fetch store audit logs
    with connection.cursor() as cur:
        cur.execute("""
            SELECT id, admin_id, admin_name, action, details, ip_address, created_at
            FROM admin_logs
            WHERE action LIKE 'store_product_%' OR action LIKE 'store_category_%'
            ORDER BY created_at DESC LIMIT 50
        """)
        store_audit_logs = []
        for arow in cur.fetchall():
            store_audit_logs.append({
                'id': arow[0],
                'admin_id': arow[1],
                'admin_name': arow[2] or 'System',
                'action': arow[3],
                'details': arow[4] or '',
                'ip_address': arow[5] or '',
                'created_at': arow[6],
            })

    context = {
        'active_page': 'dashboard',
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': _get_base_metrics(),
        'products_count': products_count,
        'categories_count': categories_count,
        'pending_count': pending_count,
        'approved_count': approved_count,
        'rejected_count': rejected_count,
        'sold_count': sold_count,
        'store_audit_logs': store_audit_logs,
        'products_list': products_list,
        'categories_list': categories_list,
        'total_filtered': total_filtered,
        'page': page,
        'total_pages': total_pages,
        'has_next': has_next,
        'has_prev': has_prev,
        'search_q': search_q,
        'status_filter': status_filter,
        'category_filter': category_filter,
        'msg': msg,
        'err': err,
    }
    return render(request, 'admin_portal/store.html', context)


@admin_required
def admin_store_approve_view(request, product_id):
    if request.method == 'POST':
        with connection.cursor() as cur:
            cur.execute("UPDATE products SET status = 'approved', updated_at = NOW() WHERE id = %s", [product_id])
        _log_admin_action(request, 'store_product_approve', f"Approved product #{product_id}")
        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
            return JsonResponse({'success': True, 'message': f"Product #{product_id} approved."})
    return redirect('/portal-admin/store/')


@admin_required
def admin_store_reject_view(request, product_id):
    if request.method == 'POST':
        with connection.cursor() as cur:
            cur.execute("UPDATE products SET status = 'rejected', updated_at = NOW() WHERE id = %s", [product_id])
        _log_admin_action(request, 'store_product_reject', f"Rejected product #{product_id}")
        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
            return JsonResponse({'success': True, 'message': f"Product #{product_id} rejected."})
    return redirect('/portal-admin/store/')


@admin_required
def admin_store_delete_view(request, product_id):
    if request.method == 'POST':
        with connection.cursor() as cur:
            cur.execute("DELETE FROM products WHERE id = %s", [product_id])
        _log_admin_action(request, 'store_product_delete', f"Deleted product #{product_id}")
        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
            return JsonResponse({'success': True, 'message': f"Product #{product_id} deleted."})
    return redirect('/portal-admin/store/')


# Backward-compatible alias
admin_store_placeholder_view = admin_store_view

