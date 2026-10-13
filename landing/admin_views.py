import functools
import bcrypt
from datetime import datetime

from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from .models import Admin, AdminLog, SupportTicket, SupportMessage, Auth


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

        # Python bcrypt handles $2b$ and $2y$ natively; normalize if needed
        try:
            return bcrypt.checkpw(p_bytes, h_bytes)
        except ValueError:
            if h_bytes.startswith(b'$2y$'):
                h_bytes = b'$2b$' + h_bytes[4:]
                return bcrypt.checkpw(p_bytes, h_bytes)
            return False
    except Exception:
        return False


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
                # Set isolated admin session state
                request.session['admin_id'] = admin.id
                request.session['admin_role'] = admin.role
                request.session['admin_name'] = admin.name
                request.session['admin_email'] = admin.email
                request.session.modified = True

                # Update last login timestamp
                try:
                    admin.last_login = timezone.now()
                    admin.save(update_fields=['last_login'])
                except Exception:
                    pass

                # Audit log
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
    tickets_total = SupportTicket.objects.count()
    tickets_open = SupportTicket.objects.filter(status='open').count()
    tickets_in_progress = SupportTicket.objects.filter(status='in_progress').count()
    tickets_resolved = SupportTicket.objects.filter(status='resolved').count()
    tickets_critical = SupportTicket.objects.filter(urgency='critical').count()
    users_total = Auth.objects.count()

    latest_tickets = SupportTicket.objects.select_related('user').order_by('-created_at')[:5]
    latest_users = Auth.objects.order_by('-created_at')[:5]

    context = {
        'admin_name': request.session.get('admin_name', 'Admin'),
        'admin_role': request.session.get('admin_role', 'admin'),
        'admin_email': request.session.get('admin_email', ''),
        'metrics': {
            'tickets_total': tickets_total,
            'tickets_open': tickets_open,
            'tickets_in_progress': tickets_in_progress,
            'tickets_resolved': tickets_resolved,
            'tickets_critical': tickets_critical,
            'users_total': users_total,
        },
        'latest_tickets': latest_tickets,
        'latest_users': latest_users,
    }
    return render(request, 'admin_portal/dashboard.html', context)


@admin_required
def api_admin_metrics(request):
    """
    GET /portal-admin/api/metrics/ -- Real-time JSON metrics endpoint for dashboard polling.
    """
    tickets_total = SupportTicket.objects.count()
    tickets_open = SupportTicket.objects.filter(status='open').count()
    tickets_in_progress = SupportTicket.objects.filter(status='in_progress').count()
    tickets_resolved = SupportTicket.objects.filter(status='resolved').count()
    tickets_critical = SupportTicket.objects.filter(urgency='critical').count()
    users_total = Auth.objects.count()

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
        'metrics': {
            'tickets_total': tickets_total,
            'tickets_open': tickets_open,
            'tickets_in_progress': tickets_in_progress,
            'tickets_resolved': tickets_resolved,
            'tickets_critical': tickets_critical,
            'users_total': users_total,
        },
        'latest_5_tickets': tickets_list,
        'latest_5_users': users_list,
        'timestamp': timezone.now().strftime('%H:%M:%S'),
    })
