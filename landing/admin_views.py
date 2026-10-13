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
    Verifies plain password against bcrypt hash from MariaDB 'admins' table.
    Handles standard bcrypt and legacy PHP $2y$ prefix.
    """
    if not plain_password or not password_hash:
        return False
    try:
        p_bytes = plain_password.encode('utf-8')
        h_bytes = password_hash.encode('utf-8')

        try:
            return bcrypt.checkpw(p_bytes, h_bytes)
        except ValueError:
            if h_bytes.startswith(b'$2y$'):
                h_bytes = b'$2b$' + h_bytes[4:]
                return bcrypt.checkpw(p_bytes, h_bytes)
            return False
    except Exception:
        return False


def _get_base_metrics():
    tickets_total = SupportTicket.objects.count()
    tickets_open = SupportTicket.objects.filter(status='open').count()
    tickets_in_progress = SupportTicket.objects.filter(status='in_progress').count()
    tickets_pending = SupportTicket.objects.filter(status='pending').count()
    tickets_resolved = SupportTicket.objects.filter(status='resolved').count()
    tickets_closed = SupportTicket.objects.filter(status='closed').count()
    tickets_critical = SupportTicket.objects.filter(urgency='critical').count()
    users_total = Auth.objects.count()
    return {
        'tickets_total': tickets_total,
        'tickets_open': tickets_open,
        'tickets_in_progress': tickets_in_progress,
        'tickets_pending': tickets_pending,
        'tickets_resolved': tickets_resolved,
        'tickets_closed': tickets_closed,
        'tickets_critical': tickets_critical,
        'users_total': users_total,
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
            search_q = (request.POST.get('search') or request.GET.get('search') or '').strip()
            try:
                limit = int(request.POST.get('limit') or request.GET.get('limit') or 100)
                offset = int(request.POST.get('offset') or request.GET.get('offset') or 0)
            except (TypeError, ValueError):
                limit, offset = 100, 0

            where_clauses = ["1=1"]
            params = []

            if status_filter and status_filter != 'all':
                if status_filter == 'critical':
                    where_clauses.append("st.urgency = %s")
                    params.append('critical')
                else:
                    where_clauses.append("st.status = %s")
                    params.append(status_filter)

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
                cur.execute("""
                    UPDATE support_tickets
                    SET status = %s, updated_at = NOW()
                    WHERE id = %s
                """, [new_status, ticket_id])

            return JsonResponse({
                'success': True,
                'message': 'Status updated successfully',
                'new_status': new_status,
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
