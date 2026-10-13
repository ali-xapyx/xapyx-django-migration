#landing/views.py
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.views.decorators.vary import vary_on_cookie
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import render, redirect
from django.utils import timezone
from django.utils.html import escape as _esc
from django.http import JsonResponse
from django.http import HttpResponse
from django.conf import settings
from django.db.models import Q
from .models import Auth, Shout
from django.db import connection
import re
import os
import uuid
import json
import mimetypes


def _upload_to_s3(file_obj, folder='uploads/space_posts'):
    """
    Upload a Django UploadedFile to S3.
    Returns the S3 key (relative path stored in DB), or None on failure.
    """
    import logging
    log = logging.getLogger(__name__)

    try:
        import boto3
    except ImportError:
        log.error('_upload_to_s3: boto3 not installed')
        return None

    bucket = os.environ.get('AWS_STORAGE_BUCKET_NAME', 'xapyx.com-media')
    region = os.environ.get('AWS_S3_REGION_NAME', 'eu-west-1')
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    if not access_key or not secret_key:
        log.error('_upload_to_s3: AWS credentials missing')
        return None

    orig_name = file_obj.name or 'file'
    ext = os.path.splitext(orig_name)[1].lower() or ''
    key = f'{folder}/{uuid.uuid4().hex}{ext}'
    mime = file_obj.content_type or mimetypes.guess_type(orig_name)[0] or 'application/octet-stream'

    try:
        s3 = boto3.client(
            's3',
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        s3.upload_fileobj(file_obj, bucket, key, ExtraArgs={'ContentType': mime})
        return key
    except Exception as e:
        log.error(f'_upload_to_s3 failed: bucket={bucket} key={key} error={e}')
        return None

def _delete_from_s3(keys):
    """Delete one or more S3 keys. Returns count of successful deletes."""
    if not keys:
        return 0
    import logging
    log = logging.getLogger(__name__)
    try:
        import boto3
    except ImportError:
        log.error('_delete_from_s3: boto3 not installed')
        return 0

    bucket = os.environ.get('AWS_STORAGE_BUCKET_NAME', 'xapyx.com-media')
    region = os.environ.get('AWS_S3_REGION_NAME', 'eu-west-1')
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    if not access_key or not secret_key:
        log.error('_delete_from_s3: AWS credentials missing')
        return 0

    try:
        s3 = boto3.client(
            's3',
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        deleted = 0
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            resp = s3.delete_objects(
                Bucket=bucket,
                Delete={'Objects': [{'Key': k} for k in batch]},
            )
            deleted += len(resp.get('Deleted', []))
        return deleted
    except Exception as e:
        log.error(f'_delete_from_s3 failed: {e}')
        return 0


@login_required
@require_POST
def api_upload_presign(request):
    """
    POST /api/upload/presign/
    Generate a presigned PUT URL for direct browser -> S3 upload.
    Accepts JSON: { "purpose": "post"|"profile"|"support", "filename": "abc.jpg", "content_type": "image/jpeg" }
    """
    import boto3
    import json as _json

    ALLOWED_CONTENT_TYPES = {
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'video/mp4',
    }

    FOLDER_MAP = {
        'post': 'uploads/space_posts',
        'profile': 'uploads',
        'support': 'uploads/support',
    }

    try:
        body = _json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        return JsonResponse({'success': False, 'error': 'Invalid JSON body'}, status=400)

    purpose = (body.get('purpose') or 'post').strip().lower()
    filename = (body.get('filename') or 'file').strip()
    content_type = (body.get('content_type') or '').strip().lower()

    if content_type not in ALLOWED_CONTENT_TYPES:
        return JsonResponse({'success': False, 'error': f'Content-Type {content_type} not allowed'}, status=400)

    folder = FOLDER_MAP.get(purpose, 'uploads/space_posts')

    bucket = os.environ.get('AWS_STORAGE_BUCKET_NAME', 'xapyx.com-media')
    region = os.environ.get('AWS_S3_REGION_NAME', 'eu-west-1')
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    if not access_key or not secret_key:
        return JsonResponse({'success': False, 'error': 'AWS credentials missing'}, status=500)

    ext = os.path.splitext(filename)[1].lower() or ''
    key = f'{folder}/{uuid.uuid4().hex}{ext}'

    try:
        s3 = boto3.client(
            's3',
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        upload_url = s3.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': bucket,
                'Key': key,
                'ContentType': content_type,
            },
            ExpiresIn=300,
        )
        public_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{key}'
        needs_variants = bool(content_type.startswith('image/'))
        return JsonResponse({
            'success': True,
            'upload_url': upload_url,
            'key': key,
            'public_url': public_url,
            'needs_variants': needs_variants,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to generate presigned URL: {e}'}, status=500)


def _classify_media(mime):
  if not mime:
    return "file"
  if mime.startswith('image/'):
    return "image"
  if mime.startswith('video/'):
    return "video"
  return "file"


def _time_ago(dt):
  """Mirror of PHP timeAgo() — returns '3h ago' style strings."""
  from datetime import datetime
  if not dt:
    return "Unknown"
  if isinstance(dt, str):
    try:
      dt = datetime.strptime(dt, '%Y-%m-%d %H:%M:%S')
    except:
      Exception
  diff = int((datetime.now() - dt).total_seconds())
  if diff < 0:
    diff = 0
  if diff < 60:
    return "Just now"
  if diff < 3600:
    return f'{diff // 60}m ago'
  if diff < 86400:
    return f'{diff // 3600}h ago'
  if diff < 604800:
    return f'{diff // 86400}d ago'
  if diff < 2592000:
    return f'{diff // 604800}w ago'
  if diff < 31536000:
    return f'{diff // 2592000}mo ago'
  return f'{diff // 31536000}y ago'


def _media_url(path):
  """Minimal PHP getMediaUrl() equivalent — S3 + assets fallback."""
  if not path:
    return "/assets/xapyx_logo.png"
  if path.startswith('http://') or path.startswith('https://'):
    return path
  if path.startswith('assets/'):
    return "/" + path
  # uploads/ or profile_* → S3 bucket
  clean = path if path.startswith('uploads/') else 'uploads/' + path
  return "https://s3.eu-west-1.amazonaws.com/xapyx.com-media/" + clean


def _render_content(text):
  """HTML-escape then nl2br — mirrors PHP nl2br(htmlspecialchars(...))."""
  if not text:
    return ""
  return _esc(text).replace('\n', '<br />')


def _format_user_post(row, user_id):
  """
    Python port of PHP formatUserPostData().
    `row` is a dict from a DictCursor-style query.
    """
  post_id = row['id']
  media = []
  poll = None
  with connection.cursor() as cur:
        # Media
        cur.execute(
            "SELECT media_url, media_type, mime_type FROM space_media "
            "WHERE post_id = %s ORDER BY id ASC",
            [post_id]
        )
        for m in cur.fetchall():
            media.append({
                'url': _media_url(m[0]),
                'type': m[1],
                'mime_type': m[2],
            })

        # Poll
        cur.execute(
            "SELECT question, options, ends_at FROM space_polls WHERE post_id = %s",
            [post_id]
        )
        poll_row = cur.fetchone()
        if poll_row:
            import json as _json
            from datetime import datetime
            question, options_json, ends_at = poll_row
            try:
                options = _json.loads(options_json) if options_json else []
            except Exception:
                options = []
            if isinstance(options, dict):
                options = [options[k] for k in sorted(options.keys(), key=lambda x: int(x))]

            total_votes = 0
            if isinstance(options, list):
                for o in options:
                    if isinstance(o, dict):
                        total_votes += int(o.get('votes', 0) or 0)
                for o in options:
                    if isinstance(o, dict):
                        v = int(o.get('votes', 0) or 0)
                        o['percentage'] = round((v / total_votes) * 100) if total_votes > 0 else 0

            # Did this user vote?
            user_vote = None
            cur.execute(
                "SELECT poll_vote_index FROM space_user_interactions "
                "WHERE post_id = %s AND user_id = %s AND poll_vote_index IS NOT NULL",
                [post_id, user_id]
            )
            vr = cur.fetchone()
            if vr:
                user_vote = vr[0]

            # ends_in
            ends_in = None
            if ends_at:
                try:
                    ends_dt = ends_at
                    if isinstance(ends_dt, str):
                        ends_dt = datetime.strptime(ends_dt, '%Y-%m-%d %H:%M:%S')
                    now = datetime.now()
                    if ends_dt > now:
                        secs = int((ends_dt - now).total_seconds())
                        if secs >= 86400:
                            ends_in = f'{secs // 86400} days'
                        elif secs >= 3600:
                            ends_in = f'{secs // 3600} hours'
                        elif secs >= 60:
                            ends_in = f'{secs // 60} minutes'
                        else:
                            ends_in = 'Less than a minute'
                except Exception:
                    ends_in = None

            poll = {
                'question': question,
                'options': options,
                'total_votes': total_votes,
                'user_vote': user_vote,
                'ends_in': ends_in,
            }
  author_name = row.get('author_name') or 'Unknown'
  author_first = author_name.split(' ')[0]
  # is_edited: updated_at not null AND != created_at
  updated_at = row.get('updated_at')
  created_at = row.get('created_at')
  is_edited = bool(updated_at and updated_at != created_at)
  created_str = created_at.strftime('%Y-%m-%d %H:%M:%S') if created_at else None
  return {
    'id': post_id,
    'content': _render_content(row.get('content') or ''),
    'author': {
            'id': row['author_id'],
            'name': _esc(author_first),
            'full_name': _esc(author_name),
            'username': _esc(row.get('author_username') or ''),
            'picture': _media_url(row.get('author_picture')),
        },
    'media': media,
    'is_edited': is_edited,
    'poll': poll,
    'views': int(row.get('views_count') or 0),
    'likes': int(row.get('likes_count') or 0),
    'dislikes': int(row.get('dislikes_count') or 0),
    'comments_count': int(row.get('comments_count') or 0),
    'shares': int(row.get('shares_count') or 0),
    'user_reaction': row.get('user_reaction'),
    'is_saved': bool(row.get('is_saved')),
    'created_at': created_str,
    'time_ago': _time_ago(created_at),
    'share_url': f'/post/{post_id}',
    'source': 'user',
    'is_page_post': False,
}


def ajax_landing_live(request):
  from django.core.cache import cache
  from django.db import connection
  user_count = Auth.objects.count()
  latest_user = Auth.objects.order_by('-id').first()
  shouts_qs = (
        Shout.objects
        .filter(is_deleted=0)
        .select_related('user')
        .order_by('-created_at')[:5]
    )
  new_shouts = [
        {
            'username': s.user.username,
            'user_pic': s.user.picture or '',
            'message': s.message,
            'created_at': s.created_at.isoformat() if s.created_at else None,
        }
        for s in shouts_qs
    ]
  stats = cache.get('landing_stats')
  if stats is None:
    with connection.cursor() as cur:
            stats = {}

            cur.execute("SELECT COUNT(*) FROM auth")
            stats['users'] = cur.fetchone()[0] or 0

            cur.execute("SELECT COUNT(*) FROM shouts WHERE is_deleted = 0")
            stats['shouts'] = cur.fetchone()[0] or 0

            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM group_posts) +
                    (SELECT COUNT(*) FROM page_posts) +
                    (SELECT COUNT(*) FROM space_posts)
            """)
            stats['posts'] = cur.fetchone()[0] or 0

            cur.execute("SELECT COUNT(*) FROM `groups`")
            stats['groups'] = cur.fetchone()[0] or 0

            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM messages) +
                    (SELECT COUNT(*) FROM chatroom_messages)
            """)
            stats['messages'] = cur.fetchone()[0] or 0

            cur.execute("SELECT COUNT(*) FROM auth WHERE picture IS NOT NULL AND picture != ''")
            stats['photos'] = cur.fetchone()[0] or 0
    cache.set('landing_stats', stats, 300)
  return JsonResponse({
        'success': True,
        'user_count': user_count,
        'latest_user': {
            'username': latest_user.username if latest_user else None,
            'created_at': latest_user.created_at.isoformat() if latest_user and latest_user.created_at else None,
        } if latest_user else None,
        'new_shouts': new_shouts,
        'stats': stats,
    })


def landing_page(request):
  """The XAPYX landing page."""
  # Total users
  user_count = Auth.objects.count()
  # Latest user
  latest_user = Auth.objects.order_by('-id').first()
  # Recent shouts for the ticker
  shouts_qs = (
        Shout.objects
        .filter(is_deleted=0)
        .select_related('user')
        .order_by('-created_at')[:20]
    )
  shouts = list(shouts_qs)
  # ------------------------------------------------------------
  # REAL STATS (from DB — no fakes)
  # ------------------------------------------------------------
  stats = {
        'users': Auth.objects.count(),
        'shouts': Shout.objects.filter(is_deleted=0).count(),
        'groups': 0,     # placeholder — real count coming below
        'posts': 0,      # placeholder
        'messages': 0,   # placeholder
        'photos': Auth.objects.exclude(
            Q(picture__isnull=True) | Q(picture='')
        ).count(),
    }
  # Raw SQL for tables that aren't yet Django models.
  # We'll add proper models for these later; for now, this is fast & safe.
  from django.db import connection
  with connection.cursor() as cur:
        # Group posts count
        cur.execute("SELECT COUNT(*) FROM group_posts")
        stats['posts'] += cur.fetchone()[0] or 0

        # Page posts count
        cur.execute("SELECT COUNT(*) FROM page_posts")
        stats['posts'] += cur.fetchone()[0] or 0

        # Space posts count
        cur.execute("SELECT COUNT(*) FROM space_posts")
        stats['posts'] += cur.fetchone()[0] or 0

        # Groups count
        cur.execute("SELECT COUNT(*) FROM `groups`")
        stats['groups'] = cur.fetchone()[0] or 0

        # Messages count (chat + DMs)
        cur.execute("SELECT COUNT(*) FROM messages")
        stats['messages'] += cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM chatroom_messages")
        stats['messages'] += cur.fetchone()[0] or 0
  context = {
        'user_count': user_count,
        'latest_user': latest_user,
        'shouts': shouts,
        'default_avatar': '/static/images/avatars/default.png',
        'primary_color': '#ff8c00',
        'stats': stats,
    }
  return render(request, 'landing/index.html', context)
# ------------------------------------------------------------
# AJAX endpoints
# ------------------------------------------------------------


def ajax_get_user_count(request):
  return JsonResponse({'success': True, 'count': Auth.objects.count()})


def ajax_get_latest_user(request):
  user = Auth.objects.order_by('-id').first()
  if not user:
    return JsonResponse({'success': False})
  return JsonResponse({
        'success': True,
        'user': {
            'username': user.username,
            'created_at': user.created_at.isoformat() if user.created_at else None,
        },
    })


def ajax_get_new_shouts(request):
  limit = int(request.GET.get('limit', 5))
  shouts_qs = (
        Shout.objects
        .filter(is_deleted=0)
        .select_related('user')
        .order_by('-created_at')[:limit]
    )
  data = [
        {
            'username': s.user.username,
            'user_pic': s.user.picture or '',
            'message': s.message,
            'created_at': s.created_at.isoformat() if s.created_at else None,
        }
        for s in shouts_qs
    ]
  return JsonResponse({'success': True, 'shouts': data})


def ajax_get_stats(request):
  """Return the real stats for the sidebar."""
  from django.db import connection
  with connection.cursor() as cur:
        stats = {}

        cur.execute("SELECT COUNT(*) FROM auth")
        stats['users'] = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM shouts WHERE is_deleted = 0")
        stats['shouts'] = cur.fetchone()[0] or 0

        cur.execute("""
            SELECT
                (SELECT COUNT(*) FROM group_posts) +
                (SELECT COUNT(*) FROM page_posts) +
                (SELECT COUNT(*) FROM space_posts)
        """)
        stats['posts'] = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM `groups`")
        stats['groups'] = cur.fetchone()[0] or 0

        cur.execute("""
            SELECT
                (SELECT COUNT(*) FROM messages) +
                (SELECT COUNT(*) FROM chatroom_messages)
        """)
        stats['messages'] = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM auth WHERE picture IS NOT NULL AND picture != ''")
        stats['photos'] = cur.fetchone()[0] or 0
  return JsonResponse({'success': True, 'stats': stats})
  # ============================================================
# AUTHENTICATION VIEWS
# ============================================================
USERNAME_RE = re.compile(r'^[a-z0-9_]+$')
EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
NAME_RE = re.compile(r'^[a-zA-Z\s]+$')


def _validate_password(pw):
  errors = []
  if len(pw) < 8:
    errors.append('Password must be at least 8 characters')
  if not re.search(r'[A-Z]', pw):
    errors.append('Password must contain at least one uppercase letter')
  if not re.search(r'[a-z]', pw):
    errors.append('Password must contain at least one lowercase letter')
  if not re.search(r'[0-9]', pw):
    errors.append('Password must contain at least one number')
  if not re.search(r'[^A-Za-z0-9]', pw):
    errors.append('Password must contain at least one special character')
  return errors
# ------------------------------------------------------------
# LOGIN
# ------------------------------------------------------------


def login_view(request):
  """Handles /login/ — GET shows form, POST authenticates."""
  # Determine where to redirect after successful login.
  next_url = (
        request.POST.get('next')
        or request.GET.get('next')
        or request.POST.get('redirect')
        or request.GET.get('redirect')
        or '/feed/'
    )
  # Sanitize
  if not next_url.startswith('/') or next_url.startswith('//'):
    next_url = '/feed/'
  # If already logged in, redirect to target
  if request.user.is_authenticated:
    return redirect(next_url)
  error = None
  login_value = ''
  if request.method == 'POST':
    login_value = (request.POST.get('login') or '').strip()
    password = request.POST.get('password') or ''
    if not login_value:
      error = 'Please enter your username, email or phone number'
    elif not password:
      error = 'Please enter your password'
    else:
      user = authenticate(request, username=login_value, password=password)
      if user is not None:
        auth_login(request, user)
        Auth.objects.filter(pk=user.pk).update(last_login=timezone.now())
        return redirect(next_url)
      else:
        exists = Auth.objects.filter(
                    Q(username=login_value) | Q(email=login_value) | Q(cell=login_value)
                ).exists()
        error = (
                    'Invalid password. Please try again.'
                    if exists else
                    'User not found. Please check your credentials.'
                )
  return render(request, 'auth/login.html', {
        'error': error,
        'login_value': login_value,
        'next': next_url,
    })
# ------------------------------------------------------------
# SIGNUP
# ------------------------------------------------------------


def signup_view(request):
  """Handles /signup/ — GET shows form, POST creates user."""
  # Determine where to redirect after successful signup
  next_url = (
        request.POST.get('next')
        or request.GET.get('next')
        or '/feed/'
    )
  if not next_url.startswith('/') or next_url.startswith('//'):
    next_url = '/feed/'
  if request.user.is_authenticated:
    return redirect(next_url)
  errors = []
  form_data = {}
  if request.method == 'POST':
    name = (request.POST.get('name') or '').strip()
    username = (request.POST.get('username') or '').strip().lower()
    contact_type = request.POST.get('contact_type', 'email')
    email = (request.POST.get('email') or '').strip() if contact_type == 'email' else ''
    cell_raw = request.POST.get('cell') or ''
    cell = re.sub(r'\D', '', cell_raw) if contact_type == 'phone' else ''
    password = request.POST.get('password') or ''
    terms = request.POST.get('terms') == 'on'
    form_data = {
            'name': name,
            'username': username,
            'email': email,
            'cell': cell,
            'contact_type': contact_type,
            'terms': terms,
        }
    # ---- Validate name ----
    if not name:
      errors.append('Name is required')
    elif len(name) < 2:
      errors.append('Name too short (min 2 characters)')
    elif len(name) > 100:
      errors.append('Name too long (max 100 characters)')
    elif not NAME_RE.match(name):
      errors.append('Name can only contain letters and spaces')
    # ---- Validate username ----
    if not username:
      errors.append('Username is required')
    elif len(username) < 4:
      errors.append('Username must be at least 4 characters')
    elif len(username) > 20:
      errors.append('Username cannot exceed 20 characters')
    elif not USERNAME_RE.match(username):
      errors.append('Username can only contain lowercase letters, numbers, and underscores')
    # ---- Validate contact ----
    if contact_type == 'email':
      if not email:
        errors.append('Email address is required')
      elif not EMAIL_RE.match(email) or len(email) > 100:
        errors.append('Please enter a valid email address')
    else:
      if not cell:
        errors.append('Phone number is required')
      elif not (10 <= len(cell) <= 15):
        errors.append('Phone number must be 10-15 digits')
    # ---- Validate password ----
    errors.extend(_validate_password(password))
    # ---- Validate terms ----
    if not terms:
      errors.append('You must accept the Terms of Service and Privacy Policy')
    # ---- Check uniqueness ----
    if not errors and username:
      if Auth.objects.filter(username=username).exists():
        errors.append(f'Username "{username}" is already taken. Please choose another.')
    if not errors and contact_type == 'email' and email:
      if Auth.objects.filter(email=email).exists():
        errors.append('This email address is already registered.')
    if not errors and contact_type == 'phone' and cell:
      if Auth.objects.filter(cell=cell).exists():
        errors.append('This phone number is already registered.')
    # ---- Create user ----
    if not errors:
      user = Auth(
                name=name,
                username=username,
                email=email if contact_type == 'email' else None,
                cell=cell if contact_type == 'phone' else None,
                role='user',
                theme_color='#f3a72c',
                auth_method='email',
            )
      user.set_password(password)
      # Uses bcrypt (configured in settings)
      # Note: we do NOT set pass_org — deliberate security improvement
      user.save()
      # Auto-login
      auth_login(request, user)
      Auth.objects.filter(pk=user.pk).update(last_login=timezone.now())
      return redirect(next_url)
  return render(request, 'auth/signup.html', {
    'errors': errors,
    'form_data': form_data,
    'user_count': Auth.objects.count(),
    'recent_users': Auth.objects.order_by('-id')[:5],
    'next': request.GET.get('next') or request.POST.get('next') or '',
})
# ------------------------------------------------------------
# LOGOUT
# ------------------------------------------------------------
@require_POST


def logout_view(request):
  """Handles /logout/ — POST only for CSRF safety."""
  auth_logout(request)
  return redirect('/')
# ============================================================
# AJAX ENDPOINTS (return JSON)
# ============================================================


def ajax_check_username(request):
  username = (request.GET.get('username') or '').strip().lower()
  if len(username) < 4:
    return JsonResponse({'available': False, 'message': 'Min 4 chars'})
  if len(username) > 20:
    return JsonResponse({'available': False, 'message': 'Max 20 chars'})
  if not USERNAME_RE.match(username):
    return JsonResponse({'available': False, 'message': 'Invalid format'})
  available = not Auth.objects.filter(username=username).exists()
  return JsonResponse({
        'available': available,
        'message': '✓ Available!' if available else '✗ Taken',
    })


def ajax_check_email(request):
  email = (request.GET.get('email') or '').strip()
  if not EMAIL_RE.match(email):
    return JsonResponse({'available': False, 'message': 'Invalid email'})
  available = not Auth.objects.filter(email=email).exists()
  return JsonResponse({
        'available': available,
        'message': '✓ Available!' if available else '✗ Already used',
    })


def ajax_check_phone(request):
  phone = re.sub(r'\D', '', request.GET.get('phone') or '')
  if not (10 <= len(phone) <= 15):
    return JsonResponse({'available': False, 'message': 'Invalid phone'})
  available = not Auth.objects.filter(cell=phone).exists()
  return JsonResponse({
        'available': available,
        'message': '✓ Available!' if available else '✗ Already used',
    })


def ajax_suggest_username(request):
  """Generate available username suggestions from a full name."""
  import random
  full_name = (request.GET.get('name') or '').strip()
  clean = re.sub(r'[^a-zA-Z]', '', full_name).lower()
  if len(clean) < 2:
    return JsonResponse([], safe=False)
  base = clean[:10]
  suggestions = [
        base,
        base + str(random.randint(10, 99)),
        base + str(random.randint(100, 999)),
        base + '_' + str(random.randint(10, 99)),
        base + '_' + str(random.randint(100, 999)),
    ]
  suffixes = ['official', 'real', 'pro', 'hub', 'life', 'world', 'zone', 'time']
  for s in random.sample(suffixes, 2):
    suggestions.append(base + '_' + s)
  parts = full_name.lower().split()
  if len(parts) > 1:
    first, last = parts[0], parts[-1]
    suggestions.extend([
            first + last,
            first + '_' + last,
            first[0] + last,
            first + last[:3],
        ])
  # Deduplicate, filter available, cap to 5
  seen = set()
  available_list = []
  for sug in suggestions:
    sug = re.sub(r'[^a-z0-9_]', '', sug)
    if len(sug) < 4:
      sug = sug + str(random.randint(10, 99))
    if len(sug) > 20:
      sug = sug[:20]
    if sug in seen:
      continue
    seen.add(sug)
    if not Auth.objects.filter(username=sug).exists():
      available_list.append(sug)
    if len(available_list) >= 5:
      break
  return JsonResponse(available_list, safe=False)


def _load_svg_logo():
  """Load the XAPYX SVG logo for inline rendering (theme-color aware)."""
  import os, re
  from django.conf import settings
  svg_path = os.path.join(settings.BASE_DIR, 'static', 'images', 'branding', 'xapyx_logo.svg')
  try:
    with open(svg_path, 'r', encoding='utf-8') as f:
            svg = f.read()
    svg = re.sub(r'fill="[^"]*"', 'fill="currentColor"', svg)
    svg = re.sub(r'stroke="[^"]*"', 'stroke="currentColor"', svg)
    svg = re.sub(r'width="[^"]*"', '', svg)
    svg = re.sub(r'height="[^"]*"', 'height="40px"', svg)
    return svg
  except:
    Exception
@login_required


def feed_view(request):
  """Main dashboard / feed page."""
  user = request.user
  # ---- Friends (accepted) — for @mention autocomplete ----
  friends = []
  with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON (f.sender_id = a.id OR f.receiver_id = a.id)
            WHERE (f.sender_id = %s OR f.receiver_id = %s)
              AND f.status = 'accepted'
              AND a.id != %s
        """, [user.id, user.id, user.id])
        for row in cur.fetchall():
            pic = row[3]
            friends.append({
                'id': row[0],
                'name': row[1] or '',
                'username': row[2] or '',
                'picture': (
                    f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'
                    if pic else '/static/images/avatars/default.png'
                ),
            })
  # ---- Blocked users (this user blocked) ----
  blocked_users = []
  with connection.cursor() as cur:
        cur.execute("SELECT blocked_id FROM blocks WHERE blocker_id = %s", [user.id])
        blocked_users = [row[0] for row in cur.fetchall()]
  # ---- User stats (from space_posts) ----
  stats = {'posts': 0, 'likes': 0, 'comments': 0, 'views': 0, 'shouts': 0, 'page_posts': 0}
  try:
    with connection.cursor() as cur:
            cur.execute("""
                SELECT
                  (SELECT COUNT(*) FROM space_posts WHERE user_id=%s AND is_deleted=0),
                  (SELECT COALESCE(SUM(likes_count),0) FROM space_posts WHERE user_id=%s AND is_deleted=0),
                  (SELECT COUNT(*) FROM space_comments sc
                     JOIN space_posts sp ON sc.post_id = sp.post_id
                     WHERE sp.user_id=%s AND sc.is_deleted=0 AND sp.is_deleted=0),
                  (SELECT COALESCE(SUM(views_count),0) FROM space_posts WHERE user_id=%s AND is_deleted=0),
                  (SELECT COUNT(*) FROM shouts WHERE user_id=%s AND is_deleted=0),
                  (SELECT COUNT(*) FROM page_posts pp
                     JOIN pages p ON pp.page_id = p.id
                     WHERE p.creator_id=%s OR pp.creator_id=%s)
            """, [user.id, user.id, user.id, user.id, user.id, user.id, user.id])
            row = cur.fetchone()
            if row:
                stats.update({
                    'posts': row[0] or 0,
                    'likes': row[1] or 0,
                    'comments': row[2] or 0,
                    'views': row[3] or 0,
                    'shouts': row[4] or 0,
                    'page_posts': row[5] or 0,
                })
  except:
    Exception
  # ---- Engagement rate ----
  engagement = 0
  if stats['posts'] > 0:
    engagement = round(((stats['likes'] + stats['comments']) / stats['posts']) * 10) / 10
  # ---- Shout marquee (15 latest) ----
  shouts = []
  try:
    with connection.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.message, s.created_at, a.username, a.picture, a.name
                FROM shouts s
                JOIN auth a ON s.user_id = a.id
                WHERE s.is_deleted = 0
                ORDER BY s.created_at DESC
                LIMIT 15
            """)
            for row in cur.fetchall():
                pic = row[4]
                shouts.append({
                    'id': row[0],
                    'message': row[1] or '',
                    'created_at': row[2],
                    'username': row[3] or '',
                    'name': row[5] or row[3] or '',
                    'picture': (
                        f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'
                        if pic else '/static/images/avatars/default.png'
                    ),
                })
  except:
    Exception
  # ---- Recent activity (posts, shouts, page posts) ----
  recent_activity = []
  try:
    with connection.cursor() as cur:
            cur.execute("""
                (SELECT 'post' AS type, post_id AS id, created_at, 'Created a post' AS action
                 FROM space_posts
                 WHERE user_id = %s AND is_deleted = 0
                 ORDER BY created_at DESC
                 LIMIT 5)
                UNION ALL
                (SELECT 'shout' AS type, id, created_at, 'Shared a shout' AS action
                 FROM shouts
                 WHERE user_id = %s AND is_deleted = 0
                 ORDER BY created_at DESC
                 LIMIT 5)
                UNION ALL
                (SELECT 'page_post' AS type, pp.id, pp.created_at, 'Posted on a page' AS action
                 FROM page_posts pp
                 JOIN pages p ON pp.page_id = p.id
                 WHERE p.creator_id = %s OR pp.creator_id = %s
                 ORDER BY pp.created_at DESC
                 LIMIT 5)
                ORDER BY created_at DESC
                LIMIT 5
            """, [user.id, user.id, user.id, user.id])
            for row in cur.fetchall():
                recent_activity.append({
                    'type': row[0],
                    'id': row[1],
                    'created_at': row[2],
                    'action': row[3],
                })
  except:
    Exception
  display_name = (user.name or user.username or '').strip()
  first_name = display_name.split()[0] if display_name else user.username
  return render(request, 'dashboard/feed.html', {
        'active_page': 'dashboard',
        'first_name': first_name,
        'friends_json': json.dumps(friends),
        'blocked_users_json': json.dumps(blocked_users),
        'stats': stats,
        'engagement': engagement,
        'shouts': shouts,
        'recent_activity': recent_activity,
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


def _format_time_ago(dt, now=None):
  """Returns '2m ago', '3h ago', '1d ago', etc."""
  if not dt:
    return "just now"
  if now is None:
    now = timezone.now()
  if timezone.is_naive(dt):
    dt = timezone.make_aware(dt)
  diff = (now - dt).total_seconds()
  if diff < 60:
    return "just now"
  if diff < 3600:
    return f'{int(diff // 60)}m ago'
  if diff < 86400:
    return f'{int(diff // 3600)}h ago'
  if diff < 604800:
    return f'{int(diff // 86400)}d ago'
  if diff < 2592000:
    return f'{int(diff // 604800)}w ago'
  return dt.strftime('%b %d')

#Poll description
def _build_poll_dict(question, options_json, ends_at, user_vote=None):
    """Normalise a poll row into the shape createPostElement() expects."""
    import json as _json
    from datetime import datetime as _dt

    try:
        options = _json.loads(options_json) if options_json else []
    except Exception:
        options = []
    if isinstance(options, dict):
        options = [options[k] for k in sorted(options.keys(), key=lambda x: int(x))]
    if not isinstance(options, list):
        options = []

    total_votes = 0
    for o in options:
        if isinstance(o, dict):
            total_votes += int(o.get('votes', 0) or 0)
    for o in options:
        if isinstance(o, dict):
            v = int(o.get('votes', 0) or 0)
            o['percentage'] = round((v / total_votes) * 100) if total_votes > 0 else 0

    ends_in = None
    if ends_at:
        try:
            ends_dt = ends_at
            if isinstance(ends_dt, str):
                ends_dt = _dt.strptime(ends_dt, '%Y-%m-%d %H:%M:%S')
            now = _dt.now()
            if ends_dt > now:
                secs = int((ends_dt - now).total_seconds())
                if secs >= 86400:
                    ends_in = f'{secs // 86400} days'
                elif secs >= 3600:
                    ends_in = f'{secs // 3600} hours'
                elif secs >= 60:
                    ends_in = f'{secs // 60} minutes'
                else:
                    ends_in = 'Less than a minute'
        except Exception:
            ends_in = None

    return {
        'question': question,
        'options': options,
        'total_votes': total_votes,
        'user_vote': user_vote,
        'ends_in': ends_in,
    }

@login_required
@vary_on_cookie
@cache_page(30)
def api_posts_list(request):
  """GET /api/posts/?cursor=<ISO-timestamp> - returns cursor-paginated posts as JSON."""
  from datetime import datetime

  cursor_param = (request.GET.get('cursor') or '').strip()
  cursor_dt = None
  cursor_id = None
  if cursor_param:
    try:
      if '_' in cursor_param:
        dt_part, id_part = cursor_param.rsplit('_', 1)
        cursor_id = int(id_part)
      else:
        dt_part = cursor_param
        cursor_id = None

      if cursor_id is None and request.GET.get('cursor_id'):
        try:
          cursor_id = int(request.GET.get('cursor_id'))
        except (ValueError, TypeError):
          pass

      dt_part = dt_part.replace('Z', '+00:00').replace(' ', 'T')
      dt = datetime.fromisoformat(dt_part)
      if dt.microsecond:
        cursor_dt = dt.strftime('%Y-%m-%d %H:%M:%S.%f')
      else:
        cursor_dt = dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
      cursor_dt = None
      cursor_id = None

  per_page = 12
  user_id = request.user.id
  # Get blocked IDs (both directions - I blocked them, or they blocked me)
  with connection.cursor() as cur:
    cur.execute("""
            SELECT blocked_id FROM blocks WHERE blocker_id = %s
            UNION
            SELECT blocker_id FROM blocks WHERE blocked_id = %s
        """, [user_id, user_id])
    blocked_ids = [row[0] for row in cur.fetchall()]

  # Base query
  sql = """
        SELECT
            p.post_id, p.user_id, p.content, p.created_at, p.updated_at,
            p.likes_count, p.dislikes_count, p.comments_count, p.views_count, p.shares_count,
            p.is_page_post, p.page_id,
            a.id AS a_id, a.name AS a_name, a.username AS a_username, a.picture AS a_picture,
            ui.reaction AS user_reaction
        FROM space_posts p
        LEFT JOIN auth a ON p.user_id = a.id
        LEFT JOIN space_user_interactions ui
            ON ui.post_id = p.post_id AND ui.user_id = %s
        WHERE p.is_deleted = 0
          AND (p.is_page_post = 0 OR p.is_page_post IS NULL)
          AND (p.visibility = 'public' OR p.user_id = %s)
    """
  params = [user_id, user_id]
  if blocked_ids:
    placeholders = ','.join(['%s'] * len(blocked_ids))
    sql += f" AND p.user_id NOT IN ({placeholders})"
    params.extend(blocked_ids)

  if cursor_dt is not None:
    if cursor_id is not None:
      sql += " AND (p.created_at < %s OR (p.created_at = %s AND p.post_id < %s))"
      params.extend([cursor_dt, cursor_dt, cursor_id])
    else:
      sql += " AND p.created_at < %s"
      params.append(cursor_dt)

  sql += " ORDER BY p.created_at DESC, p.post_id DESC LIMIT %s"
  params.append(per_page + 1)

  with connection.cursor() as cur:
    cur.execute(sql, params)
    rows = cur.fetchall()

  has_more = len(rows) > per_page
  if has_more:
    rows = rows[:per_page]

  next_cursor = None
  if rows and has_more:
    last_row = rows[-1]
    last_created_at = last_row[3]
    last_post_id = last_row[0]
    if last_created_at:
      if hasattr(last_created_at, 'isoformat'):
        dt_str = last_created_at.isoformat()
      else:
        dt_str = str(last_created_at).replace(' ', 'T')
      next_cursor = f"{dt_str}_{last_post_id}"

  # Fetch all media for these posts in one query
  post_ids = [row[0] for row in rows]
  media_by_post = {}
  if post_ids:
    placeholders = ','.join(['%s'] * len(post_ids))
    S3_BASE = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/'
    with connection.cursor() as cur:
      cur.execute(f"""
                SELECT post_id, media_url, media_type, mime_type
                FROM space_media
                WHERE post_id IN ({placeholders})
                ORDER BY id ASC
            """, post_ids)
      for m in cur.fetchall():
        raw_url = m[1] or ''
        if raw_url and not raw_url.startswith('http'):
          if raw_url.startswith('uploads/'):
            full_url = S3_BASE + raw_url
          else:
            full_url = S3_BASE + 'uploads/space_posts/' + raw_url
        else:
          full_url = raw_url
        m_type = m[2] or 'image'
        m_thumb = _get_thumbnail_url(full_url, m_type)
        media_by_post.setdefault(m[0], []).append({
            'type': m_type,
            'url': full_url,
            'thumbnail_url': m_thumb,
            'mime_type': m[3] or 'image/jpeg',
        })
    # ---- Bulk-fetch polls for these posts ----
    polls_by_post = {}
    user_votes_by_post = {}
    if post_ids:
      placeholders = ','.join(['%s'] * len(post_ids))
      with connection.cursor() as cur:
        cur.execute(f"""
                SELECT post_id, question, options, ends_at
                FROM space_polls
                WHERE post_id IN ({placeholders})
            """, post_ids)
        for p in cur.fetchall():
          polls_by_post[p[0]] = _build_poll_dict(p[1], p[2], p[3])

        # User's existing vote (if any) for each post
        cur.execute(f"""
                SELECT post_id, poll_vote_index
                FROM space_user_interactions
                WHERE user_id = %s
                  AND post_id IN ({placeholders})
                  AND poll_vote_index IS NOT NULL
            """, [user_id] + post_ids)
        for r in cur.fetchall():
          user_votes_by_post[r[0]] = r[1]

  now = timezone.now()
  posts = []
  for row in rows:
    (post_id, post_user_id, content, created_at, updated_at,
     likes, dislikes, comments, views, shares,
     is_page_post, page_id,
     a_id, a_name, a_username, a_picture,
     user_reaction) = row
    is_edited = bool(updated_at and created_at and updated_at != created_at)
    author_picture = (
        f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{a_picture}'
        if a_picture else '/static/images/avatars/default.png'
    )

    poll = polls_by_post.get(post_id)
    if poll is not None and post_id in user_votes_by_post:
      poll['user_vote'] = user_votes_by_post[post_id]

    posts.append({
        'id': post_id,
        'content': content or '',
        'author': {
            'id': a_id or post_user_id,
            'name': a_name or a_username or 'User',
            'username': a_username or 'user',
            'picture': author_picture,
        },
        'time_ago': _format_time_ago(created_at, now),
        'is_edited': is_edited,
        'media': media_by_post.get(post_id, []),
        'poll': poll,
        'views': views or 0,
        'user_reaction': user_reaction,
        'likes': likes or 0,
        'dislikes': dislikes or 0,
        'comments_count': comments or 0,
        'shares': shares or 0,
    })

  return JsonResponse({
      'success': True,
      'posts': posts,
      'has_more': has_more,
      'next_cursor': next_cursor,
  })


@login_required
@require_POST
def api_posts_create(request):
  """POST /api/posts/create/ — create a post with text, poll, mentions, media."""
  import json as _json
  from datetime import datetime, timedelta

  is_json_req = bool(request.content_type and 'application/json' in request.content_type)
  json_data = {}
  if is_json_req:
    try:
      json_data = _json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
      json_data = {}

  if is_json_req:
    content = (json_data.get('content') or '').strip()
    poll_question = (json_data.get('poll_question') or '').strip()
    poll_options_raw = json_data.get('poll_options') or ''
    poll_duration_raw = json_data.get('poll_duration') or '7'
    media_files = []
    mentions_data = json_data.get('mentions') or []
    if isinstance(mentions_data, list):
      mentions = mentions_data
    else:
      try:
        mentions = _json.loads(mentions_data)
      except Exception:
        mentions = []
    direct_keys = []
    raw_s3_key = json_data.get('s3_key')
    if raw_s3_key:
      if isinstance(raw_s3_key, list):
        direct_keys.extend(raw_s3_key)
      else:
        direct_keys.append(raw_s3_key)
    raw_s3_keys = json_data.get('s3_keys')
    if raw_s3_keys and isinstance(raw_s3_keys, list):
      direct_keys.extend(raw_s3_keys)
  else:
    content = (request.POST.get('content') or '').strip()
    poll_question = (request.POST.get('poll_question') or '').strip()
    poll_options_raw = request.POST.get('poll_options') or ''
    poll_duration_raw = request.POST.get('poll_duration') or '7'
    media_files = request.FILES.getlist('media[]') or request.FILES.getlist('media')
    mentions_raw = request.POST.get('mentions') or '[]'
    try:
      mentions = _json.loads(mentions_raw)
      if not isinstance(mentions, list):
        mentions = []
    except Exception:
      mentions = []
    direct_keys = []
    post_s3_key = request.POST.get('s3_key')
    if post_s3_key:
      direct_keys.append(post_s3_key)

  # Parse poll options
  poll_options = []
  if poll_question and poll_options_raw:
    if isinstance(poll_options_raw, list):
      poll_options = [str(o).strip() for o in poll_options_raw if str(o).strip()]
    else:
      try:
        parsed = _json.loads(poll_options_raw)
        if isinstance(parsed, list):
          poll_options = [str(o).strip() for o in parsed if str(o).strip()]
      except Exception:
        pass
  has_poll = bool(poll_question and len(poll_options) >= 2)
  if not content and not media_files and not direct_keys and not has_poll:
    return JsonResponse({'success': False, 'error': 'Post cannot be empty'})
  if len(content) > 1000:
    return JsonResponse({'success': False, 'error': 'Post is too long (max 1000)'})
  try:
    poll_duration = max(1, int(poll_duration_raw))
  except:
    (TypeError, ValueError)
  user_id = request.user.id
  # ---- Insert post ----
  with connection.cursor() as cur:
        cur.execute(
            "INSERT INTO space_posts "
            "(user_id, content, visibility, created_at, updated_at, is_deleted, "
            " likes_count, dislikes_count, comments_count, views_count, shares_count, "
            " is_page_post, page_id) "
            "VALUES (%s, %s, 'public', NOW(), NULL, 0, 0, 0, 0, 0, 0, 0, NULL)",
            [user_id, content]
        )
        post_id = cur.lastrowid
  # ---- Mentions ----
  for m in mentions:
    try:
      mentioned_id = int(m.get('user_id') or 0)
    except:
      (TypeError, ValueError)
    if not mentioned_id or mentioned_id == user_id:
      continue
    try:
      with connection.cursor() as cur:
                cur.execute("SELECT id FROM auth WHERE id = %s", [mentioned_id])
                if not cur.fetchone():
                    continue
                cur.execute(
                    "INSERT INTO mentions (post_id, mentioned_user_id, mentioned_by, type, created_at) "
                    "VALUES (%s, %s, %s, 'post', NOW())",
                    [post_id, mentioned_id, user_id]
                )
    except Exception as e:
      pass
  # TODO: send notification when NotificationCenter is ported to Python
  # ---- Poll ----
  if has_poll:
    formatted = [
            {'text': opt, 'votes': 0}
            for opt in poll_options
        ]
    ends_at = datetime.now() + timedelta(days=poll_duration)
    with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO space_polls (post_id, question, options, ends_at) "
                "VALUES (%s, %s, %s, %s)",
                [post_id, poll_question, _json.dumps(formatted),
                 ends_at.strftime('%Y-%m-%d %H:%M:%S')]
            )
  # ---- Media (Direct S3 keys + fallback S3 upload) ----
  s3_failures = []
  for k in direct_keys:
    if k:
      ext = os.path.splitext(k)[1].lower()
      mime = mimetypes.types_map.get(ext, 'image/jpeg' if ext in ['.jpg', '.jpeg'] else 'application/octet-stream')
      media_type = _classify_media(mime)
      with connection.cursor() as cur:
        cur.execute(
          "INSERT INTO space_media (post_id, media_url, media_type, mime_type) "
          "VALUES (%s, %s, %s, %s)",
          [post_id, k, media_type, mime]
        )
      if media_type == 'image' and ext not in ['.mp4', '.mov', '.avi', '.mkv']:
        try:
          from landing.tasks import generate_image_variants
          generate_image_variants.delay(k)
        except Exception:
          pass

  for f in media_files:
    key = _upload_to_s3(f)
    if key:
      mime = f.content_type or 'application/octet-stream'
      media_type = _classify_media(mime)
      with connection.cursor() as cur:
                cur.execute(
                    "INSERT INTO space_media (post_id, media_url, media_type, mime_type) "
                    "VALUES (%s, %s, %s, %s)",
                    [post_id, key, media_type, mime]
                )
      ext = os.path.splitext(key)[1].lower()
      if media_type == 'image' and ext not in ['.mp4', '.mov', '.avi', '.mkv']:
        try:
          from landing.tasks import generate_image_variants
          generate_image_variants.delay(key)
        except Exception:
          pass
    else:
      s3_failures.append(f.name)
  # ---- Return the fully-formed post (via api_posts_get shape) ----
  return _build_post_response(post_id, user_id, s3_failures)


def _get_thumbnail_url(full_or_raw_url, media_type='image'):
    if media_type != 'image' or not full_or_raw_url:
        return full_or_raw_url
    # If it's a known image extension, produce the _feed.webp variant URL
    lower = full_or_raw_url.lower()
    for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
        if lower.endswith(ext):
            return full_or_raw_url[:-len(ext)] + '_feed.webp'
    return full_or_raw_url


def _build_post_response(post_id, user_id, s3_failures=None):
  """Internal helper — build the same JSON shape as api_posts_get."""
  S3_BASE = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/'
  def to_full(raw):
    if not raw:
      return ""
    if raw.startswith('http'):
      return raw
    if raw.startswith('uploads/'):
      return S3_BASE + raw
    return S3_BASE + "uploads/space_posts/" + raw
  with connection.cursor() as cur:
        cur.execute("""
            SELECT
                p.post_id, p.user_id, p.content, p.created_at, p.updated_at,
                p.likes_count, p.dislikes_count, p.comments_count, p.views_count, p.shares_count,
                a.id AS a_id, a.name AS a_name, a.username AS a_username, a.picture AS a_picture,
                ui.reaction AS user_reaction, ui.has_saved AS is_saved
            FROM space_posts p
            LEFT JOIN auth a ON p.user_id = a.id
            LEFT JOIN space_user_interactions ui
                ON ui.post_id = p.post_id AND ui.user_id = %s
            WHERE p.post_id = %s
        """, [user_id, post_id])
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Post created but not found'})

        (pid, post_user_id, content, created_at, updated_at,
         likes, dislikes, comments, views, shares,
         a_id, a_name, a_username, a_picture,
         user_reaction, is_saved) = row

        # Media
        cur.execute(
            "SELECT media_url, media_type, mime_type FROM space_media "
            "WHERE post_id = %s ORDER BY id ASC",
            [post_id]
        )
        media = []
        for m in cur.fetchall():
            m_type = m[1] or 'image'
            m_url = to_full(m[0])
            m_thumb = _get_thumbnail_url(m_url, m_type)
            media.append({
                'type': m_type,
                'url': m_url,
                'thumbnail_url': m_thumb,
                'mime_type': m[2] or 'image/jpeg',
            })

        # Poll
        cur.execute(
            "SELECT question, options, ends_at FROM space_polls WHERE post_id = %s",
            [post_id]
        )
        poll_row = cur.fetchone()
        poll = None
        if poll_row:
            import json as _j
            from datetime import datetime
            q, opts_json, ends_at = poll_row
            try:
                opts = _j.loads(opts_json) if opts_json else []
            except Exception:
                opts = []
            if isinstance(opts, dict):
                opts = [opts[k] for k in sorted(opts.keys(), key=lambda x: int(x))]
            total = sum(int(o.get('votes', 0) or 0) for o in opts)
            for o in opts:
                v = int(o.get('votes', 0) or 0)
                o['percentage'] = round((v / total) * 100) if total > 0 else 0
            ends_in = None
            if ends_at:
                try:
                    ends_dt = ends_at
                    if isinstance(ends_dt, str):
                        ends_dt = datetime.strptime(ends_dt, '%Y-%m-%d %H:%M:%S')
                    now = datetime.now()
                    if ends_dt > now:
                        secs = int((ends_dt - now).total_seconds())
                        if secs >= 86400:
                            ends_in = f'{secs // 86400} days'
                        elif secs >= 3600:
                            ends_in = f'{secs // 3600} hours'
                        elif secs >= 60:
                            ends_in = f'{secs // 60} minutes'
                        else:
                            ends_in = 'Less than a minute'
                except Exception:
                    ends_in = None
            poll = {
                'question': q,
                'options': opts,
                'total_votes': total,
                'user_vote': None,
                'ends_in': ends_in,
            }
  author_picture = (
        f'{S3_BASE}uploads/{a_picture}' if a_picture
        else '/static/images/avatars/default.png'
    )
  post = {
        'id': pid,
        'content': content or '',
        'author': {
            'id': a_id or post_user_id,
            'name': a_name or a_username or 'User',
            'username': a_username or 'user',
            'picture': author_picture,
        },
        'time_ago': _format_time_ago(created_at),
        'is_edited': False,
        'media': media,
        'poll': poll,
        'views': views or 0,
        'user_reaction': user_reaction,
        'is_saved': bool(is_saved),
        'likes': likes or 0,
        'dislikes': dislikes or 0,
        'comments_count': comments or 0,
        'shares': shares or 0,
    }
  resp = {'success': True, 'post': post}
  if s3_failures:
    resp['warnings'] = [f'S3 upload failed for: {n}' for n in s3_failures]
  return JsonResponse(resp)
@login_required
@require_POST


def api_posts_react(request):
  """POST /api/posts/react/ — toggle like/dislike on a post."""
  import json as _json
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    post_id = int(data.get('post_id') or 0)
  except:
    (TypeError, ValueError)
  reaction = data.get('reaction') or ''
  user_id = request.user.id
  if post_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid post_id'})
  if reaction not in ('like', 'dislike'):
    return JsonResponse({'success': False, 'error': 'Invalid reaction'})
  with connection.cursor() as cur:
        cur.execute(
            "SELECT post_id FROM space_posts WHERE post_id = %s AND is_deleted = 0",
            [post_id]
        )
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Post not found'})
  with connection.cursor() as cur:
        cur.execute(
            "SELECT id, reaction FROM space_user_interactions "
            "WHERE user_id = %s AND post_id = %s",
            [user_id, post_id]
        )
        existing = cur.fetchone()
  new_reaction = None
  if existing:
    existing_id = existing[0]
    current_reaction = existing[1]
    if current_reaction == reaction:
      with connection.cursor() as cur:
                cur.execute(
                    "UPDATE space_user_interactions SET reaction = NULL WHERE id = %s",
                    [existing_id]
                )
                if reaction == 'like':
                    cur.execute(
                        "UPDATE space_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE post_id = %s",
                        [post_id]
                    )
                else:
                    cur.execute(
                        "UPDATE space_posts SET dislikes_count = GREATEST(dislikes_count - 1, 0) WHERE post_id = %s",
                        [post_id]
                    )
      new_reaction = None
    else:
      with connection.cursor() as cur:
                cur.execute(
                    "UPDATE space_user_interactions SET reaction = %s WHERE id = %s",
                    [reaction, existing_id]
                )
                if current_reaction == 'like':
                    cur.execute(
                        "UPDATE space_posts SET likes_count = GREATEST(likes_count - 1, 0), dislikes_count = dislikes_count + 1 WHERE post_id = %s",
                        [post_id]
                    )
                elif current_reaction == 'dislike':
                    cur.execute(
                        "UPDATE space_posts SET dislikes_count = GREATEST(dislikes_count - 1, 0), likes_count = likes_count + 1 WHERE post_id = %s",
                        [post_id]
                    )
                elif current_reaction is None:
                    if reaction == 'like':
                        cur.execute(
                            "UPDATE space_posts SET likes_count = likes_count + 1 WHERE post_id = %s",
                            [post_id]
                        )
                    else:
                        cur.execute(
                            "UPDATE space_posts SET dislikes_count = dislikes_count + 1 WHERE post_id = %s",
                            [post_id]
                        )
      new_reaction = reaction
  else:
    with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO space_user_interactions (user_id, post_id, reaction) VALUES (%s, %s, %s)",
                [user_id, post_id, reaction]
            )
            if reaction == 'like':
                cur.execute(
                    "UPDATE space_posts SET likes_count = likes_count + 1 WHERE post_id = %s",
                    [post_id]
                )
            else:
                cur.execute(
                    "UPDATE space_posts SET dislikes_count = dislikes_count + 1 WHERE post_id = %s",
                    [post_id]
                )
    new_reaction = reaction
  if new_reaction == 'like':
      try:
          with connection.cursor() as cur:
              cur.execute("SELECT user_id FROM space_posts WHERE post_id = %s", [post_id])
              p_row = cur.fetchone()
              if p_row and p_row[0] != user_id:
                  actor_name = request.user.name or request.user.username or 'Someone'
                  _notify(
                      user_id=p_row[0],
                      notif_type='reaction',
                      title=f'{actor_name} liked your post',
                      message=f'{actor_name} liked your post',
                      icon='heart',
                      link=f'/post/{post_id}/',
                      actor_id=user_id
                  )
      except Exception:
          pass

  with connection.cursor() as cur:
        cur.execute(
            "SELECT GREATEST(likes_count, 0), GREATEST(dislikes_count, 0) "
            "FROM space_posts WHERE post_id = %s",
            [post_id]
        )
        likes, dislikes = cur.fetchone()
  return JsonResponse({
        'success': True,
        'likes': likes or 0,
        'dislikes': dislikes or 0,
        'user_reaction': new_reaction,
    })
@login_required
@require_POST


def api_posts_save(request):
  """POST /api/posts/save/ — toggle save/bookmark on a post."""
  import json as _json
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    post_id = int(data.get('post_id') or 0)
  except:
    (TypeError, ValueError)
  # Only user posts for now (page posts handled later)
  user_id = request.user.id
  if post_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid post ID'})
  with connection.cursor() as cur:
        # Confirm post exists
        cur.execute(
            "SELECT post_id FROM space_posts WHERE post_id = %s AND is_deleted = 0",
            [post_id]
        )
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Post not found'})

        # Look up existing interaction row
        cur.execute(
            "SELECT id, has_saved FROM space_user_interactions "
            "WHERE post_id = %s AND user_id = %s",
            [post_id, user_id]
        )
        row = cur.fetchone()

        if row:
            existing_id = row[0]
            current_saved = row[1]
            # PHP: $row['has_saved'] ? 0 : 1  (NULL and 0 both -> 1)
            new_save_status = 0 if current_saved else 1
            cur.execute(
                "UPDATE space_user_interactions SET has_saved = %s WHERE id = %s",
                [new_save_status, existing_id]
            )
            is_saved = (new_save_status == 1)
        else:
            cur.execute(
                "INSERT INTO space_user_interactions (user_id, post_id, has_saved) "
                "VALUES (%s, %s, 1)",
                [user_id, post_id]
            )
            is_saved = True
  return JsonResponse({'success': True, 'is_saved': is_saved})
@login_required
@require_POST


def api_posts_view(request):
  """POST /api/posts/view/ — record a view on a user post."""
  import json as _json
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    post_id = int(data.get('post_id') or 0)
  except:
    (TypeError, ValueError)
  # Only user posts supported for now (page posts handled later)
  post_type = data.get('type') or 'user'
  if post_type != 'user':
    return JsonResponse({'success': False, 'error': 'Page posts not supported yet'})
  if post_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid post ID'})
  user_id = request.user.id
  with connection.cursor() as cur:
        # Verify post exists
        cur.execute(
            "SELECT post_id FROM space_posts WHERE post_id = %s AND is_deleted = 0",
            [post_id]
        )
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Post not found'})

        # 1. Record the view (unique per user, debounced 5 min)
        cur.execute("""
            INSERT INTO space_user_interactions 
                (user_id, post_id, view_count, last_viewed_at, created_at, updated_at)
            VALUES (%s, %s, 1, NOW(), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                view_count = IF(last_viewed_at < NOW() - INTERVAL 5 MINUTE, 
                                view_count + 1, view_count),
                last_viewed_at = IF(last_viewed_at < NOW() - INTERVAL 5 MINUTE, 
                                    NOW(), last_viewed_at),
                updated_at = NOW()
        """, [user_id, post_id])

        # 2. Recompute post view count from distinct viewers
        cur.execute("""
            UPDATE space_posts 
            SET views_count = (
                SELECT COUNT(DISTINCT user_id) 
                FROM space_user_interactions 
                WHERE post_id = %s
            )
            WHERE post_id = %s
        """, [post_id, post_id])

        # Fetch updated count
        cur.execute(
            "SELECT views_count FROM space_posts WHERE post_id = %s",
            [post_id]
        )
        views_row = cur.fetchone()
        new_view_count = views_row[0] if views_row else 0
  return JsonResponse({
        'success': True,
        'message': 'View recorded',
        'new_view_count': new_view_count,
    })
@login_required


def api_posts_get_comments(request):
  """GET /api/posts/comments/?post_id=X&page=1&limit=20&type=user"""
  try:
    post_id = int(request.GET.get('post_id') or 0)
    page = int(request.GET.get('page') or 1)
    limit = int(request.GET.get('limit') or 20)
  except:
    (TypeError, ValueError)
  post_type = request.GET.get('type') or 'user'
  if post_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid post ID'})
  if post_type != 'user':
    return JsonResponse({'success': False, 'error': 'Page posts not supported yet'})
  offset = max(0, (page - 1) * limit)
  with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM space_comments WHERE post_id = %s AND is_deleted = 0",
            [post_id]
        )
        total_comments = cur.fetchone()[0] or 0

        cur.execute(
            """
            SELECT sc.id, sc.content, sc.created_at,
                   a.id, a.name, a.username, a.picture
            FROM space_comments sc
            JOIN auth a ON sc.user_id = a.id
            WHERE sc.post_id = %s AND sc.is_deleted = 0
            ORDER BY sc.created_at DESC
            LIMIT %s OFFSET %s
            """,
            [post_id, limit, offset]
        )
        rows = cur.fetchall()
  comments = []
  for row in rows:
    comments.append({
            'id': row[0],
            'content': _esc(row[1] or ''),
            'author': {
                'id': row[3],
                'name': _esc(row[4] or ''),
                'username': _esc(row[5] or ''),
                'picture': _media_url(row[6]),
            },
            'time_ago': _time_ago(row[2]),
            'created_at': row[2].strftime('%Y-%m-%d %H:%M:%S') if row[2] else None,
        })
  return JsonResponse({
        'success': True,
        'comments': comments,
        'total_comments': total_comments,
        'has_more': (offset + len(comments)) < total_comments,
        'page': page,
    })
@login_required
@require_POST


def api_posts_add_comment(request):
  """POST /api/posts/comments/add/ — add a comment to a user post."""
  import json as _json
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    post_id = int(data.get('post_id') or 0)
  except:
    (TypeError, ValueError)
  content = (data.get('content') or '').strip()
  post_type = data.get('type') or 'user'
  user_id = request.user.id
  if post_id <= 0 or not content:
    return JsonResponse({'success': False, 'error': 'Invalid data'})
  if post_type != 'user':
    return JsonResponse({'success': False, 'error': 'Page posts not supported yet'})
  with connection.cursor() as cur:
        # Make sure post exists
        cur.execute(
            "SELECT post_id FROM space_posts WHERE post_id = %s AND is_deleted = 0",
            [post_id]
        )
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Post not found'})

        cur.execute(
            "INSERT INTO space_comments (post_id, user_id, content, created_at) "
            "VALUES (%s, %s, %s, NOW())",
            [post_id, user_id, content]
        )
        comment_id = cur.lastrowid

        cur.execute(
            "UPDATE space_posts SET comments_count = comments_count + 1 "
            "WHERE post_id = %s",
            [post_id]
        )

        cur.execute("SELECT user_id FROM space_posts WHERE post_id = %s", [post_id])
        p_row = cur.fetchone()
        if p_row and p_row[0] != user_id:
            actor_name = request.user.name or request.user.username or 'Someone'
            _notify(
                user_id=p_row[0],
                notif_type='comment',
                title=f'{actor_name} commented on your post',
                message=f'{actor_name}: {content[:100]}',
                icon='comment',
                link=f'/post/{post_id}/',
                actor_id=user_id
            )

        cur.execute(
            """
            SELECT sc.id, sc.content, sc.created_at,
                   a.id, a.name, a.username, a.picture
            FROM space_comments sc
            JOIN auth a ON sc.user_id = a.id
            WHERE sc.id = %s
            """,
            [comment_id]
        )
        row = cur.fetchone()
  comment = {
        'id': row[0],
        'content': _esc(row[1] or ''),
        'author': {
            'id': row[3],
            'name': _esc(row[4] or ''),
            'username': _esc(row[5] or ''),
            'picture': _media_url(row[6]),
        },
        'time_ago': 'Just now',
        'created_at': row[2].strftime('%Y-%m-%d %H:%M:%S') if row[2] else None,
    }
  return JsonResponse({'success': True, 'comment': comment})
@login_required
@require_POST


def api_posts_delete_comment(request):
  """POST /api/posts/comments/delete/ — soft-delete a user post comment."""
  import json as _json
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    comment_id = int(data.get('comment_id') or 0)
    client_post_id = int(data.get('post_id') or 0)
  except:
    (TypeError, ValueError)
  post_type = data.get('type') or 'user'
  user_id = request.user.id
  if comment_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid comment ID'})
  if post_type != 'user':
    return JsonResponse({'success': False, 'error': 'Page posts not supported yet'})
  with connection.cursor() as cur:
        # Look up the comment (owner + its real post_id)
        cur.execute(
            "SELECT user_id, post_id FROM space_comments WHERE id = %s",
            [comment_id]
        )
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Comment not found'})

        owner_id, actual_post_id = row

        # Trust the comment row over what the client sent
        post_id = actual_post_id or client_post_id
        if post_id <= 0:
            return JsonResponse({'success': False, 'error': 'Invalid post ID'})

        # Authorization: owner or admin
        if owner_id != user_id:
            cur.execute("SELECT role FROM auth WHERE id = %s", [user_id])
            role_row = cur.fetchone()
            if not role_row or role_row[0] != 'admin':
                return JsonResponse({'success': False, 'error': 'Not authorized'})

        _cascade_delete_notifications([f'%comment_id={comment_id}%', f'%comment={comment_id}%'])

        # Soft-delete the comment
        cur.execute(
            "UPDATE space_comments SET is_deleted = 1 WHERE id = %s",
            [comment_id]
        )

        # Decrement post comment counter
        cur.execute(
            "UPDATE space_posts "
            "SET comments_count = GREATEST(comments_count - 1, 0) "
            "WHERE post_id = %s",
            [post_id]
        )
  return JsonResponse({'success': True, 'message': 'Comment deleted successfully'})
@login_required
@require_POST


def api_posts_vote_poll(request):
  """POST /api/posts/vote/ — vote or change vote on a poll."""
  import json as _json
  from datetime import datetime
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    post_id = int(data.get('post_id') or 0)
    option_index = int(data.get('option_index') if data.get('option_index') is not None else -1)
  except:
    (TypeError, ValueError)
  if post_id <= 0 or option_index < 0:
    return JsonResponse({'success': False, 'error': 'Invalid data'})
  user_id = request.user.id
  with connection.cursor() as cur:
        cur.execute(
            "SELECT id, question, options, ends_at FROM space_polls WHERE post_id = %s",
            [post_id]
        )
        poll_row = cur.fetchone()
        if not poll_row:
            return JsonResponse({'success': False, 'error': 'Poll not found'})

        poll_id, question, options_json, ends_at = poll_row

        try:
            options = _json.loads(options_json) if options_json else []
        except Exception:
            options = []

        # Normalize: PHP sometimes stores as object {"0":..., "1":...}
        if isinstance(options, dict):
            options = [options[k] for k in sorted(options.keys(), key=lambda x: int(x))]

        if not isinstance(options, list) or option_index >= len(options):
            return JsonResponse({'success': False, 'error': 'Invalid option index'})

        # Look up existing interaction row
        cur.execute(
            "SELECT id, poll_vote_index FROM space_user_interactions "
            "WHERE post_id = %s AND user_id = %s",
            [post_id, user_id]
        )
        ix_row = cur.fetchone()

        if ix_row and ix_row[1] is not None:
            # Changing vote — decrement old
            old_index = int(ix_row[1])
            if 0 <= old_index < len(options):
                old_votes = int(options[old_index].get('votes', 0) or 0)
                options[old_index]['votes'] = max(0, old_votes - 1)
            cur.execute(
                "UPDATE space_user_interactions SET poll_vote_index = %s WHERE id = %s",
                [option_index, ix_row[0]]
            )
        elif ix_row:
            # Row exists but no vote yet — just set the vote
            cur.execute(
                "UPDATE space_user_interactions SET poll_vote_index = %s WHERE id = %s",
                [option_index, ix_row[0]]
            )
        else:
            # Brand new interaction row
            cur.execute(
                "INSERT INTO space_user_interactions (user_id, post_id, poll_vote_index) "
                "VALUES (%s, %s, %s)",
                [user_id, post_id, option_index]
            )

        # Increment new option
        new_votes = int(options[option_index].get('votes', 0) or 0)
        options[option_index]['votes'] = new_votes + 1

        # Recompute total + percentages
        total_votes = sum(int(o.get('votes', 0) or 0) for o in options)
        for o in options:
            v = int(o.get('votes', 0) or 0)
            o['percentage'] = round((v / total_votes) * 100) if total_votes > 0 else 0

        cur.execute(
            "UPDATE space_polls SET options = %s WHERE id = %s",
            [_json.dumps(options), poll_id]
        )
  # ends_in computation (mirrors PHP)
  ends_in = None
  if ends_at:
    try:
      ends_dt = ends_at
      if isinstance(ends_dt, str):
        ends_dt = datetime.strptime(ends_dt, '%Y-%m-%d %H:%M:%S')
      now = datetime.now()
      if ends_dt > now:
        secs = int((ends_dt - now).total_seconds())
        if secs >= 86400:
          ends_in = f'{secs // 86400} days'
        elif secs >= 3600:
          ends_in = f'{secs // 3600} hours'
        elif secs >= 60:
          ends_in = f'{secs // 60} minutes'
        else:
          ends_in = 'Less than a minute'
    except:
      Exception
  return JsonResponse({
        'success': True,
        'poll': {
            'question': question,
            'options': options,
            'total_votes': total_votes,
            'user_vote': option_index,
            'ends_in': ends_in,
        }
    })
@login_required
@require_POST


def api_posts_delete(request):
  """POST /api/posts/delete/ — soft-delete a user post + cascade cleanup."""
  import json as _json
  try:
    data = _json.loads(request.body)
  except:
    Exception
  try:
    post_id = int(data.get('post_id') or 0)
  except:
    (TypeError, ValueError)
  post_type = data.get('type') or 'user'
  user_id = request.user.id
  if post_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid post ID'})
  if post_type != 'user':
    return JsonResponse({'success': False, 'error': 'Page posts not supported yet'})
  with connection.cursor() as cur:
        # Ownership check
        cur.execute("SELECT user_id FROM space_posts WHERE post_id = %s", [post_id])
        row = cur.fetchone()
        if not row or row[0] != user_id:
            return JsonResponse({'success': False, 'error': 'Not authorized'})

                # Collect media keys so we can delete them from S3
        cur.execute("SELECT media_url FROM space_media WHERE post_id = %s", [post_id])
        media_rows = cur.fetchall() or []

        # Extract S3 keys (media_url stores the key directly, e.g. "uploads/space_posts/xxx.jpg")
        s3_keys = []
        for row in media_rows:
            raw = (row[0] or '').strip()
            if not raw or raw.startswith('http'):
                continue
            # Normalise: strip leading slash, keep uploads/... path as-is
            s3_keys.append(raw.lstrip('/'))

        _cascade_delete_notifications([f'/post/{post_id}/%', f'%post_id={post_id}%'])

        # Cascade cleanup — same order as PHP
        cur.execute("DELETE FROM space_media WHERE post_id = %s", [post_id])

        cur.execute("DELETE FROM space_polls WHERE post_id = %s", [post_id])
        cur.execute("DELETE FROM space_user_interactions WHERE post_id = %s", [post_id])

        # Soft delete the post
        cur.execute("UPDATE space_posts SET is_deleted = 1 WHERE post_id = %s", [post_id])
        s3_deleted = _delete_from_s3(s3_keys) if s3_keys else 0

        message = 'Post deleted successfully'
        if media_rows:
            message += f'. {s3_deleted}/{len(media_rows)} S3 file(s) removed'
        return JsonResponse({'success': True, 'message': message})


@login_required
def api_posts_get_count(request):
  """GET /api/posts/count/ — total posts by current user (space + page)."""
  user_id = request.user.id
  with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM space_posts WHERE user_id = %s AND is_deleted = 0",
            [user_id]
        )
        user_count = cur.fetchone()[0] or 0

        try:
            cur.execute(
                "SELECT COUNT(*) FROM page_posts WHERE creator_id = %s",
                [user_id]
            )
            page_count = cur.fetchone()[0] or 0
        except Exception:
            page_count = 0
  return JsonResponse({'success': True, 'count': user_count + page_count})


@login_required
def api_posts_get(request):
    """GET /api/posts/get/?post_id=X — single user post for edit modal + view_post."""
    try:
        post_id = int(request.GET.get('post_id') or 0)
    except (TypeError, ValueError):
        post_id = 0

    if post_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid post ID'})

    user_id = request.user.id

    with connection.cursor() as cur:
        cur.execute("""
            SELECT
                p.post_id, p.user_id, p.content, p.created_at, p.updated_at,
                p.likes_count, p.dislikes_count, p.comments_count, p.views_count, p.shares_count,
                a.id AS a_id, a.name AS a_name, a.username AS a_username, a.picture AS a_picture,
                ui.reaction AS user_reaction, ui.has_saved AS is_saved
            FROM space_posts p
            LEFT JOIN auth a ON p.user_id = a.id
            LEFT JOIN space_user_interactions ui
                ON ui.post_id = p.post_id AND ui.user_id = %s
            WHERE p.post_id = %s AND p.is_deleted = 0
        """, [user_id, post_id])
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Post not found'})

        (pid, post_user_id, content, created_at, updated_at,
         likes, dislikes, comments, views, shares,
         a_id, a_name, a_username, a_picture,
         user_reaction, is_saved) = row

        # Media for this post
        cur.execute(
            "SELECT media_url, media_type, mime_type FROM space_media "
            "WHERE post_id = %s ORDER BY id ASC",
            [post_id]
        )
        media_rows = cur.fetchall()

        # Poll for this post (if any)
        cur.execute(
            "SELECT question, options, ends_at FROM space_polls WHERE post_id = %s",
            [post_id]
        )
        poll_row = cur.fetchone()

        # Did this user vote on the poll?
        user_vote = None
        if poll_row:
            cur.execute(
                "SELECT poll_vote_index FROM space_user_interactions "
                "WHERE post_id = %s AND user_id = %s AND poll_vote_index IS NOT NULL",
                [post_id, user_id]
            )
            vr = cur.fetchone()
            if vr:
                user_vote = vr[0]

    # ---- Build media list ----
    S3_BASE = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/'
    media = []
    for m in media_rows:
        raw = m[0] or ''
        if raw and not raw.startswith('http'):
            if raw.startswith('uploads/'):
                url = S3_BASE + raw
            else:
                url = S3_BASE + 'uploads/space_posts/' + raw
        else:
            url = raw
        m_type = m[1] or 'image'
        m_thumb = _get_thumbnail_url(url, m_type)
        media.append({
            'type': m_type,
            'url': url,
            'thumbnail_url': m_thumb,
            'mime_type': m[2] or 'image/jpeg',
        })

    # ---- Build poll dict ----
    poll = None
    if poll_row:
        import json as _json
        from datetime import datetime as _dt

        question, options_json, ends_at = poll_row
        try:
            options = _json.loads(options_json) if options_json else []
        except Exception:
            options = []

        # PHP sometimes stores as object {"0": {...}, "1": {...}}
        if isinstance(options, dict):
            options = [options[k] for k in sorted(options.keys(), key=lambda x: int(x))]
        if not isinstance(options, list):
            options = []

        total_votes = 0
        for o in options:
            if isinstance(o, dict):
                total_votes += int(o.get('votes', 0) or 0)
        for o in options:
            if isinstance(o, dict):
                v = int(o.get('votes', 0) or 0)
                o['percentage'] = round((v / total_votes) * 100) if total_votes > 0 else 0

        ends_in = None
        if ends_at:
            try:
                ends_dt = ends_at
                if isinstance(ends_dt, str):
                    ends_dt = _dt.strptime(ends_dt, '%Y-%m-%d %H:%M:%S')
                now = _dt.now()
                if ends_dt > now:
                    secs = int((ends_dt - now).total_seconds())
                    if secs >= 86400:
                        ends_in = f'{secs // 86400} days'
                    elif secs >= 3600:
                        ends_in = f'{secs // 3600} hours'
                    elif secs >= 60:
                        ends_in = f'{secs // 60} minutes'
                    else:
                        ends_in = 'Less than a minute'
            except Exception:
                ends_in = None

        poll = {
            'question': question,
            'options': options,
            'total_votes': total_votes,
            'user_vote': user_vote,
            'ends_in': ends_in,
        }

    # ---- Author picture ----
    author_picture = (
        f'{S3_BASE}uploads/{a_picture}' if a_picture
        else '/static/images/avatars/default.png'
    )

    return JsonResponse({
        'success': True,
        'post': {
            'id': pid,
            'content': content or '',
            'author': {
                'id': a_id or post_user_id,
                'name': a_name or a_username or 'User',
                'username': a_username or 'user',
                'picture': author_picture,
            },
            'time_ago': _format_time_ago(created_at),
            'is_edited': bool(updated_at and created_at and updated_at > created_at),
            'media': media,
            'poll': poll,
            'views': views or 0,
            'user_reaction': user_reaction,
            'is_saved': bool(is_saved),
            'likes': likes or 0,
            'dislikes': dislikes or 0,
            'comments_count': comments or 0,
            'shares': shares or 0,
        }
    })

@login_required
def view_post_view(request, post_id):
    """Renders the single-post page (/post/<id>/)."""
    user = request.user

    # Confirm the post exists and isn't deleted
    with connection.cursor() as cur:
        cur.execute(
            "SELECT post_id FROM space_posts WHERE post_id = %s AND is_deleted = 0",
            [post_id]
        )
        if not cur.fetchone():
            return redirect('/feed/')

    # Friends — for @mention autocomplete in comments
    friends = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON (f.sender_id = a.id OR f.receiver_id = a.id)
            WHERE (f.sender_id = %s OR f.receiver_id = %s)
              AND f.status = 'accepted'
              AND a.id != %s
            LIMIT 50
        """, [user.id, user.id, user.id])
        for row in cur.fetchall():
            pic = row[3]
            friends.append({
                'id': row[0],
                'name': row[1] or '',
                'username': row[2] or '',
                'picture': (
                    f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'
                    if pic else '/static/images/avatars/default.png'
                ),
            })

    return render(request, 'dashboard/view_post.html', {
        'active_page': 'view_post',
        'post_id': post_id,
        'friends_json': json.dumps(friends),
        'svg_logo': _load_svg_logo(),
        'user': user,
    })

@login_required
@require_POST
def api_posts_edit(request):
  """POST /api/posts/edit/ — edit a user post (multipart form)."""
  post_id = int(request.POST.get('post_id') or 0)
  content = (request.POST.get('content') or '').strip()
  post_type = request.POST.get('type') or 'user'
  user_id = request.user.id
  if post_id <= 0:
    return JsonResponse({'success': False, 'error': 'Invalid post ID'})
  if post_type != 'user':
    return JsonResponse({'success': False, 'error': 'Page posts not supported yet'})
  S3_BASE = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/'
  def to_full(raw):
    if not raw:
      return ""
    if raw.startswith('http'):
      return raw
    if raw.startswith('uploads/'):
      return S3_BASE + raw
    return S3_BASE + "uploads/space_posts/" + raw
  with connection.cursor() as cur:
        # Ownership check
        cur.execute("SELECT user_id FROM space_posts WHERE post_id = %s", [post_id])
        row = cur.fetchone()
        if not row or row[0] != user_id:
            return JsonResponse({'success': False, 'error': 'Not authorized'})

        # Content update — set updated_at so the edit badge appears
        cur.execute(
            "UPDATE space_posts SET content = %s, updated_at = NOW() WHERE post_id = %s",
            [content, post_id]
        )

        # Handle existing_media (comma-separated URLs the user wants to keep)
        existing_raw = (request.POST.get('existing_media') or '').strip()
        existing_urls = [u.strip() for u in existing_raw.split(',') if u.strip()] if existing_raw else []

        cur.execute("SELECT id, media_url FROM space_media WHERE post_id = %s", [post_id])
        media_rows = cur.fetchall()

        if existing_urls:
            for mid, murl in media_rows:
                if to_full(murl) not in existing_urls:
                    cur.execute("DELETE FROM space_media WHERE id = %s", [mid])
        else:
            cur.execute("DELETE FROM space_media WHERE post_id = %s", [post_id])
  # Handle new file uploads — actually push them to S3 and DB
  new_files = request.FILES.getlist('new_media[]') or request.FILES.getlist('new_media')
  s3_notes = []
  s3_failures = []
  for f in new_files:
    key = _upload_to_s3(f)
    if key:
      mime = f.content_type or 'application/octet-stream'
      media_type = _classify_media(mime)
      with connection.cursor() as cur:
        cur.execute(
          "INSERT INTO space_media (post_id, media_url, media_type, mime_type) "
          "VALUES (%s, %s, %s, %s)",
          [post_id, key, media_type, mime]
        )
      s3_notes.append(f.name)
    else:
      s3_failures.append(f.name)
  # Rebuild the post JSON directly (no decorator hackery)
  with connection.cursor() as cur:
        cur.execute("""
            SELECT
                p.post_id, p.user_id, p.content, p.created_at, p.updated_at,
                p.likes_count, p.dislikes_count, p.comments_count, p.views_count, p.shares_count,
                a.id AS a_id, a.name AS a_name, a.username AS a_username, a.picture AS a_picture,
                ui.reaction AS user_reaction, ui.has_saved AS is_saved
            FROM space_posts p
            LEFT JOIN auth a ON p.user_id = a.id
            LEFT JOIN space_user_interactions ui
                ON ui.post_id = p.post_id AND ui.user_id = %s
            WHERE p.post_id = %s AND p.is_deleted = 0
        """, [user_id, post_id])
        prow = cur.fetchone()
        if not prow:
            return JsonResponse({'success': False, 'error': 'Post not found after edit'})

        (pid, post_user_id, new_content, created_at, updated_at,
         likes, dislikes, comments, views, shares,
         a_id, a_name, a_username, a_picture,
         user_reaction, is_saved) = prow

        cur.execute(
            "SELECT media_url, media_type, mime_type FROM space_media "
            "WHERE post_id = %s ORDER BY id ASC",
            [post_id]
        )
        fresh_media = cur.fetchall()
  media = []
  for m in fresh_media:
    media.append({
            'type': m[1] or 'image',
            'url': to_full(m[0]),
            'mime_type': m[2] or 'image/jpeg',
        })
  author_picture = (
        f'{S3_BASE}uploads/{a_picture}' if a_picture
        else '/static/images/avatars/default.png'
    )
  return JsonResponse({
        'success': True,
        'post': {
            'id': pid,
            'content': new_content or '',
            'author': {
                'id': a_id or post_user_id,
                'name': a_name or a_username or 'User',
                'username': a_username or 'user',
                'picture': author_picture,
            },
            'time_ago': _format_time_ago(created_at),
            'is_edited': bool(updated_at and created_at and updated_at > created_at),
            'media': media,
            'poll': None,
            'views': views or 0,
            'user_reaction': user_reaction,
            'is_saved': bool(is_saved),
            'likes': likes or 0,
            'dislikes': dislikes or 0,
            'comments_count': comments or 0,
            'shares': shares or 0,
        }
    })


# ============================================================
# NOTIFICATIONS
# ============================================================

@login_required
def api_notifications_count(request):
    """GET /api/notifications/count/ — unread notification count."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM notifications "
            "WHERE user_id = %s AND is_read = 0 "
            "AND (expires_at IS NULL OR expires_at > NOW())",
            [user_id]
        )
        count = cur.fetchone()[0] or 0
    return JsonResponse({'success': True, 'unread_count': count})


@login_required
@require_POST
def api_notifications_delete(request):
    """POST /api/notifications/delete/ — permanently dismiss a notification."""
    try:
        notif_id = int(request.POST.get('notification_id') or 0)
    except (TypeError, ValueError):
        notif_id = 0

    if notif_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid notification ID'})

    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "DELETE FROM notifications WHERE id = %s AND user_id = %s",
            [notif_id, user_id]
        )
            # Sync to Firebase
    try:
        from .firebase_push import delete_notification
        delete_notification(user_id, notif_id)
    except Exception:
        pass

    return JsonResponse({'success': True})
@login_required
@require_POST
def api_notifications_mark_read(request, notif_id):
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "UPDATE notifications SET is_read = 1 WHERE id = %s AND user_id = %s",
            [notif_id, user_id]
        )
        cur.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND is_read = 0 AND (expires_at IS NULL OR expires_at > NOW())",
            [user_id]
        )
        new_count = cur.fetchone()[0] or 0

    try:
        from .firebase_push import mark_notification_read
        mark_notification_read(user_id, notif_id)
    except Exception:
        pass

    return JsonResponse({'success': True, 'unread_count': new_count})


@login_required
@require_POST
def api_notifications_read_all(request):
    """POST /api/notifications/read-all/ — mark all notifications as read."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "UPDATE notifications SET is_read = 1 "
            "WHERE user_id = %s AND is_read = 0",
            [user_id]
        )
    # Sync to Firebase
    try:
        from .firebase_push import mark_all_notifications_read
        mark_all_notifications_read(user_id)
    except Exception:
        pass

    return JsonResponse({'success': True})


def _full_avatar_url(raw):
    """Convert filename or partial path from auth.picture into full S3 URL."""
    if not raw:
        return ''
    raw_str = str(raw).strip()
    if not raw_str:
        return ''
    if raw_str.startswith('http://') or raw_str.startswith('https://'):
        return raw_str
    if raw_str.startswith('uploads/'):
        return f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{raw_str}'
    return f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{raw_str}'


@login_required
def api_notifications_list(request):
    """GET /api/notifications/list/ — full notification list + unread count with actor info & cleaned titles."""
    user_id = request.user.id
    with connection.cursor() as cur:
        # Unread count
        cur.execute(
            "SELECT COUNT(*) FROM notifications "
            "WHERE user_id = %s AND is_read = 0 "
            "AND (expires_at IS NULL OR expires_at > NOW())",
            [user_id]
        )
        unread = cur.fetchone()[0] or 0

        # List (unread first, newest first) with auth JOIN for actor avatar
        cur.execute(
            """
            SELECT n.id, n.type, n.title, n.message, n.icon, n.link, n.is_read, n.created_at,
                   TIMESTAMPDIFF(SECOND, n.created_at, NOW()) AS seconds_ago,
                   a.id AS actor_id, a.name AS actor_name, 
                   a.username AS actor_username, a.picture AS actor_picture
            FROM notifications n
            LEFT JOIN auth a ON a.id = n.actor_id
            WHERE n.user_id = %s 
              AND (n.expires_at IS NULL OR n.expires_at > NOW())
            ORDER BY n.is_read ASC, n.created_at DESC
            LIMIT 20
            """,
            [user_id]
        )
        rows = cur.fetchall()

    def _time_ago(seconds):
        if seconds is None:
            return ''
        try:
            s = int(seconds)
        except (ValueError, TypeError):
            return ''
        if s < 0:           return 'Just now'
        if s < 60:          return 'Just now'
        if s < 3600:        return f'{s // 60}m ago'
        if s < 86400:       return f'{s // 3600}h ago'
        if s < 604800:      return f'{s // 86400}d ago'
        return f'{s // 604800}w ago'

    import re as _re

    def _migrate_link(raw):
        """Map legacy PHP paths to Django URLs."""
        if not raw or raw == '#':
            return '/feed/'
        l = raw.strip()
        if '/model/user_profile.php' in l:
            m = _re.search(r'user_id=(\d+)', l)
            if m:
                return f'/user/{m.group(1)}/'
            return '/feed/'
        if '/model/friends.php' in l:
            return '/friends/'
        if '/model/shoutbox.php' in l:
            return '/shoutbox/'
        if '/model/chat.php' in l:
            return '/chat/'
        if '/model/' in l or l.startswith('/view/'):
            return '/feed/'
        return l  # already a Django URL

    def _clean_title(raw_title, n_type):
        t = (raw_title or '').strip()
        if t.startswith('??'):
            t = t[2:].strip()
            emoji_map = {
                'page_follow': '📄',
                'page_message': '📩',
                'reaction': '❤️',
                'comment': '💬',
                'friend_request': '👥',
                'friend_request_accepted': '👥',
                'shoutbox_mention': '📢',
                'mention': '📢',
            }
            prefix = emoji_map.get(n_type, '🔔')
            return f'{prefix} {t}' if t else prefix
        return t

    notifications = []
    for r in rows:
        raw_type = r[1] or 'general'
        notifications.append({
            'id': r[0],
            'type': raw_type,
            'title': _clean_title(r[2], raw_type),
            'message': r[3] or '',
            'icon': r[4] or 'bell',
            'link': _migrate_link(r[5]),
            'is_read': bool(r[6]),
            'time_ago': _time_ago(r[8]),
            'actor_id': r[9],
            'actor_name': r[10] or '',
            'actor_username': r[11] or '',
            'actor_picture': _full_avatar_url(r[12]),
        })

    return JsonResponse({
        'success': True,
        'unread_count': unread,
        'notifications': notifications,
    })
# ============================================================
# NOTIFICATIONS — Full page and extended endpoints (Task 16)
# ============================================================

@login_required
def notifications_page(request):
    """GET /notifications/ — Dedicated full-page notification center."""
    user_id = request.user.id
    with connection.cursor() as cur:
        # Total unread count
        cur.execute(
            "SELECT COUNT(*) FROM notifications "
            "WHERE user_id = %s AND is_read = 0 "
            "AND (expires_at IS NULL OR expires_at > NOW())",
            [user_id]
        )
        unread_count = cur.fetchone()[0] or 0

        # Total notifications count
        cur.execute(
            "SELECT COUNT(*) FROM notifications "
            "WHERE user_id = %s "
            "AND (expires_at IS NULL OR expires_at > NOW())",
            [user_id]
        )
        total_count = cur.fetchone()[0] or 0

    return render(request, 'dashboard/notifications.html', {
        'unread_count': unread_count,
        'total_count': total_count,
        'active_page': 'notifications',
        'svg_logo': _load_svg_logo(),
    })


@login_required
def api_notifications_page(request):
    """
    GET /api/notifications/page/?page=1&filter=all&limit=20
    Filters: all | unread | mentions | friend_requests | read
    Response: { success: true, notifications: [...], page: 1, has_more: bool, total: N, unread_count: N }
    """
    user_id = request.user.id
    try:
        page = max(1, int(request.GET.get('page') or 1))
    except (TypeError, ValueError):
        page = 1

    try:
        limit = min(50, max(5, int(request.GET.get('limit') or 20)))
    except (TypeError, ValueError):
        limit = 20

    filter_tab = (request.GET.get('filter') or 'all').strip().lower()
    offset = (page - 1) * limit

    # Base WHERE clause
    where_clauses = [
        "n.user_id = %s",
        "(n.expires_at IS NULL OR n.expires_at > NOW())"
    ]
    params = [user_id]

    # Filter logic matching PHP tabs & Django types
    if filter_tab == 'unread':
        where_clauses.append("n.is_read = 0")
    elif filter_tab == 'read':
        where_clauses.append("n.is_read = 1")
    elif filter_tab == 'mentions':
        where_clauses.append("n.type LIKE %s")
        params.append('%mention%')
    elif filter_tab == 'friend_requests':
        where_clauses.append("n.type LIKE %s")
        params.append('%friend%')

    where_sql = " AND ".join(where_clauses)

    with connection.cursor() as cur:
        # Total unread count for user (always accurate)
        cur.execute(
            "SELECT COUNT(*) FROM notifications "
            "WHERE user_id = %s AND is_read = 0 "
            "AND (expires_at IS NULL OR expires_at > NOW())",
            [user_id]
        )
        unread_count = cur.fetchone()[0] or 0

        # Total matching filter
        cur.execute(f"SELECT COUNT(*) FROM notifications n WHERE {where_sql}", params)
        total_matching = cur.fetchone()[0] or 0

        # Query paginated rows with auth JOIN for actor avatar & details
        query_sql = f"""
            SELECT n.id, n.type, n.title, n.message, n.icon, n.link, n.is_read, n.created_at,
                   TIMESTAMPDIFF(SECOND, n.created_at, NOW()) AS seconds_ago,
                   a.id AS actor_id, a.name AS actor_name, a.username AS actor_username, 
                   a.picture AS actor_picture
            FROM notifications n
            LEFT JOIN auth a ON a.id = n.actor_id
            WHERE {where_sql}
            ORDER BY n.created_at DESC
            LIMIT %s OFFSET %s
        """
        cur.execute(query_sql, params + [limit + 1, offset])
        rows = cur.fetchall()

    has_more = len(rows) > limit
    display_rows = rows[:limit]

    # Mark is_seen = 1 for returned rows (matches PHP behavior)
    row_ids = [r[0] for r in display_rows]
    if row_ids:
        try:
            with connection.cursor() as cur:
                format_strings = ','.join(['%s'] * len(row_ids))
                cur.execute(
                    f"UPDATE notifications SET is_seen = 1 WHERE id IN ({format_strings}) AND user_id = %s",
                    row_ids + [user_id]
                )
        except Exception as e:
            _log.warning(f"Failed to update is_seen for notifications: {e}")

    def _time_ago(seconds):
        if seconds is None:
            return ''
        try:
            s = int(seconds)
        except (ValueError, TypeError):
            return ''
        if s < 0:           return 'Just now'
        if s < 60:          return 'Just now'
        if s < 3600:        return f'{s // 60}m ago'
        if s < 86400:       return f'{s // 3600}h ago'
        if s < 604800:      return f'{s // 86400}d ago'
        return f'{s // 604800}w ago'

    import re as _re

    def _migrate_link(raw):
        if not raw or raw == '#':
            return '/feed/'
        l = raw.strip()
        if '/model/user_profile.php' in l:
            m = _re.search(r'user_id=(\d+)', l)
            if m:
                return f'/user/{m.group(1)}/'
            return '/feed/'
        if '/model/friends.php' in l:
            return '/friends/'
        if '/model/shoutbox.php' in l:
            return '/shoutbox/'
        if '/model/chat.php' in l:
            return '/chat/'
        if '/model/' in l or l.startswith('/view/'):
            return '/feed/'
        return l

    def _clean_title(raw_title, n_type):
        t = (raw_title or '').strip()
        if t.startswith('??'):
            t = t[2:].strip()
            emoji_map = {
                'page_follow': '📄',
                'page_message': '📩',
                'reaction': '❤️',
                'comment': '💬',
                'friend_request': '👥',
                'friend_request_accepted': '👥',
                'shoutbox_mention': '📢',
                'mention': '📢',
            }
            prefix = emoji_map.get(n_type, '🔔')
            return f'{prefix} {t}' if t else prefix
        return t

    notifications = []
    for r in display_rows:
        raw_type = r[1] or 'general'
        notifications.append({
            'id': r[0],
            'type': raw_type,
            'title': _clean_title(r[2], raw_type),
            'message': r[3] or '',
            'icon': r[4] or 'bell',
            'link': _migrate_link(r[5]),
            'is_read': bool(r[6]),
            'time_ago': _time_ago(r[8]),
            'actor_id': r[9],
            'actor_name': r[10] or '',
            'actor_username': r[11] or '',
            'actor_picture': _full_avatar_url(r[12]),
        })
    return JsonResponse({
        'success': True,
        'notifications': notifications,
        'page': page,
        'has_more': has_more,
        'total': total_matching,
        'unread_count': unread_count,
    })


@login_required
@require_POST
def api_notifications_clear_all(request):
    """
    POST /api/notifications/clear-all/
    Permanently deletes all notifications for user in DB and Firebase.
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        # Fetch IDs for individual Firebase node removal
        cur.execute("SELECT id FROM notifications WHERE user_id = %s", [user_id])
        notif_ids = [r[0] for r in cur.fetchall()]

        # Truncate notifications in database
        cur.execute("DELETE FROM notifications WHERE user_id = %s", [user_id])
        deleted_count = cur.rowcount

    # Sync to Firebase: delete all notification nodes and reset unread count to 0
    try:
        from . import firebase_push
        for nid in notif_ids:
            try:
                firebase_push.delete_notification(user_id, nid)
            except Exception:
                pass
        # Force Firebase unread_counts/{uid} = 0
        firebase_push.set_unread_count(user_id, 0)
    except Exception as e:
        _log.warning(f"api_notifications_clear_all Firebase sync error: {e}")

    return JsonResponse({
        'success': True,
        'deleted': deleted_count,
    })

# ============================================================
# FRIENDS — Read-only endpoints
# ============================================================

@login_required
def api_friends_counts(request):
    """GET /api/friends/counts/ — counts for friends, pending, sent."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM friends "
            "WHERE (sender_id = %s OR receiver_id = %s) AND status = 'accepted'",
            [user_id, user_id]
        )
        friends_count = cur.fetchone()[0] or 0

        cur.execute(
            "SELECT COUNT(*) FROM friends "
            "WHERE receiver_id = %s AND status = 'pending'",
            [user_id]
        )
        pending_count = cur.fetchone()[0] or 0

        cur.execute(
            "SELECT COUNT(*) FROM friends "
            "WHERE sender_id = %s AND status = 'pending'",
            [user_id]
        )
        sent_count = cur.fetchone()[0] or 0

    return JsonResponse({
        'success': True,
        'friends': friends_count,
        'pending': pending_count,
        'sent': sent_count,
    })


@login_required
def api_friends_check(request):
    """GET /api/friends/check/?friend_id=X — are we friends?"""
    try:
        friend_id = int(request.GET.get('friend_id') or 0)
    except (TypeError, ValueError):
        friend_id = 0

    if friend_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid friend ID'})

    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "SELECT id FROM friends "
            "WHERE status = 'accepted' "
            "AND ((sender_id = %s AND receiver_id = %s) "
            "  OR (sender_id = %s AND receiver_id = %s))",
            [user_id, friend_id, friend_id, user_id]
        )
        row = cur.fetchone()

    return JsonResponse({
        'success': True,
        'are_friends': row is not None,
    })


@login_required
def api_friends_get_id(request):
    """GET /api/friends/get-friend-id/?friendship_id=X — get the other user's ID."""
    try:
        friendship_id = int(request.GET.get('friendship_id') or 0)
    except (TypeError, ValueError):
        friendship_id = 0

    if friendship_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid friendship ID'})

    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute(
            "SELECT CASE "
            "  WHEN sender_id = %s THEN receiver_id "
            "  ELSE sender_id "
            "END "
            "FROM friends "
            "WHERE id = %s AND (sender_id = %s OR receiver_id = %s)",
            [user_id, friendship_id, user_id, user_id]
        )
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Friendship not found'})

    return JsonResponse({'success': True, 'friend_id': row[0]})

# ============================================================
# FRIENDS — Write endpoints
# ============================================================


def _cascade_delete_notifications(link_patterns):
    """Delete notifications matching any of the link patterns from MariaDB and Firebase."""
    if not link_patterns:
        return
    deleted_items = []
    with connection.cursor() as cur:
        for pat in link_patterns:
            cur.execute("SELECT id, user_id FROM notifications WHERE link LIKE %s", [pat])
            rows = cur.fetchall()
            for nid, uid in rows:
                deleted_items.append((nid, uid))
            cur.execute("DELETE FROM notifications WHERE link LIKE %s", [pat])

    if deleted_items:
        try:
            from .firebase_push import delete_notification
            for nid, uid in deleted_items:
                delete_notification(uid, nid)
        except Exception:
            pass

def _notify(user_id, notif_type, title, message, icon='bell', link='#', actor_id=None):
    """Insert a notification row + push via Celery with deduplication and block checks."""
    import logging
    _log = logging.getLogger(__name__)

    # 1. Clean link: reject non-slashed or undefined links
    if not link or not str(link).startswith('/') or 'undefined' in str(link):
        link = '/feed/'

    # 2. Self-notification guard
    if actor_id is not None and int(user_id) == int(actor_id):
        return None

    # 3. Block check
    if actor_id is not None:
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT 1 FROM blocks 
                    WHERE (blocker_id = %s AND blocked_id = %s) 
                       OR (blocker_id = %s AND blocked_id = %s) 
                    LIMIT 1
                """, [actor_id, user_id, user_id, actor_id])
                if cur.fetchone():
                    return None
        except Exception as e:
            _log.warning(f"_notify block check failed: {e}")

    # 4. Deduplication: skip if unread notification exists for same (user_id, type, link) in past 24h (or 60m for chat_message)
    try:
        dedup_interval = 'INTERVAL 60 MINUTE' if notif_type == 'chat_message' else 'INTERVAL 24 HOUR'
        with connection.cursor() as cur:
            cur.execute(f"""
                SELECT id FROM notifications 
                WHERE user_id = %s AND type = %s AND link = %s 
                  AND is_read = 0 AND created_at > NOW() - {dedup_interval} 
                LIMIT 1
            """, [user_id, notif_type, link])
            if cur.fetchone():
                return None
    except Exception as e:
        _log.warning(f"_notify dedup check failed: {e}")

    # 5. Insert row with expires_at = NOW() + INTERVAL 30 DAY
    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO notifications 
            (user_id, actor_id, type, title, message, icon, link, is_read, expires_at) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, 0, NOW() + INTERVAL 30 DAY)
        """, [user_id, actor_id, notif_type, title, message, icon, link])
        notif_id = cur.lastrowid

    # 6. Fetch actor profile & push via Celery with enriched payload
    actor_name = ''
    actor_username = ''
    actor_picture = ''
    if actor_id:
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT name, username, picture FROM auth WHERE id = %s", [actor_id])
                a_row = cur.fetchone()
                if a_row:
                    actor_name = a_row[0] or ''
                    actor_username = a_row[1] or ''
                    actor_picture = _full_avatar_url(a_row[2])
        except Exception as e:
            _log.warning(f"_notify actor lookup failed: {e}")

    # Clean title before pushing to Firebase (strip legacy '??' prefix)
    clean_push_title = title or ''
    if clean_push_title.startswith('??'):
        clean_push_title = clean_push_title[2:].strip()
        emoji_map = {
            'page_follow': '📄',
            'page_message': '📩',
            'chat_message': '💬',
            'reaction': '❤️',
            'comment': '💬',
            'friend_request': '👥',
            'friend_request_accepted': '👥',
            'shoutbox_mention': '📢',
            'mention': '📢',
        }
        prefix = emoji_map.get(notif_type, '🔔')
        clean_push_title = f"{prefix} {clean_push_title}" if clean_push_title else prefix

    try:
        from landing.tasks import send_push_notification
        send_push_notification.delay(
            user_id=user_id,
            title=clean_push_title,
            body=message,
            link=link,
            notif_id=notif_id,
            actor_id=actor_id,
            actor_name=actor_name,
            actor_username=actor_username,
            actor_picture=actor_picture,
            notif_type=notif_type,
        )
    except Exception as e:
        _log.warning(f"_notify celery dispatch failed: {e}")

    return notif_id


@login_required
@require_POST
def api_friends_send_request(request):
    """POST /api/friends/send-request/ — send a friend request."""
    user_id = request.user.id
    try:
        friend_id = int(request.POST.get('user_id') or 0)
    except (TypeError, ValueError):
        friend_id = 0

    if friend_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid user ID'})

    if friend_id == user_id:
        return JsonResponse({'success': False, 'error': 'You cannot add yourself as a friend'})

    with connection.cursor() as cur:
        # Existing friendship in either direction?
        cur.execute(
            "SELECT id, status, sender_id FROM friends "
            "WHERE (sender_id = %s AND receiver_id = %s) "
            "   OR (sender_id = %s AND receiver_id = %s)",
            [user_id, friend_id, friend_id, user_id]
        )
        existing = cur.fetchone()

        if existing:
            status = existing[1]
            sender_id = existing[2]
            if status == 'accepted':
                return JsonResponse({'success': False, 'error': 'You are already friends with this user'})
            if status == 'pending':
                if sender_id == user_id:
                    return JsonResponse({'success': False, 'error': 'Friend request already sent'})
                return JsonResponse({'success': False, 'error': 'This user has already sent you a friend request'})

        # Blocked either way?
        cur.execute(
            "SELECT id FROM blocks "
            "WHERE (blocker_id = %s AND blocked_id = %s) "
            "   OR (blocker_id = %s AND blocked_id = %s)",
            [user_id, friend_id, friend_id, user_id]
        )
        if cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Cannot send friend request to blocked user'})

        # All checks passed — insert
        cur.execute(
            "INSERT INTO friends (sender_id, receiver_id, status, created_at) "
            "VALUES (%s, %s, 'pending', NOW())",
            [user_id, friend_id]
        )

    # Side effect: notify the receiver
    sender_name = request.user.name or request.user.username or 'Someone'
    _notify(
        user_id=friend_id,
        notif_type='friend_request',
        title='👥 New Friend Request',
        message=f'{sender_name} wants to be your friend',
        icon='user-friends',
        link='/friends/',
        actor_id=request.user.id,
    )

    # Look up the recipient's name for the confirmation message
    with connection.cursor() as cur:
        cur.execute("SELECT name, username FROM auth WHERE id = %s", [friend_id])
        row = cur.fetchone()
    recipient_name = (row[0] or row[1]) if row else 'user'

    return JsonResponse({
        'success': True,
        'message': f'Friend request sent to {recipient_name}',
    })


@login_required
@require_POST
def api_friends_accept(request):
    """POST /api/friends/accept/ — accept an incoming friend request."""
    user_id = request.user.id
    try:
        request_id = int(request.POST.get('request_id') or 0)
    except (TypeError, ValueError):
        request_id = 0

    if request_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid request ID'})

    with connection.cursor() as cur:
        # Find a pending request addressed to me
        cur.execute(
            "SELECT sender_id FROM friends "
            "WHERE id = %s AND receiver_id = %s AND status = 'pending'",
            [request_id, user_id]
        )
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Friend request not found or already processed'})

        sender_id = row[0]

        # Mark accepted
        cur.execute(
            "UPDATE friends SET status = 'accepted' WHERE id = %s",
            [request_id]
        )

    # Side effect: notify the original sender
    receiver_name = request.user.name or request.user.username or 'Someone'
    _notify(
        user_id=sender_id,
        notif_type='friend_request_accepted',
        title='👥 Friend Request Accepted',
        message=f'{receiver_name} accepted your friend request!',
        icon='user-friends',
        link='/friends/',
        actor_id=request.user.id,
    )

    return JsonResponse({
        'success': True,
        'message': 'Friend request accepted successfully',
    })


@login_required
@require_POST
def api_friends_decline(request):
    """POST /api/friends/decline/ — decline an incoming friend request."""
    user_id = request.user.id
    try:
        request_id = int(request.POST.get('request_id') or 0)
    except (TypeError, ValueError):
        request_id = 0

    if request_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid request ID'})

    with connection.cursor() as cur:
        # Delete only if: it's MY pending request (I'm the receiver)
        cur.execute(
            "DELETE FROM friends "
            "WHERE id = %s AND receiver_id = %s AND status = 'pending'",
            [request_id, user_id]
        )
        deleted = cur.rowcount

    if deleted == 0:
        return JsonResponse({'success': False, 'error': 'Friend request not found or already processed'})

    return JsonResponse({'success': True, 'message': 'Friend request declined'})


@login_required
@require_POST
def api_friends_cancel(request):
    """POST /api/friends/cancel/ — cancel an outgoing friend request."""
    user_id = request.user.id
    try:
        request_id = int(request.POST.get('request_id') or 0)
    except (TypeError, ValueError):
        request_id = 0

    if request_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid request ID'})

    with connection.cursor() as cur:
        # Delete only if: I sent it and it's still pending
        cur.execute(
            "DELETE FROM friends "
            "WHERE id = %s AND sender_id = %s AND status = 'pending'",
            [request_id, user_id]
        )
        deleted = cur.rowcount

    if deleted == 0:
        return JsonResponse({'success': False, 'error': 'Friend request not found or already processed'})

    return JsonResponse({'success': True, 'message': 'Friend request cancelled'})


@login_required
@require_POST
def api_friends_remove(request):
    """POST /api/friends/remove/ — unfriend someone by friendship_id."""
    user_id = request.user.id
    try:
        # Accept either key — JS sends friendship_id (matches PHP)
        friendship_id = int(
            request.POST.get('friendship_id')
            or request.POST.get('friend_id')
            or 0
        )
    except (TypeError, ValueError):
        friendship_id = 0

    if friendship_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid friendship ID'})

    with connection.cursor() as cur:
        # Verify: row exists, is accepted, and I'm part of it
        cur.execute(
            "SELECT sender_id, receiver_id FROM friends "
            "WHERE id = %s AND status = 'accepted' "
            "AND (sender_id = %s OR receiver_id = %s)",
            [friendship_id, user_id, user_id]
        )
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Friendship not found or you don\'t have permission'})

        # The other person's user ID
        other_user_id = row[1] if row[0] == user_id else row[0]

        # Delete the row
        cur.execute("DELETE FROM friends WHERE id = %s", [friendship_id])

    # Notify the other user (matches PHP)
    remover_name = request.user.name or request.user.username or 'Someone'
    _notify(
        user_id=other_user_id,
        notif_type='friend_removed',
        title='👤 Friend Removed',
        message=f'{remover_name} removed you as a friend.',
        icon='user-times',
        link='/friends/',
        actor_id=request.user.id,
    )

    return JsonResponse({'success': True, 'message': 'Friend removed successfully'})
# ============================================================
# FRIENDS — Page view
# ============================================================

@login_required
def friends_view(request):
    """Renders the Friends page."""
    return render(request, 'dashboard/friends.html', {
        'active_page': 'friends',
        'svg_logo': _load_svg_logo(),
    })


# ============================================================
# FRIENDS — List endpoints
# ============================================================

S3_BASE = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/'

def _user_picture(pic):
    return S3_BASE + pic if pic else '/static/images/avatars/default.png'


@login_required
@vary_on_cookie
@cache_page(15)
def api_friends_list(request):
    """GET /api/friends/list/ — accepted friends."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT
                f.id AS friendship_id,
                f.created_at,
                CASE WHEN f.sender_id = %s THEN f.receiver_id ELSE f.sender_id END AS friend_id,
                a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON a.id = CASE WHEN f.sender_id = %s THEN f.receiver_id ELSE f.sender_id END
            WHERE (f.sender_id = %s OR f.receiver_id = %s)
              AND f.status = 'accepted'
            ORDER BY f.created_at DESC
        """, [user_id, user_id, user_id, user_id])
        rows = cur.fetchall()

    friends = []
    for r in rows:
        friends.append({
            'friendship_id': r[0],
            'friend_id': r[2],
            'name': r[3] or r[4] or 'User',
            'username': r[4] or '',
            'picture': _user_picture(r[5]),
            'time_ago': _time_ago(r[1]),
        })
    return JsonResponse({'success': True, 'friends': friends})


@login_required
@vary_on_cookie
@cache_page(15)
def api_friends_pending(request):
    """GET /api/friends/pending/ — incoming friend requests."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT f.id AS request_id, f.created_at, f.sender_id,
                   a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON a.id = f.sender_id
            WHERE f.receiver_id = %s AND f.status = 'pending'
            ORDER BY f.created_at DESC
        """, [user_id])
        rows = cur.fetchall()

    pending = []
    for r in rows:
        pending.append({
            'request_id': r[0],
            'sender_id': r[2],
            'name': r[3] or r[4] or 'User',
            'username': r[4] or '',
            'picture': _user_picture(r[5]),
            'time_ago': _time_ago(r[1]),
        })
    return JsonResponse({'success': True, 'pending': pending})


@login_required
@vary_on_cookie
@cache_page(15)
def api_friends_sent(request):
    """GET /api/friends/sent/ — outgoing friend requests."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT f.id AS request_id, f.created_at, f.receiver_id,
                   a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON a.id = f.receiver_id
            WHERE f.sender_id = %s AND f.status = 'pending'
            ORDER BY f.created_at DESC
        """, [user_id])
        rows = cur.fetchall()

    sent = []
    for r in rows:
        sent.append({
            'request_id': r[0],
            'receiver_id': r[2],
            'name': r[3] or r[4] or 'User',
            'username': r[4] or '',
            'picture': _user_picture(r[5]),
            'time_ago': _time_ago(r[1]),
        })
    return JsonResponse({'success': True, 'sent': sent})


@login_required
def api_friends_suggested(request):
    """GET /api/friends/suggested/ — 10 random users to add."""
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture
            FROM auth a
            WHERE a.id != %s
              AND a.id NOT IN (
                  SELECT CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END
                  FROM friends
                  WHERE sender_id = %s OR receiver_id = %s
              )
              AND a.id NOT IN (
                  SELECT blocked_id FROM blocks WHERE blocker_id = %s
                  UNION
                  SELECT blocker_id FROM blocks WHERE blocked_id = %s
              )
            ORDER BY RAND()
            LIMIT 10
        """, [user_id, user_id, user_id, user_id, user_id, user_id])
        rows = cur.fetchall()

    users = [{
        'id': r[0],
        'name': r[1] or r[2] or 'User',
        'username': r[2] or '',
        'picture': _user_picture(r[3]),
    } for r in rows]

    return JsonResponse({'success': True, 'users': users})


@login_required
def api_friends_search(request):
    """GET /api/friends/search/?q=... — search users by name or username."""
    user_id = request.user.id
    q = (request.GET.get('q') or '').strip()

    if len(q) < 2:
        return JsonResponse({'success': True, 'users': [], 'hint': 'Enter at least 2 characters'})

    like = f'%{q}%'
    with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture
            FROM auth a
            WHERE (a.name LIKE %s OR a.username LIKE %s)
              AND a.id != %s
              AND a.id NOT IN (
                  SELECT CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END
                  FROM friends
                  WHERE (sender_id = %s OR receiver_id = %s)
                    AND status = 'accepted'
              )
              AND a.id NOT IN (
                  SELECT blocked_id FROM blocks WHERE blocker_id = %s
                  UNION
                  SELECT blocker_id FROM blocks WHERE blocked_id = %s
              )
              AND a.id NOT IN (
                  SELECT receiver_id FROM friends WHERE sender_id = %s AND status = 'pending'
                  UNION
                  SELECT sender_id FROM friends WHERE receiver_id = %s AND status = 'pending'
              )
            ORDER BY a.name
            LIMIT 20
        """, [like, like, user_id, user_id, user_id, user_id,
              user_id, user_id, user_id, user_id])
        rows = cur.fetchall()

    users = [{
        'id': r[0],
        'name': r[1] or r[2] or 'User',
        'username': r[2] or '',
        'picture': _user_picture(r[3]),
    } for r in rows]

    return JsonResponse({'success': True, 'users': users, 'query': q})

@login_required
def api_friends_recent_activity(request):
    """GET /api/friends/recent-activity/ — last 5 accepted friendships."""
    user_id = request.user.id
    with connection.cursor() as cur:
        # Recent accepted friendships
        cur.execute("""
            SELECT f.created_at,
                   CASE WHEN f.sender_id = %s THEN 'sent' ELSE 'received' END AS action_type,
                   a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON a.id = CASE WHEN f.sender_id = %s THEN f.receiver_id ELSE f.sender_id END
            WHERE (f.sender_id = %s OR f.receiver_id = %s)
              AND f.status = 'accepted'
            ORDER BY f.created_at DESC
            LIMIT 5
        """, [user_id, user_id, user_id, user_id])
        rows = cur.fetchall()

        # Online count (fake, matches PHP's behavior)
        cur.execute(
            "SELECT COUNT(*) FROM friends "
            "WHERE (sender_id = %s OR receiver_id = %s) AND status = 'accepted'",
            [user_id, user_id]
        )
        friends_count = cur.fetchone()[0] or 0

    import random
    online_count = random.randint(1, friends_count) if friends_count > 0 else 0

    activity = []
    for r in rows:
        activity.append({
            'time_ago': _time_ago(r[0]),
            'action_type': r[1],       # 'sent' or 'received'
            'name': r[2] or r[3] or 'User',
            'username': r[3] or '',
            'picture': _user_picture(r[4]),
        })

    return JsonResponse({
        'success': True,
        'activity': activity,
        'online_count': online_count,
    })


def serve_sw(request):
    """Serve the service worker from /sw.js (root) as browsers expect."""
    path = os.path.join(settings.BASE_DIR, 'static', 'sw.js')
    try:
        with open(path, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        content = "// no-op"
    return HttpResponse(content, content_type='application/javascript')


@login_required
@require_POST
def api_user_theme(request):
    """POST /api/user/theme/ — persist theme_mode + theme_color for the user."""
    mode = (request.POST.get('theme_mode') or '').strip()
    color = (request.POST.get('theme_color') or '').strip()

    updates = []
    params = []

    if mode in ('light', 'dark'):
        updates.append('theme_mode = %s')
        params.append(mode)
    if color.startswith('#') and len(color) in (4, 7):
        updates.append('theme_color = %s')
        params.append(color)

    if not updates:
        return JsonResponse({'success': False, 'error': 'Nothing to update'})

    params.append(request.user.id)
    with connection.cursor() as cur:
        cur.execute(f"UPDATE auth SET {', '.join(updates)} WHERE id = %s", params)

    return JsonResponse({'success': True})
# ============================================================
# USER PROFILE VIEWS
# ============================================================

@login_required
def user_profile_view(request, user_id=None, username=None):
    logged_user = request.user
    try:
        if username:
            profile_user = Auth.objects.get(username=username)


        elif user_id:
            profile_user = Auth.objects.get(id=user_id)
            return redirect(f'/user/{profile_user.username}/', permanent=False)

        else:
            profile_user = request.user

    except Auth.DoesNotExist:
        return redirect('/feed/')

    is_own_profile = (profile_user.id == logged_user.id)

    # Check block status
    with connection.cursor() as cur:
        cur.execute("""
            SELECT id FROM blocks 
            WHERE (blocker_id = %s AND blocked_id = %s) 
               OR (blocker_id = %s AND blocked_id = %s)
            LIMIT 1
        """, [logged_user.id, profile_user.id, profile_user.id, logged_user.id])
        is_blocked = cur.fetchone() is not None

        cur.execute("SELECT id FROM blocks WHERE blocker_id = %s AND blocked_id = %s",
                    [logged_user.id, profile_user.id])
        logged_user_has_blocked = cur.fetchone() is not None

    # Friend status
    friend_status = 'none'
    if not is_own_profile:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT status, sender_id FROM friends 
                WHERE (sender_id = %s AND receiver_id = %s) 
                   OR (sender_id = %s AND receiver_id = %s)
                LIMIT 1
            """, [logged_user.id, profile_user.id, profile_user.id, logged_user.id])
            row = cur.fetchone()
            if row:
                status, sender_id = row
                if status == 'accepted':
                    friend_status = 'accepted'
                elif status == 'pending':
                    friend_status = 'pending' if sender_id == logged_user.id else 'incoming'
    else:
        friend_status = 'accepted'

    # Stats
    stats = {'posts': 0, 'likes': 0, 'comments': 0, 'views': 0}
    with connection.cursor() as cur:
        cur.execute("""
            SELECT 
                (SELECT COUNT(*) FROM space_posts WHERE user_id=%s AND is_deleted=0),
                (SELECT COALESCE(SUM(likes_count),0) FROM space_posts WHERE user_id=%s AND is_deleted=0),
                (SELECT COUNT(*) FROM space_comments sc 
                 JOIN space_posts sp ON sc.post_id = sp.post_id 
                 WHERE sp.user_id=%s AND sc.is_deleted=0 AND sp.is_deleted=0),
                (SELECT COALESCE(SUM(views_count),0) FROM space_posts WHERE user_id=%s AND is_deleted=0)
        """, [profile_user.id, profile_user.id, profile_user.id, profile_user.id])
        row = cur.fetchone()
        if row:
            stats['posts'] = row[0] or 0
            stats['likes'] = row[1] or 0
            stats['comments'] = row[2] or 0
            stats['views'] = row[3] or 0

    # Profile completion
    completion = 0
    if profile_user.picture: completion += 25
    if profile_user.about_me: completion += 25
    if profile_user.location: completion += 25
    if profile_user.facebook or profile_user.twitter or profile_user.instagram: completion += 25

    # Suggested users (if not own profile)
    suggested = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture
            FROM auth a
            WHERE a.id != %s
            AND a.id NOT IN (
                SELECT CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END
                FROM friends
                WHERE sender_id = %s OR receiver_id = %s
            )
            AND a.id NOT IN (
                SELECT blocked_id FROM blocks WHERE blocker_id = %s
                UNION
                SELECT blocker_id FROM blocks WHERE blocked_id = %s
            )
            ORDER BY RAND()
            LIMIT 5
        """, [logged_user.id, logged_user.id, logged_user.id, logged_user.id,
            logged_user.id, logged_user.id])
        for r in cur.fetchall():
            pic = r[3]
            suggested.append({
                'id': r[0],
                'name': r[1] or r[2],
                'username': r[2],
                'picture': f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}' if pic else '/static/images/avatars/default.png'
            })

    # Recent activity (own profile only)
    recent_activity = []
    if is_own_profile:
        with connection.cursor() as cur:
            cur.execute("""
                (SELECT 'post' AS type, post_id AS id, created_at, 'Created a post' AS action
                 FROM space_posts
                 WHERE user_id = %s AND is_deleted = 0
                 ORDER BY created_at DESC
                 LIMIT 5)
                UNION ALL
                (SELECT 'shout' AS type, id, created_at, 'Shared a shout' AS action
                 FROM shouts
                 WHERE user_id = %s AND is_deleted = 0
                 ORDER BY created_at DESC
                 LIMIT 5)
                ORDER BY created_at DESC
                LIMIT 5
            """, [profile_user.id, profile_user.id])
            for row in cur.fetchall():
                created = row[2]
                # short format like PHP: 5m, 3h, 2d, Mar 12
                from datetime import datetime
                diff = int((datetime.now() - created).total_seconds()) if created else 0
                if diff < 60:      t = 'Just now'
                elif diff < 3600:  t = f'{diff // 60}m'
                elif diff < 86400: t = f'{diff // 3600}h'
                else:              t = created.strftime('%b %d')
                recent_activity.append({
                    'type': row[0],
                    'id': row[1],
                    'created_at': created,
                    'action': row[3],
                    'time_ago': t,
                })

    # Friends list for @mention autocomplete
    friends = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON (f.sender_id = a.id OR f.receiver_id = a.id)
            WHERE (f.sender_id = %s OR f.receiver_id = %s)
              AND f.status = 'accepted'
              AND a.id != %s
        """, [logged_user.id, logged_user.id, logged_user.id])
        for row in cur.fetchall():
            pic = row[3]
            friends.append({
                'id': row[0],
                'name': row[1] or '',
                'username': row[2] or '',
                'picture': f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}' if pic else '/static/images/avatars/default.png'
            })

    # Template context
    display_name = profile_user.name or profile_user.username
    display_username = profile_user.username
    display_picture = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{profile_user.picture}' if profile_user.picture else '/static/images/avatars/default.png'
    display_location = profile_user.location or 'Not specified'
    display_gender = profile_user.gender or 'Not specified'
    display_about = profile_user.about_me or 'No bio yet.'
    display_website = profile_user.website or ''
    join_date = profile_user.join_date.strftime('%B %Y') if profile_user.join_date else 'Unknown'

    engagement_rate = 0
    if stats['posts'] > 0:
        engagement_rate = round(((stats['likes'] + stats['comments']) / stats['posts']) * 10) / 10

    context = {
        'active_page': 'profile',
        'profile_user': profile_user,
        'logged_user': logged_user,
        'is_own_profile': is_own_profile,
        'is_blocked': is_blocked,
        'logged_user_has_blocked': logged_user_has_blocked,
        'friend_status': friend_status,
        'stats': stats,
        'profile_completion': completion,
        'suggested': suggested,
        'recent_activity': recent_activity,
        'friends_json': json.dumps(friends),
        'display_name': display_name,
        'display_username': display_username,
        'display_picture': display_picture,
        'display_location': display_location,
        'display_gender': display_gender,
        'display_about': display_about,
        'display_website': display_website,
        'join_date': join_date,
        'engagement_rate': engagement_rate,
        'view_user_id': profile_user.id,
        'logged_user_id': logged_user.id,
        'svg_logo': _load_svg_logo(),
    }
    return render(request, 'dashboard/user_profile.html', context)


@csrf_exempt
@login_required
@require_POST
def api_profile_action(request):
    """Unified endpoint for all profile actions (mirrors PHP user_profile.php)."""
    user_id = request.user.id
    action = None
    data = {}

    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            action = data.get('action')
        except Exception:
            pass
    else:
        action = request.POST.get('action')
        data = request.POST

    if not action:
        return JsonResponse({'success': False, 'error': 'No action specified'})

    # Dispatch
    if action == 'send_friend_request':
        return _profile_send_friend_request(request, user_id, data)
    elif action == 'cancel_friend_request':
        return _profile_cancel_friend_request(request, user_id, data)
    elif action == 'remove_friend':
        return _profile_remove_friend(request, user_id, data)
    elif action == 'block_user':
        return _profile_block_user(request, user_id, data)
    elif action == 'unblock_user':
        return _profile_unblock_user(request, user_id, data)
    elif action == 'update_profile':
        return _profile_update(request, user_id, data)
    elif action == 'update_profile_picture':
        return _profile_update_picture(request, user_id, data)
    elif action == 'remove_profile_picture':
        return _profile_remove_picture(request, user_id)
    else:
        return JsonResponse({'success': False, 'error': 'Invalid action'})


def _profile_send_friend_request(request, user_id, data):
    receiver_id = int(data.get('receiver_id') or 0)
    if not receiver_id or receiver_id == user_id:
        return JsonResponse({'success': False, 'error': 'Invalid user'})

    with connection.cursor() as cur:
        cur.execute("""
            SELECT status, sender_id FROM friends 
            WHERE (sender_id = %s AND receiver_id = %s) 
               OR (sender_id = %s AND receiver_id = %s)
            LIMIT 1
        """, [user_id, receiver_id, receiver_id, user_id])
        row = cur.fetchone()
        if row:
            status, sender_id = row
            if status == 'accepted':
                return JsonResponse({'success': False, 'error': 'Already friends'})
            if status == 'pending':
                if sender_id == user_id:
                    return JsonResponse({'success': False, 'error': 'Friend request already sent'})
                else:
                    return JsonResponse({'success': False, 'error': 'This user already sent you a request'})

        cur.execute("""
            SELECT id FROM blocks 
            WHERE (blocker_id = %s AND blocked_id = %s) 
               OR (blocker_id = %s AND blocked_id = %s)
        """, [user_id, receiver_id, receiver_id, user_id])
        if cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Cannot send friend request to blocked user'})

        cur.execute("""
            INSERT INTO friends (sender_id, receiver_id, status, created_at) 
            VALUES (%s, %s, 'pending', NOW())
        """, [user_id, receiver_id])

    return JsonResponse({'success': True, 'message': 'Friend request sent successfully'})


def _profile_cancel_friend_request(request, user_id, data):
    friend_id = int(data.get('friend_id') or 0)
    if not friend_id:
        return JsonResponse({'success': False, 'error': 'Invalid user'})

    with connection.cursor() as cur:
        cur.execute("""
            DELETE FROM friends 
            WHERE sender_id = %s AND receiver_id = %s AND status = 'pending'
        """, [user_id, friend_id])

    return JsonResponse({'success': True, 'message': 'Friend request cancelled'})


def _profile_remove_friend(request, user_id, data):
    friend_id = int(data.get('friend_id') or 0)
    if not friend_id:
        return JsonResponse({'success': False, 'error': 'Invalid user'})

    with connection.cursor() as cur:
        cur.execute("""
            DELETE FROM friends 
            WHERE (sender_id = %s AND receiver_id = %s) 
               OR (sender_id = %s AND receiver_id = %s)
        """, [user_id, friend_id, friend_id, user_id])

    return JsonResponse({'success': True, 'message': 'Friend removed successfully'})


def _profile_block_user(request, user_id, data):
    blocked_id = int(data.get('user_id') or 0)
    if not blocked_id or blocked_id == user_id:
        return JsonResponse({'success': False, 'error': 'Invalid user'})

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM blocks WHERE blocker_id = %s AND blocked_id = %s",
                    [user_id, blocked_id])
        if cur.fetchone():
            return JsonResponse({'success': False, 'error': 'User already blocked'})

        # Remove friendship first
        cur.execute("""
            DELETE FROM friends 
            WHERE (sender_id = %s AND receiver_id = %s) 
               OR (sender_id = %s AND receiver_id = %s)
        """, [user_id, blocked_id, blocked_id, user_id])

        cur.execute("""
            INSERT INTO blocks (blocker_id, blocked_id, created_at) 
            VALUES (%s, %s, NOW())
        """, [user_id, blocked_id])

    return JsonResponse({'success': True, 'message': 'User blocked successfully'})


def _profile_unblock_user(request, user_id, data):
    blocked_id = int(data.get('user_id') or 0)
    if not blocked_id:
        return JsonResponse({'success': False, 'error': 'Invalid user'})

    with connection.cursor() as cur:
        cur.execute("DELETE FROM blocks WHERE blocker_id = %s AND blocked_id = %s",
                    [user_id, blocked_id])

    return JsonResponse({'success': True, 'message': 'User unblocked successfully'})


def _profile_update(request, user_id, data):
    name = data.get('name', '').strip()
    location = data.get('location', '').strip()
    gender = data.get('gender', '').strip()
    website = data.get('website', '').strip()
    about_me = data.get('about_me', '').strip()
    facebook = data.get('facebook', '').strip()
    twitter = data.get('twitter', '').strip()
    instagram = data.get('instagram', '').strip()
    linkedin = data.get('linkedin', '').strip()
    youtube = data.get('youtube', '').strip()

    if not name:
        return JsonResponse({'success': False, 'error': 'Name is required'})

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE auth SET 
                name = %s,
                location = %s,
                gender = %s,
                website = %s,
                about_me = %s,
                facebook = %s,
                twitter = %s,
                instagram = %s,
                linkedin = %s,
                youtube = %s
            WHERE id = %s
        """, [name, location, gender, website, about_me,
              facebook, twitter, instagram, linkedin, youtube, user_id])

    return JsonResponse({'success': True, 'message': 'Profile updated successfully'})


def _profile_update_picture(request, user_id, data=None):
    direct_s3_key = (data or {}).get('s3_key') or request.POST.get('s3_key')
    if direct_s3_key:
        filename = os.path.basename(direct_s3_key)
        with connection.cursor() as cur:
            cur.execute("UPDATE auth SET picture = %s WHERE id = %s", [filename, user_id])
        try:
            from landing.tasks import generate_image_variants
            generate_image_variants.delay(f'uploads/{filename}')
        except Exception as _e:
            pass
        picture_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{filename}'
        return JsonResponse({'success': True, 'picture_url': picture_url})

    file = request.FILES.get('profile_picture')
    if not file:
        return JsonResponse({'success': False, 'error': 'No file uploaded'})
    if file.size > 5 * 1024 * 1024:
        return JsonResponse({'success': False, 'error': 'File size must be less than 5MB'})
    allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if file.content_type not in allowed_types:
        return JsonResponse({'success': False, 'error': 'Invalid file type. Only JPG, PNG, GIF, WEBP allowed'})

    # Get old picture
    with connection.cursor() as cur:
        cur.execute("SELECT picture FROM auth WHERE id = %s", [user_id])
        row = cur.fetchone()
        old_picture = row[0] if row else None

    # Upload to S3 (folder='uploads')
    key = _upload_to_s3(file, folder='uploads')
    if not key:
        return JsonResponse({'success': False, 'error': 'Failed to upload to S3'})

    filename = os.path.basename(key)

    with connection.cursor() as cur:
        cur.execute("UPDATE auth SET picture = %s WHERE id = %s", [filename, user_id])

    try:
        from landing.tasks import generate_image_variants
        generate_image_variants.delay(f'uploads/{filename}')
    except Exception as _e:
        pass

    picture_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{filename}'
    return JsonResponse({'success': True, 'picture_url': picture_url})


def _profile_remove_picture(request, user_id):
    with connection.cursor() as cur:
        cur.execute("SELECT picture FROM auth WHERE id = %s", [user_id])
        row = cur.fetchone()
        picture = row[0] if row else None

        if not picture:
            return JsonResponse({'success': False, 'error': 'No profile picture to remove'})

        cur.execute("UPDATE auth SET picture = NULL WHERE id = %s", [user_id])

    # Optionally delete from S3 here (skipped)

    return JsonResponse({'success': True, 'message': 'Profile picture removed successfully'})


@login_required
def api_user_posts_list(request):
    """GET /api/user-posts/?profile_user_id=X&page=N — posts by a specific user."""
    try:
        page = max(1, int(request.GET.get('page', 1)))
        profile_user_id = int(request.GET.get('profile_user_id', 0))
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'error': 'Invalid parameters'})

    if not profile_user_id:
        return JsonResponse({'success': False, 'error': 'profile_user_id required'})

    per_page = 10
    offset = (page - 1) * per_page
    user_id = request.user.id

    # Check block status
    with connection.cursor() as cur:
        cur.execute("""
            SELECT id FROM blocks 
            WHERE (blocker_id = %s AND blocked_id = %s) 
               OR (blocker_id = %s AND blocked_id = %s)
            LIMIT 1
        """, [user_id, profile_user_id, profile_user_id, user_id])
        if cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Blocked from viewing this profile'})

    # Count total
    with connection.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM space_posts WHERE user_id = %s AND is_deleted = 0",
                    [profile_user_id])
        total_posts = cur.fetchone()[0] or 0

    # Fetch posts
    with connection.cursor() as cur:
        cur.execute("""
            SELECT 
                p.post_id, p.user_id, p.content, p.created_at, p.updated_at,
                p.likes_count, p.dislikes_count, p.comments_count, p.views_count, p.shares_count,
                a.id AS a_id, a.name AS a_name, a.username AS a_username, a.picture AS a_picture,
                ui.reaction AS user_reaction, ui.has_saved AS is_saved
            FROM space_posts p
            JOIN auth a ON p.user_id = a.id
            LEFT JOIN space_user_interactions ui ON ui.post_id = p.post_id AND ui.user_id = %s
            WHERE p.user_id = %s AND p.is_deleted = 0
            ORDER BY p.created_at DESC
            LIMIT %s OFFSET %s
        """, [user_id, profile_user_id, per_page, offset])
        rows = cur.fetchall()

    # Fetch media
    post_ids = [row[0] for row in rows]
    media_by_post = {}
    if post_ids:
        placeholders = ','.join(['%s'] * len(post_ids))
        with connection.cursor() as cur:
            cur.execute(f"""
                SELECT post_id, media_url, media_type, mime_type
                FROM space_media
                WHERE post_id IN ({placeholders})
                ORDER BY id ASC
            """, post_ids)
            for m in cur.fetchall():
                raw_url = m[1] or ''
                if raw_url and not raw_url.startswith('http'):
                    if raw_url.startswith('uploads/'):
                        full_url = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/' + raw_url
                    else:
                        full_url = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/space_posts/' + raw_url
                else:
                    full_url = raw_url
                media_by_post.setdefault(m[0], []).append({
                    'type': m[2] or 'image',
                    'url': full_url,
                    'mime_type': m[3] or 'image/jpeg',
                })

    now = timezone.now()
    posts = []
    for row in rows:
        (post_id, post_user_id, content, created_at, updated_at,
         likes, dislikes, comments, views, shares,
         a_id, a_name, a_username, a_picture,
         user_reaction, is_saved) = row
        is_edited = bool(updated_at and created_at and updated_at != created_at)
        author_picture = (f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{a_picture}'
                          if a_picture else '/static/images/avatars/default.png')
        posts.append({
            'id': post_id,
            'content': content or '',
            'author': {
                'id': a_id or post_user_id,
                'name': a_name or a_username or 'User',
                'username': a_username or 'user',
                'picture': author_picture,
            },
            'time_ago': _format_time_ago(created_at, now),
            'is_edited': is_edited,
            'media': media_by_post.get(post_id, []),
            'poll': None,  # TODO: add poll support
            'views': views or 0,
            'user_reaction': user_reaction,
            'is_saved': bool(is_saved),
            'likes': likes or 0,
            'dislikes': dislikes or 0,
            'comments_count': comments or 0,
            'shares': shares or 0,
        })

    return JsonResponse({
        'success': True,
        'posts': posts,
        'has_more': (offset + per_page) < total_posts,
        'total_posts': total_posts,
        'page': page,
    })


# ============================================================
# SHOUTBOX
# ============================================================

@login_required
def shoutbox_view(request):
    """Renders the shoutbox page + provides initial context."""
    user = request.user
    user_id = user.id
    S3 = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/'
    DEFAULT_AV = '/static/images/avatars/default.png'

    user_picture = (S3 + user.picture) if user.picture else DEFAULT_AV

    # Friends for @mention autocomplete
    friends = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT a.id, a.name, a.username, a.picture
            FROM auth a
            JOIN friends f ON (
                (f.sender_id = a.id AND f.receiver_id = %s) OR
                (f.receiver_id = a.id AND f.sender_id = %s)
            )
            WHERE a.id != %s AND f.status = 'accepted'
            ORDER BY a.name ASC
        """, [user_id, user_id, user_id])
        for r in cur.fetchall():
            pic = r[3]
            friends.append({
                'id': r[0],
                'name': r[1] or '',
                'username': r[2] or '',
                'picture': (S3 + pic) if pic else DEFAULT_AV,
            })

    # User's shout count + last shout time
    shout_count = 0
    last_shout_time = 'Never'
    with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM shouts WHERE user_id = %s AND is_deleted = 0",
            [user_id]
        )
        shout_count = cur.fetchone()[0] or 0

        cur.execute(
            "SELECT created_at FROM shouts WHERE user_id = %s AND is_deleted = 0 "
            "ORDER BY created_at DESC LIMIT 1",
            [user_id]
        )
        lr = cur.fetchone()
        if lr and lr[0]:
            last_shout_time = _time_ago(lr[0])

    # Top shouters
    top_shouters = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT a.id, a.name, a.username, a.picture, COUNT(s.id) AS shout_count
            FROM auth a
            JOIN shouts s ON a.id = s.user_id
            WHERE s.is_deleted = 0
            GROUP BY a.id, a.name, a.username, a.picture
            ORDER BY shout_count DESC
            LIMIT 5
        """)
        for row in cur.fetchall():
            pic = row[3]
            top_shouters.append({
                'id': row[0],
                'name': row[1] or row[2] or 'User',
                'username': row[2] or '',
                'picture': (S3 + pic) if pic else DEFAULT_AV,
                'shout_count': row[4],
            })

    # Recent activity
    recent_activity = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT s.created_at, a.name, a.username, a.picture
            FROM shouts s
            JOIN auth a ON s.user_id = a.id
            WHERE s.is_deleted = 0
            ORDER BY s.created_at DESC
            LIMIT 5
        """)
        for row in cur.fetchall():
            pic = row[3]
            recent_activity.append({
                'created_at': row[0],
                'name': row[1] or row[2] or 'User',
                'username': row[2] or '',
                'picture': (S3 + pic) if pic else DEFAULT_AV,
                'time_ago': _time_ago(row[0]),
            })

    return render(request, 'dashboard/shout_box.html', {
        'active_page': 'shoutbox',
        'user_picture': user_picture,
        'friends_json': json.dumps(friends),
        'friends_count': len(friends),
        'shout_count': shout_count,
        'last_shout_time': last_shout_time,
        'top_shouters': top_shouters,
        'recent_activity': recent_activity,
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def api_shouts_list(request):
    """GET /api/shouts/list/?limit=50 — recent shouts as JSON."""
    try:
        limit = max(1, min(200, int(request.GET.get('limit', 50))))
    except (TypeError, ValueError):
        limit = 50

    user_id = request.user.id
    S3 = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/'
    DEFAULT_AV = '/static/images/avatars/default.png'

    # Blocked users (both directions)
    with connection.cursor() as cur:
        cur.execute("""
            SELECT blocked_id FROM blocks WHERE blocker_id = %s
            UNION
            SELECT blocker_id FROM blocks WHERE blocked_id = %s
        """, [user_id, user_id])
        blocked_ids = [r[0] for r in cur.fetchall()]

    sql = """
        SELECT s.id, s.user_id, s.message, s.created_at, s.mention_count,
               a.name, a.username, a.picture
        FROM shouts s
        JOIN auth a ON s.user_id = a.id
        WHERE s.is_deleted = 0
    """
    params = []
    if blocked_ids:
        placeholders = ','.join(['%s'] * len(blocked_ids))
        sql += f" AND s.user_id NOT IN ({placeholders})"
        params.extend(blocked_ids)
    sql += " ORDER BY s.created_at DESC LIMIT %s"
    params.append(limit)

    with connection.cursor() as cur:
        cur.execute(sql, params)
        rows = list(reversed(cur.fetchall()))  # chronological

    shouts = []
    for r in rows:
        pic = r[7]
        shouts.append({
            'id': r[0],
            'user_id': r[1],
            'message': r[2] or '',
            'timestamp': int(r[3].timestamp() * 1000) if r[3] else 0,
            'mention_count': int(r[4] or 0),
            'user': {
                'id': r[1],
                'name': r[5] or r[6] or 'User',
                'username': r[6] or '',
                'picture': (S3 + pic) if pic else DEFAULT_AV,
            },
            'is_mine': (r[1] == user_id),
        })

    return JsonResponse({'success': True, 'shouts': shouts, 'total': len(shouts)})


@login_required
def api_shouts_friends(request):
    """GET /api/shouts/friends/ — friends list for @mention autocomplete."""
    user_id = request.user.id
    S3 = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/'
    DEFAULT_AV = '/static/images/avatars/default.png'

    friends = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT a.id, a.username, a.name, a.picture
            FROM auth a
            JOIN friends f ON (
                (f.sender_id = a.id AND f.receiver_id = %s) OR
                (f.receiver_id = a.id AND f.sender_id = %s)
            )
            WHERE a.id != %s AND f.status = 'accepted'
            ORDER BY a.name ASC
            LIMIT 200
        """, [user_id, user_id, user_id])
        for r in cur.fetchall():
            pic = r[3]
            friends.append({
                'id': r[0],
                'username': r[1] or '',
                'name': r[2] or '',
                'picture': (S3 + pic) if pic else DEFAULT_AV,
            })

    return JsonResponse({'success': True, 'users': friends, 'count': len(friends)})


@login_required
@require_POST
def api_shouts_create(request):
    """POST /api/shouts/create/ — create shout + extract mentions + notify."""
    import json as _json
    import re as _re

    message = (request.POST.get('message') or '').strip()
    if not message:
        return JsonResponse({'success': False, 'error': 'Empty message'})
    if len(message) > 140:
        return JsonResponse({'success': False, 'error': 'Message exceeds 140 characters'})

    user_id = request.user.id

    # Extract @mentions
    mentioned_usernames = list(set(_re.findall(r'@(\w+)', message)))
    mentioned_users = []

    if mentioned_usernames:
        placeholders = ','.join(['%s'] * len(mentioned_usernames))
        with connection.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT a.id, a.username, a.name
                FROM auth a
                JOIN friends f ON (
                    (f.sender_id = a.id AND f.receiver_id = %s) OR
                    (f.receiver_id = a.id AND f.sender_id = %s)
                )
                WHERE a.username IN ({placeholders})
                  AND a.id != %s
                  AND f.status = 'accepted'
            """, [user_id, user_id, *mentioned_usernames, user_id])
            for r in cur.fetchall():
                mentioned_users.append({'id': r[0], 'username': r[1], 'name': r[2]})

    mentioned_users_json = _json.dumps([u['username'] for u in mentioned_users])

    with connection.cursor() as cur:
        cur.execute(
            "INSERT INTO shouts (user_id, message, mention_count, mentioned_users, created_at, is_deleted) "
            "VALUES (%s, %s, %s, %s, NOW(), 0)",
            [user_id, message, len(mentioned_users), mentioned_users_json]
        )
        shout_id = cur.lastrowid

        # Best-effort last_seen update
        try:
            cur.execute("UPDATE auth SET last_seen = NOW() WHERE id = %s", [user_id])
        except Exception:
            pass

        for mu in mentioned_users:
            cur.execute(
                "INSERT INTO shout_mentions (shout_id, mentioned_user_id, mentioner_id, created_at, is_read) "
                "VALUES (%s, %s, %s, NOW(), 0)",
                [shout_id, mu['id'], user_id]
            )

    # Fire notifications
    sender_name = request.user.name or request.user.username or 'Someone'
    for mu in mentioned_users:
        _notify(
            user_id=mu['id'],
            notif_type='shoutbox_mention',
            title='📢 You were mentioned in the Shoutbox',
            message=f'{sender_name}: {message[:100]}',
            icon='bullhorn',
            link='/shoutbox/',
            actor_id=request.user.id,
        )

    S3 = 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/'
    DEFAULT_AV = '/static/images/avatars/default.png'
    pic = request.user.picture

    return JsonResponse({
        'success': True,
        'message_id': shout_id,
        'timestamp': int(timezone.now().timestamp() * 1000),
        'user': {
            'id': user_id,
            'name': request.user.name or request.user.username or 'User',
            'username': request.user.username or '',
            'picture': (S3 + pic) if pic else DEFAULT_AV,
        },
        'mentions_sent': len(mentioned_users),
    })

@login_required
@require_POST
def api_shouts_delete(request):
    """POST /api/shouts/delete/ — soft-delete own shout (admins can delete any)."""
    try:
        shout_id = int(request.POST.get('shout_id') or 0)
    except (TypeError, ValueError):
        shout_id = 0
    if shout_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid shout ID'})

    user_id = request.user.id

    with connection.cursor() as cur:
        cur.execute(
            "SELECT user_id FROM shouts WHERE id = %s AND is_deleted = 0",
            [shout_id]
        )
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Shout not found'})

        owner_id = row[0]
        if owner_id != user_id:
            cur.execute("SELECT role FROM auth WHERE id = %s", [user_id])
            role_row = cur.fetchone()
            if not role_row or role_row[0] != 'admin':
                return JsonResponse({'success': False, 'error': 'Not authorized'})

        _cascade_delete_notifications([f'%shout_id={shout_id}%', f'/shoutbox/%'])
        cur.execute(
            "UPDATE shouts SET is_deleted = 1 WHERE id = %s",
            [shout_id]
        )

    return JsonResponse({'success': True, 'shout_id': shout_id})


# ============================================================
# LEADERBOARD
# ============================================================

AFHAM_EMAIL = 'afham023@gmail.com'
AFHAM_USERNAME = 'afham'

def _is_leaderboard_admin(user):
    return (getattr(user, 'email', '') == AFHAM_EMAIL
            or getattr(user, 'username', '') == AFHAM_USERNAME)


def _utc_to_pk_display(dt):
    """UTC datetime → 'YYYY-MM-DD HH:MM' string in Asia/Karachi."""
    if not dt:
        return 'N/A'
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo
    if isinstance(dt, str):
        try:
            dt = _dt.strptime(dt, '%Y-%m-%d %H:%M:%S')
        except Exception:
            return 'N/A'
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo('UTC'))
    return dt.astimezone(ZoneInfo('Asia/Karachi')).strftime('%Y-%m-%d %H:%M')


def _pk_to_utc_string(dt_local_str):
    """'YYYY-MM-DDTHH:MM' (Pakistan) → 'YYYY-MM-DD HH:MM:SS' (UTC). None if invalid."""
    if not dt_local_str:
        return None
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo
    try:
        # datetime-local sends 'YYYY-MM-DDTHH:MM' or with :SS
        fmt = '%Y-%m-%dT%H:%M:%S' if dt_local_str.count(':') == 2 else '%Y-%m-%dT%H:%M'
        dt = _dt.strptime(dt_local_str, fmt)
        dt = dt.replace(tzinfo=ZoneInfo('Asia/Karachi'))
        return dt.astimezone(ZoneInfo('UTC')).strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return None


def _lb_s3_url(pic):
    if not pic:
        return '/static/images/avatars/default.png'
    if pic.startswith('http'):
        return pic
    return f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'


def _lb_format_winner(row):
    """row = (id, name, username, email, picture, rank, signup_date)"""
    return {
        'id': row[0],
        'name': row[1] or row[2] or 'User',
        'username': row[2] or '',
        'email': row[3] or '',
        'picture': _lb_s3_url(row[4]),
        'rank': int(row[5] or 0),
        'signup_date': _utc_to_pk_display(row[6]),
    }


def _lb_fetch_winners(settings_id):
    with connection.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.name, u.username, u.email, u.picture,
                   w.rank, w.signup_date
            FROM leaderboard_winners w
            JOIN auth u ON w.user_id = u.id
            WHERE w.settings_id = %s
            ORDER BY w.rank ASC
        """, [settings_id])
        return [_lb_format_winner(r) for r in cur.fetchall()]


def _lb_fetch_promotions():
    with connection.cursor() as cur:
        cur.execute("""
            SELECT ls.id, ls.is_active, ls.start_date, ls.end_date,
                   ls.created_at, ls.promotion_name,
                   (SELECT COUNT(*) FROM leaderboard_winners WHERE settings_id = ls.id) AS total_winners
            FROM leaderboard_settings ls
            ORDER BY ls.created_at DESC
        """)
        rows = cur.fetchall()

    now_utc = timezone.now()
    promos = []
    for r in rows:
        is_active = bool(r[1])
        start, end = r[2], r[3]

        # Auto-deactivate if end passed
        if is_active and end and end < now_utc.replace(tzinfo=None):
            with connection.cursor() as cur:
                cur.execute(
                    "UPDATE leaderboard_settings SET is_active = 0 WHERE id = %s",
                    [r[0]]
                )
            is_active = False

        promos.append({
            'id': r[0],
            'is_active': is_active,
            'start_date': start.strftime('%Y-%m-%d %H:%M:%S') if start else None,
            'end_date': end.strftime('%Y-%m-%d %H:%M:%S') if end else None,
            'created_at': r[4].strftime('%Y-%m-%d %H:%M:%S') if r[4] else None,
            'promotion_name': r[5] or 'Promotion',
            'total_winners': r[6] or 0,
            'start_date_display': _utc_to_pk_display(start),
            'end_date_display': _utc_to_pk_display(end),
            'created_at_display': _utc_to_pk_display(r[4]),
        })
    return promos


def _lb_recalculate_winners(settings_id, start_date, end_date):
    """Clear + repopulate winner rows for the settings_id. Returns count."""
    with connection.cursor() as cur:
        cur.execute(
            "DELETE FROM leaderboard_winners WHERE settings_id = %s",
            [settings_id]
        )
        cur.execute("""
            SELECT id, created_at
            FROM auth
            WHERE created_at BETWEEN %s AND %s
              AND created_at IS NOT NULL
            ORDER BY created_at ASC
            LIMIT 10
        """, [start_date, end_date])
        users = cur.fetchall()

        for idx, (uid, signup) in enumerate(users, start=1):
            cur.execute("""
                INSERT INTO leaderboard_winners
                    (settings_id, user_id, rank, signup_date, created_at)
                VALUES (%s, %s, %s, %s, NOW())
            """, [settings_id, uid, idx, signup])

    return len(users)


@login_required
def leaderboard_view(request):
    """Renders the leaderboard page with initial data."""
    user = request.user
    is_admin = _is_leaderboard_admin(user)

    promos = _lb_fetch_promotions()
    active = next((p for p in promos if p['is_active']), None)
    winners = _lb_fetch_winners(active['id']) if active else []

    has_promotions = len(promos) > 0

    # Determine status
    if active:
        status = 'active'
    elif has_promotions and any(p['total_winners'] > 0 and not p['is_active'] for p in promos):
        status = 'ended'
    else:
        status = 'coming_soon'

    user_winner = next((w for w in winners if w['id'] == user.id), None)

    return render(request, 'dashboard/leaderboard.html', {
        'active_page': 'leaderboard',
        'is_afham': is_admin,
        'promotions': promos,
        'active_promotion': active,
        'winners': winners,
        'status': status,
        'has_promotions': has_promotions,
        'user_winner': user_winner,
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def api_lb_status(request):
    """GET — active promotion + winners (for polling)."""
    promos = _lb_fetch_promotions()
    active = next((p for p in promos if p['is_active']), None)
    winners = _lb_fetch_winners(active['id']) if active else []

    return JsonResponse({
        'success': True,
        'active': active,
        'winners': winners,
        'total_promotions': len(promos),
        'has_promotions': len(promos) > 0,
    })


@login_required
def api_lb_promotions(request):
    """GET — all promotions (admin only)."""
    if not _is_leaderboard_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Unauthorized'})
    return JsonResponse({
        'success': True,
        'promotions': _lb_fetch_promotions(),
    })


@login_required
@require_POST
def api_lb_create(request):
    """POST — create a promotion."""
    if not _is_leaderboard_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Unauthorized'})

    name = (request.POST.get('name') or 'Promotion').strip()
    start_local = request.POST.get('start_date') or ''
    end_local = request.POST.get('end_date') or ''
    activate_now = (request.POST.get('activate_now') or '').lower() == 'true'

    if not start_local or not end_local:
        return JsonResponse({'success': False, 'error': 'Please set both start and end dates'})

    start_utc = _pk_to_utc_string(start_local)
    end_utc = _pk_to_utc_string(end_local)
    if not start_utc or not end_utc:
        return JsonResponse({'success': False, 'error': 'Invalid date format'})

    if start_utc >= end_utc:
        return JsonResponse({'success': False, 'error': 'End date must be after start date'})

    user_id = request.user.id

    with connection.cursor() as cur:
        cur.execute("UPDATE leaderboard_settings SET is_active = 0 WHERE is_active = 1")
        is_active = 1 if activate_now else 0
        cur.execute("""
            INSERT INTO leaderboard_settings
                (is_active, start_date, end_date, created_by, created_at, updated_at, promotion_name)
            VALUES (%s, %s, %s, %s, NOW(), NOW(), %s)
        """, [is_active, start_utc, end_utc, user_id, name])
        settings_id = cur.lastrowid

    winners_count = 0
    if activate_now:
        # Only populate if start has passed
        from datetime import datetime as _dt
        now_utc = _dt.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        if start_utc <= now_utc:
            winners_count = _lb_recalculate_winners(settings_id, start_utc, end_utc)

    return JsonResponse({
        'success': True,
        'message': (f'Promotion activated! {winners_count} winners added.'
                    if activate_now else 'Promotion created successfully!'),
        'settings_id': settings_id,
        'activated': activate_now,
    })


@login_required
@require_POST
def api_lb_activate(request):
    if not _is_leaderboard_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Unauthorized'})

    try:
        settings_id = int(request.POST.get('settings_id') or 0)
    except (TypeError, ValueError):
        settings_id = 0
    if not settings_id:
        return JsonResponse({'success': False, 'error': 'Invalid promotion ID'})

    with connection.cursor() as cur:
        cur.execute(
            "SELECT start_date, end_date FROM leaderboard_settings WHERE id = %s",
            [settings_id]
        )
        row = cur.fetchone()
        if not row:
            return JsonResponse({'success': False, 'error': 'Promotion not found'})
        start_date, end_date = row

        cur.execute("UPDATE leaderboard_settings SET is_active = 0 WHERE is_active = 1")
        cur.execute(
            "UPDATE leaderboard_settings SET is_active = 1, updated_at = NOW() WHERE id = %s",
            [settings_id]
        )

    winners_count = _lb_recalculate_winners(settings_id, start_date, end_date)
    return JsonResponse({
        'success': True,
        'message': f'Promotion activated! {winners_count} winners added.',
    })


@login_required
@require_POST
def api_lb_deactivate(request):
    if not _is_leaderboard_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Unauthorized'})

    try:
        settings_id = int(request.POST.get('settings_id') or 0)
    except (TypeError, ValueError):
        settings_id = 0

    with connection.cursor() as cur:
        if settings_id:
            cur.execute(
                "UPDATE leaderboard_settings SET is_active = 0, updated_at = NOW() WHERE id = %s",
                [settings_id]
            )
        else:
            cur.execute("UPDATE leaderboard_settings SET is_active = 0 WHERE is_active = 1")

    return JsonResponse({'success': True, 'message': 'Promotion deactivated'})


@login_required
@require_POST
def api_lb_reset(request):
    if not _is_leaderboard_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Unauthorized'})

    try:
        settings_id = int(request.POST.get('settings_id') or 0)
    except (TypeError, ValueError):
        settings_id = 0
    if not settings_id:
        return JsonResponse({'success': False, 'error': 'Invalid promotion ID'})

    with connection.cursor() as cur:
        cur.execute("DELETE FROM leaderboard_winners WHERE settings_id = %s", [settings_id])
        cur.execute(
            "UPDATE leaderboard_settings SET is_active = 0, updated_at = NOW() WHERE id = %s",
            [settings_id]
        )

    return JsonResponse({'success': True, 'message': 'Promotion reset successfully'})


@login_required
@require_POST
def api_lb_delete(request):
    if not _is_leaderboard_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Unauthorized'})

    try:
        settings_id = int(request.POST.get('settings_id') or 0)
    except (TypeError, ValueError):
        settings_id = 0
    if not settings_id:
        return JsonResponse({'success': False, 'error': 'Invalid promotion ID'})

    with connection.cursor() as cur:
        cur.execute("DELETE FROM leaderboard_winners WHERE settings_id = %s", [settings_id])
        cur.execute("DELETE FROM leaderboard_settings WHERE id = %s", [settings_id])

    return JsonResponse({'success': True, 'message': 'Promotion deleted successfully'})

    # ============================================================
# SUPPORT
# ============================================================

SUPPORT_S3_FOLDER = 'uploads/support'
SUPPORT_MAX_MB = 50
SUPPORT_ALLOWED_MIME = {
    # images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    # videos
    'video/mp4', 'video/webm', 'video/ogg',
    # files
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/csv',
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}


def _support_media_type(mime):
    if not mime:
        return 'file'
    if mime.startswith('image/'):
        return 'image'
    if mime.startswith('video/'):
        return 'video'
    return 'file'


def _support_user_picture(pic):
    if not pic:
        return '/static/images/avatars/default.png'
    if pic.startswith('http'):
        return pic
    return f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'


def _support_time_ago(dt):
    if not dt:
        return 'Just now'
    from datetime import datetime as _dt
    if isinstance(dt, str):
        try:
            dt = _dt.strptime(dt, '%Y-%m-%d %H:%M:%S')
        except Exception:
            return 'Just now'
    diff = int((_dt.now() - dt).total_seconds())
    if diff < 60:      return 'Just now'
    if diff < 3600:    return f'{diff // 60}m ago'
    if diff < 86400:   return f'{diff // 3600}h ago'
    if diff < 604800:  return f'{diff // 86400}d ago'
    return dt.strftime('%b %d')


@login_required
def support_view(request):
    """Renders the user-facing Support page."""
    user = request.user

    return render(request, 'dashboard/support.html', {
        'active_page': 'support',
        'user_picture': _support_user_picture(user.picture),
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def api_support_tickets(request):
    """GET — list user's tickets (MySQL)."""
    user_id = request.user.id

    with connection.cursor() as cur:
        cur.execute("""
            SELECT id, type, subject, status, urgency,
                   last_message_at, updated_at, created_at,
                   unread_count,
                   (SELECT message FROM support_messages
                    WHERE ticket_id = support_tickets.id
                    ORDER BY created_at DESC LIMIT 1) AS last_msg
            FROM support_tickets
            WHERE user_id = %s
            ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
        """, [user_id])
        rows = cur.fetchall()

    tickets = []
    for r in rows:
        tickets.append({
            'id': r[0],
            'firebase_id': f'ticket_{r[0]}',
            'mysql_id': r[0],
            'type': r[1] or 'query',
            'subject': r[2] or 'No Subject',
            'status': r[3] or 'open',
            'urgency': r[4] or 'medium',
            'last_message': (r[9] or 'No messages yet')[:100],
            'last_updated': (
                int(r[5].timestamp() * 1000) if r[5]
                else int(r[7].timestamp() * 1000) if r[7] else 0
            ),
            'created_at': r[7].strftime('%Y-%m-%d %H:%M:%S') if r[7] else None,
            'unread_count': int(r[8] or 0),
            'time_ago': _support_time_ago(r[5] or r[7]),
        })

    return JsonResponse({'success': True, 'tickets': tickets})


@login_required
def api_support_messages(request):
    """GET — messages for one ticket (MySQL fallback)."""
    try:
        ticket_id = int(request.GET.get('ticket_id') or 0)
    except (TypeError, ValueError):
        ticket_id = 0
    if ticket_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid ticket ID'})

    user_id = request.user.id

    with connection.cursor() as cur:
        # Verify ownership
        cur.execute(
            "SELECT id FROM support_tickets WHERE id = %s AND user_id = %s",
            [ticket_id, user_id]
        )
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Ticket not found'})

        cur.execute("""
            SELECT id, firebase_id, user_id, admin_id,
                   message, media_url, s3_key, s3_url,
                   file_name, file_size, message_type,
                   sender_type, sender_name, is_read, created_at
            FROM support_messages
            WHERE ticket_id = %s
            ORDER BY created_at ASC
        """, [ticket_id])
        rows = cur.fetchall()

    messages = []
    for r in rows:
        dt = r[14]
        messages.append({
            'id': r[0],
            'firebase_id': r[1],
            'user_id': r[2],
            'admin_id': r[3],
            'message': r[4] or '',
            'content': r[4] or '',
            'media_url': r[5] or '',
            's3_key': r[6] or '',
            's3_url': r[7] or '',
            'file_name': r[8] or '',
            'file_size': int(r[9] or 0),
            'message_type': r[10] or 'text',
            'sender_type': r[11] or 'user',
            'sender_name': r[12] or 'User',
            'is_read': bool(r[13]),
            'timestamp': int(dt.timestamp() * 1000) if dt else 0,
            'created_at': dt.strftime('%Y-%m-%d %H:%M:%S') if dt else None,
        })

    return JsonResponse({'success': True, 'messages': messages})


@login_required
@require_POST
def api_support_create_ticket(request):
    """POST — create ticket + initial message."""
    user = request.user

    subject = (request.POST.get('subject') or '').strip()
    message = (request.POST.get('message') or '').strip()
    ticket_type = (request.POST.get('type') or 'query').strip()
    urgency = (request.POST.get('urgency') or 'medium').strip()

    if not subject or not message:
        return JsonResponse({'success': False, 'error': 'Subject and message required'})

    user_name = user.name or user.username or 'Unknown User'
    user_email = user.email or ''

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO support_tickets
                (user_id, user_name, user_email, type, subject, message,
                 urgency, status, created_at, updated_at, last_message_at, unread_count)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'open', NOW(), NOW(), NOW(), 0)
        """, [user.id, user_name, user_email, ticket_type, subject, message, urgency])
        ticket_id = cur.lastrowid

        cur.execute("""
            INSERT INTO support_messages
                (ticket_id, user_id, message, message_type, sender_type, sender_name, is_read, created_at)
            VALUES (%s, %s, %s, 'text', 'user', %s, 0, NOW())
        """, [ticket_id, user.id, message, user_name])

    # Notify Afham (the admin) if we know his user id
    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM auth WHERE email = %s OR username = %s LIMIT 1",
                [AFHAM_EMAIL, AFHAM_USERNAME]
            )
            row = cur.fetchone()
            if row:
                _notify(
                    user_id=row[0],
                    notif_type='support_ticket',
                    title='🎫 New Support Ticket',
                    message=f'{user_name}: {subject}',
                    icon='headset',
                    link='/support/',
                    actor_id=request.user.id,
                )
    except Exception:
        pass

    return JsonResponse({
        'success': True,
        'ticket_id': ticket_id,
        'firebase_id': f'ticket_{ticket_id}',
        'message': 'Ticket created successfully',
    })


@login_required
@require_POST
def api_support_save_message(request):
    """POST — save a message from the user to MySQL."""
    user = request.user

    try:
        ticket_id = int(request.POST.get('ticket_id') or 0)
    except (TypeError, ValueError):
        ticket_id = 0
    if ticket_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid ticket ID'})

    message_text = (request.POST.get('message') or '').strip()
    message_type = (request.POST.get('message_type') or 'text').strip()
    media_url = (request.POST.get('media_url') or '')[:500]
    s3_key = (request.POST.get('s3_key') or '')[:255]
    s3_url = (request.POST.get('s3_url') or '')[:255]
    file_name = (request.POST.get('file_name') or '')[:255]
    try:
        file_size = int(request.POST.get('file_size') or 0)
    except (TypeError, ValueError):
        file_size = 0
    firebase_id = (request.POST.get('firebase_id') or '')[:255] or None

    with connection.cursor() as cur:
        # Verify ownership
        cur.execute(
            "SELECT id FROM support_tickets WHERE id = %s AND user_id = %s",
            [ticket_id, user.id]
        )
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Ticket not found'})

        cur.execute("""
            INSERT INTO support_messages
                (firebase_id, ticket_id, user_id, message,
                 media_url, s3_key, s3_url, file_name, file_size,
                 message_type, sender_type, sender_name, is_read, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, 'user', %s, 0, NOW())
        """, [
            firebase_id, ticket_id, user.id, message_text,
            media_url, s3_key, s3_url, file_name, file_size,
            message_type, (user.name or user.username or 'User')
        ])
        message_id = cur.lastrowid

        # Update ticket
        last_msg = message_text[:100] if message_text else '📎 Sent an attachment'
        cur.execute("""
            UPDATE support_tickets
            SET last_message_at = NOW(),
                updated_at = NOW(),
                unread_count = unread_count + 1
            WHERE id = %s
        """, [ticket_id])
        # Optional: store last_message too if the column exists
        try:
            cur.execute(
                "UPDATE support_tickets SET last_message = %s WHERE id = %s",
                [last_msg, ticket_id]
            )
        except Exception:
            pass

    return JsonResponse({
        'success': True,
        'message_id': message_id,
        'mysql_id': ticket_id,
    })


@login_required
@require_POST
def api_support_upload_media(request):
    """POST — upload a file to S3 under uploads/support/."""
    user = request.user
    file = request.FILES.get('file')
    if not file:
        return JsonResponse({'success': False, 'error': 'No file uploaded'})

    if file.size > SUPPORT_MAX_MB * 1024 * 1024:
        return JsonResponse({'success': False, 'error': f'File too large (max {SUPPORT_MAX_MB}MB)'})

    mime = file.content_type or 'application/octet-stream'
    if mime not in SUPPORT_ALLOWED_MIME:
        return JsonResponse({'success': False, 'error': 'File type not allowed'})

    key = _upload_to_s3(file, folder=SUPPORT_S3_FOLDER)
    if not key:
        return JsonResponse({'success': False, 'error': 'Upload failed'})

    public_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{key}'

    return JsonResponse({
        'success': True,
        'filename': os.path.basename(key),
        's3_key': key,
        'public_url': public_url,
        'original_name': file.name,
        'size': file.size,
        'type': _support_media_type(mime),
        'mime_type': mime,
    })


@login_required
@require_POST
def api_support_mark_read(request):
    """POST — reset unread_count for a user's ticket."""
    user = request.user
    try:
        ticket_id = int(request.POST.get('ticket_id') or 0)
    except (TypeError, ValueError):
        ticket_id = 0
    if ticket_id <= 0:
        return JsonResponse({'success': False, 'error': 'Invalid ticket ID'})

    with connection.cursor() as cur:
        cur.execute(
            "UPDATE support_tickets SET unread_count = 0 WHERE id = %s AND user_id = %s",
            [ticket_id, user.id]
        )

    return JsonResponse({'success': True})


# ============================================================
# GROUPS
# ============================================================

GROUP_POST_MEDIA_MIMES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg',
}
GROUP_IMAGE_MIMES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
GROUP_MAX_MB = 10


def _grp_s3_base():
    return 'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/'


def _grp_pic_url(pic, default_avatar=True):
    if not pic:
        return '/static/images/avatars/default.png' if default_avatar else ''
    if pic.startswith('http'):
        return pic
    if pic.startswith('uploads/'):
        return _grp_s3_base() + pic
    return _grp_s3_base() + 'uploads/' + pic


def _grp_group_pic_url(pic, kind='profile'):
    """Group profile / cover image — stored under uploads/groups/."""
    if not pic:
        return ''
    if pic.startswith('http'):
        return pic
    if pic.startswith('uploads/'):
        return _grp_s3_base() + pic
    return _grp_s3_base() + 'uploads/groups/' + pic


def _grp_time_ago(dt):
    if not dt:
        return 'No activity'
    from datetime import datetime as _dt
    if isinstance(dt, str):
        try:
            dt = _dt.strptime(dt, '%Y-%m-%d %H:%M:%S')
        except Exception:
            return 'No activity'
    diff = int((_dt.now() - dt).total_seconds())
    if diff < 60:      return 'Just now'
    if diff < 3600:    return f'{diff // 60}m ago'
    if diff < 86400:   return f'{diff // 3600}h ago'
    if diff < 604800:  return f'{diff // 86400}d ago'
    if diff < 2592000: return f'{diff // 604800}w ago'
    return dt.strftime('%b %d, %Y')


def _grp_is_member(group_id, user_id):
    with connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM group_members "
            "WHERE group_id = %s AND user_id = %s AND status = 'approved'",
            [group_id, user_id]
        )
        return cur.fetchone() is not None


def _grp_is_admin(group_id, user_id):
    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM `groups` WHERE id = %s", [group_id])
        row = cur.fetchone()
        if not row:
            return False
        if row[0] == user_id:
            return True
        cur.execute(
            "SELECT role FROM group_members "
            "WHERE group_id = %s AND user_id = %s AND status = 'approved'",
            [group_id, user_id]
        )
        r = cur.fetchone()
        return bool(r and r[0] == 'admin')


def _grp_fetch_card(grow, user_id):
    """
    grow is a tuple:
    (id, title, description, profile_image, cover_image, creator_id,
     privacy, post_approval, created_at,
     creator_name, creator_username, creator_picture,
     member_count, member_status, user_role, has_pending_request,
     post_count, pending_post_count, last_activity)
    """
    (gid, title, description, profile_image, cover_image, creator_id,
     privacy, post_approval, created_at,
     c_name, c_username, c_picture,
     member_count, member_status, user_role, has_pending_request,
     post_count, pending_post_count, last_activity) = grow

    is_creator = (creator_id == user_id)
    if is_creator:
        join_status = 'creator'
    elif member_status == 'approved':
        join_status = 'member'
    elif member_status == 'pending':
        join_status = 'pending'
    elif has_pending_request:
        join_status = 'requested'
    else:
        join_status = 'not_member'

    return {
        'id': gid,
        'title': title or '',
        'description': description or '',
        'profile_image_url': _grp_group_pic_url(profile_image) or '/static/images/avatars/default.png',
        'cover_image_url': _grp_group_pic_url(cover_image) or '/static/images/avatars/default.png',
        'creator_id': creator_id,
        'creator_name': c_name or 'Unknown',
        'creator_username': c_username or '',
        'creator_picture_url': _grp_pic_url(c_picture),
        'privacy': privacy or 'public',
        'post_approval': int(post_approval or 0),
        'member_count': int(member_count or 0),
        'post_count': int(post_count or 0),
        'pending_post_count': int(pending_post_count or 0),
        'member_status': member_status,
        'user_role': user_role,
        'has_pending_request': bool(has_pending_request),
        'is_creator': is_creator,
        'join_status': join_status,
        'last_activity_formatted': _grp_time_ago(last_activity),
        'created_at': created_at.strftime('%Y-%m-%d %H:%M:%S') if created_at else None,
    }


def _grp_fetch_all(user_id):
    sql = """
        SELECT
            g.id, g.title, g.description, g.profile_image, g.cover_image,
            g.creator_id, g.privacy, g.post_approval, g.created_at,
            a.name, a.username, a.picture,
            (SELECT COUNT(*) FROM group_members gm
                WHERE gm.group_id = g.id AND gm.status = 'approved'),
            (SELECT gm.status FROM group_members gm
                WHERE gm.group_id = g.id AND gm.user_id = %s),
            (SELECT gm.role FROM group_members gm
                WHERE gm.group_id = g.id AND gm.user_id = %s),
            EXISTS(SELECT 1 FROM group_join_requests gjr
                WHERE gjr.group_id = g.id AND gjr.user_id = %s AND gjr.status = 'pending'),
            (SELECT COUNT(*) FROM group_posts gp
                WHERE gp.group_id = g.id AND gp.status = 'approved'),
            (SELECT COUNT(*) FROM group_posts gp
                WHERE gp.group_id = g.id AND gp.status = 'pending'),
            (SELECT MAX(created_at) FROM group_posts
                WHERE group_id = g.id AND status = 'approved')
        FROM `groups` g
        LEFT JOIN auth a ON a.id = g.creator_id
        ORDER BY g.created_at DESC
    """
    with connection.cursor() as cur:
        cur.execute(sql, [user_id, user_id, user_id])
        rows = cur.fetchall()
    return [_grp_fetch_card(r, user_id) for r in rows]


def _grp_compute_stats(groups):
    total_posts = sum(g['post_count'] for g in groups)
    total_members = sum(g['member_count'] for g in groups)
    my_count = sum(1 for g in groups if g['join_status'] in ('creator', 'member'))
    return {
        'total_groups': len(groups),
        'total_posts': total_posts,
        'total_members': total_members,
        'my_groups': my_count,
    }


@login_required
def groups_view(request):
    """Renders /groups/ with initial data."""
    user = request.user
    groups = _grp_fetch_all(user.id)
    stats = _grp_compute_stats(groups)

    popular = sorted(groups, key=lambda g: g['member_count'], reverse=True)[:3]
    recent = groups[:4]

    return render(request, 'dashboard/groups.html', {
        'active_page': 'groups',
        'groups': groups,
        'groups_json': json.dumps(groups),
        'stats': stats,
        'popular_groups': popular,
        'recent_groups': recent,
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def api_groups_list(request):
    """GET — JSON list of all groups."""
    return JsonResponse({
        'success': True,
        'groups': _grp_fetch_all(request.user.id),
    })


@login_required
@require_POST
def api_groups_create(request):
    """POST — create a group (multipart)."""
    user = request.user
    title = (request.POST.get('title') or '').strip()
    description = (request.POST.get('description') or '').strip()
    privacy = (request.POST.get('privacy') or 'public').strip()
    post_approval = 1 if (request.POST.get('post_approval') or '0') == '1' else 0

    if not title:
        return JsonResponse({'success': False, 'error': 'Group title is required'})
    if privacy not in ('public', 'private'):
        privacy = 'public'

    profile_key = ''
    cover_key = ''
    pfile = request.FILES.get('profile_image')
    cfile = request.FILES.get('cover_image')
    if pfile:
        if pfile.content_type not in GROUP_IMAGE_MIMES:
            return JsonResponse({'success': False, 'error': 'Profile image must be JPG/PNG/GIF/WebP'})
        if pfile.size > GROUP_MAX_MB * 1024 * 1024:
            return JsonResponse({'success': False, 'error': f'Profile image too large (max {GROUP_MAX_MB}MB)'})
        k = _upload_to_s3(pfile, folder='uploads/groups')
        if k:
            profile_key = k
    if cfile:
        if cfile.content_type not in GROUP_IMAGE_MIMES:
            return JsonResponse({'success': False, 'error': 'Cover image must be JPG/PNG/GIF/WebP'})
        if cfile.size > GROUP_MAX_MB * 1024 * 1024:
            return JsonResponse({'success': False, 'error': f'Cover image too large (max {GROUP_MAX_MB}MB)'})
        k = _upload_to_s3(cfile, folder='uploads/groups')
        if k:
            cover_key = k

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO `groups`
                (title, description, profile_image, cover_image,
                 creator_id, privacy, post_approval, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        """, [title, description, profile_key, cover_key,
              user.id, privacy, post_approval])
        group_id = cur.lastrowid

        cur.execute("""
            INSERT INTO group_members
                (group_id, user_id, status, role, joined_at)
            VALUES (%s, %s, 'approved', 'admin', NOW())
        """, [group_id, user.id])

    return JsonResponse({
        'success': True,
        'message': 'Group created successfully',
        'group_id': group_id,
    })


@login_required
@require_POST
def api_groups_edit(request, group_id):
    """POST — edit own group (multipart)."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute(
            "SELECT creator_id, profile_image, cover_image "
            "FROM `groups` WHERE id = %s",
            [group_id]
        )
        row = cur.fetchone()
    if not row or row[0] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    title = (request.POST.get('title') or '').strip()
    description = (request.POST.get('description') or '').strip()
    privacy = (request.POST.get('privacy') or 'public').strip()
    post_approval = 1 if (request.POST.get('post_approval') or '0') == '1' else 0

    if not title:
        return JsonResponse({'success': False, 'error': 'Group title is required'})
    if privacy not in ('public', 'private'):
        privacy = 'public'

    profile_key = row[1] or ''
    cover_key = row[2] or ''
    pfile = request.FILES.get('profile_image')
    cfile = request.FILES.get('cover_image')
    if pfile and pfile.content_type in GROUP_IMAGE_MIMES:
        k = _upload_to_s3(pfile, folder='uploads/groups')
        if k:
            if profile_key:
                _delete_from_s3([profile_key])
            profile_key = k
    if cfile and cfile.content_type in GROUP_IMAGE_MIMES:
        k = _upload_to_s3(cfile, folder='uploads/groups')
        if k:
            if cover_key:
                _delete_from_s3([cover_key])
            cover_key = k

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE `groups`
            SET title = %s, description = %s, profile_image = %s,
                cover_image = %s, privacy = %s, post_approval = %s,
                updated_at = NOW()
            WHERE id = %s
        """, [title, description, profile_key, cover_key,
              privacy, post_approval, group_id])

    return JsonResponse({'success': True, 'message': 'Group updated successfully'})


@login_required
@require_POST
def api_groups_delete(request, group_id):
    """POST — delete own group + all its content."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute(
            "SELECT creator_id, profile_image, cover_image "
            "FROM `groups` WHERE id = %s",
            [group_id]
        )
        row = cur.fetchone()
    if not row or row[0] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    # Collect S3 keys before deleting rows
    s3_keys = []
    if row[1]:
        s3_keys.append(row[1])
    if row[2]:
        s3_keys.append(row[2])

    with connection.cursor() as cur:
        cur.execute(
            "SELECT media_url FROM group_media gm "
            "JOIN group_posts gp ON gm.post_id = gp.id "
            "WHERE gp.group_id = %s",
            [group_id]
        )
        for r in cur.fetchall():
            if r[0] and not r[0].startswith('http'):
                s3_keys.append(r[0].lstrip('/'))

        # Cascade: media → comments → interactions → posts → members → requests → group
        cur.execute(
            "DELETE gm FROM group_media gm "
            "JOIN group_posts gp ON gm.post_id = gp.id "
            "WHERE gp.group_id = %s",
            [group_id]
        )
        cur.execute(
            "DELETE gc FROM group_comments gc "
            "JOIN group_posts gp ON gc.post_id = gp.id "
            "WHERE gp.group_id = %s",
            [group_id]
        )
        cur.execute(
            "DELETE gui FROM group_user_interactions gui "
            "JOIN group_posts gp ON gui.post_id = gp.id "
            "WHERE gp.group_id = %s",
            [group_id]
        )
        cur.execute("DELETE FROM group_posts WHERE group_id = %s", [group_id])
        cur.execute("DELETE FROM group_members WHERE group_id = %s", [group_id])
        cur.execute("DELETE FROM group_join_requests WHERE group_id = %s", [group_id])
        cur.execute("DELETE FROM `groups` WHERE id = %s", [group_id])

    if s3_keys:
        _delete_from_s3(s3_keys)

    return JsonResponse({'success': True, 'message': 'Group deleted successfully'})


@login_required
@require_POST
def api_groups_join(request, group_id):
    """POST — join a public group."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute(
            "SELECT privacy FROM `groups` WHERE id = %s",
            [group_id]
        )
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Group not found'})
    if row[0] == 'private':
        return JsonResponse({'success': False, 'error': 'This is a private group. Request to join.'})

    with connection.cursor() as cur:
        cur.execute(
            "SELECT status FROM group_members WHERE group_id = %s AND user_id = %s",
            [group_id, user.id]
        )
        r = cur.fetchone()
        if r and r[0] in ('approved', 'pending'):
            return JsonResponse({'success': False, 'error': 'Already a member or pending'})

        cur.execute("""
            INSERT INTO group_members (group_id, user_id, status, role, joined_at)
            VALUES (%s, %s, 'approved', 'member', NOW())
            ON DUPLICATE KEY UPDATE status = 'approved', role = 'member'
        """, [group_id, user.id])

    return JsonResponse({'success': True, 'message': 'Successfully joined the group'})


@login_required
@require_POST
def api_groups_leave(request, group_id):
    """POST — leave group (creator blocked)."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM `groups` WHERE id = %s", [group_id])
        row = cur.fetchone()
        if row and row[0] == user.id:
            return JsonResponse({'success': False, 'error': 'Creator cannot leave. Delete the group instead.'})

        cur.execute(
            "DELETE FROM group_members WHERE group_id = %s AND user_id = %s",
            [group_id, user.id]
        )
        cur.execute(
            "DELETE FROM group_join_requests WHERE group_id = %s AND user_id = %s",
            [group_id, user.id]
        )

    return JsonResponse({'success': True, 'message': 'Left group successfully'})


@login_required
@require_POST
def api_groups_request_join(request, group_id):
    """POST — request to join a private group."""
    user = request.user
    import json as _json
    try:
        payload = _json.loads(request.body)
    except Exception:
        payload = {}
    message = (payload.get('message') or '').strip()

    with connection.cursor() as cur:
        cur.execute(
            "SELECT id FROM group_join_requests "
            "WHERE group_id = %s AND user_id = %s AND status = 'pending'",
            [group_id, user.id]
        )
        if cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Request already pending'})

        cur.execute(
            "SELECT status FROM group_members WHERE group_id = %s AND user_id = %s",
            [group_id, user.id]
        )
        r = cur.fetchone()
        if r and r[0] == 'approved':
            return JsonResponse({'success': False, 'error': 'Already a member'})

        cur.execute("""
            INSERT INTO group_join_requests
                (group_id, user_id, message, status, requested_at)
            VALUES (%s, %s, %s, 'pending', NOW())
        """, [group_id, user.id, message])

        cur.execute("""
            INSERT INTO group_members (group_id, user_id, status, role, joined_at)
            VALUES (%s, %s, 'pending', 'member', NOW())
            ON DUPLICATE KEY UPDATE status = 'pending'
        """, [group_id, user.id])

    return JsonResponse({'success': True, 'message': 'Join request sent successfully'})


@login_required
def api_groups_pending_posts(request, group_id):
    """GET — pending posts for admin moderation."""
    if not _grp_is_admin(group_id, request.user.id):
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute("""
            SELECT gp.id, gp.content, gp.created_at, gp.user_id,
                   a.name, a.username, a.picture,
                   EXISTS(SELECT 1 FROM group_media WHERE post_id = gp.id)
            FROM group_posts gp
            JOIN auth a ON gp.user_id = a.id
            WHERE gp.group_id = %s AND gp.status = 'pending'
            ORDER BY gp.created_at DESC
        """, [group_id])
        rows = cur.fetchall()

    posts = []
    for r in rows:
        posts.append({
            'id': r[0],
            'content': r[1] or '',
            'created_at': r[2].strftime('%Y-%m-%d %H:%M:%S') if r[2] else None,
            'author': {
                'id': r[3],
                'name': r[4] or r[5] or 'User',
                'username': r[5] or '',
                'picture': _grp_pic_url(r[6]),
            },
            'has_media': bool(r[7]),
            'time_ago': _grp_time_ago(r[2]),
        })

    return JsonResponse({'success': True, 'posts': posts})


@login_required
@require_POST
def api_groups_post_approve(request, post_id):
    """POST — approve a pending group post."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute("SELECT group_id FROM group_posts WHERE id = %s", [post_id])
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})
    if not _grp_is_admin(row[0], user.id):
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE group_posts
            SET status = 'approved', approved_at = NOW(), approved_by = %s
            WHERE id = %s
        """, [user.id, post_id])

    return JsonResponse({'success': True, 'message': 'Post approved'})


@login_required
@require_POST
def api_groups_post_reject(request, post_id):
    """POST — reject a pending group post."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute("SELECT group_id FROM group_posts WHERE id = %s", [post_id])
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})
    if not _grp_is_admin(row[0], user.id):
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE group_posts
            SET status = 'rejected', rejected_at = NOW(), rejected_by = %s
            WHERE id = %s
        """, [user.id, post_id])

    return JsonResponse({'success': True, 'message': 'Post rejected'})


# ============================================================
# GROUP DETAIL PAGE
# ============================================================

def _grp_fetch_group(group_id):
    with connection.cursor() as cur:
        cur.execute("""
            SELECT g.id, g.title, g.description, g.cover_image, g.profile_image,
                   g.creator_id, g.privacy, g.post_approval, g.created_at,
                   a.username, a.name, a.picture
            FROM `groups` g
            LEFT JOIN auth a ON a.id = g.creator_id
            WHERE g.id = %s
        """, [group_id])
        return cur.fetchone()


@login_required
def group_view_view(request, group_id):
    """Renders /groups/<id>/ detail page."""
    user = request.user
    g = _grp_fetch_group(group_id)
    if not g:
        return redirect('/groups/')

    (gid, title, description, cover, profile, creator_id,
     privacy, post_approval, created_at,
     c_username, c_name, c_picture) = g

    is_creator = (creator_id == user.id)

    with connection.cursor() as cur:
        cur.execute(
            "SELECT status, role FROM group_members "
            "WHERE group_id = %s AND user_id = %s",
            [group_id, user.id]
        )
        m = cur.fetchone()

    membership_status = 'none'
    is_member = False
    is_admin = is_creator
    if m:
        if m[0] == 'approved':
            is_member = True
            membership_status = 'member'
            if m[1] == 'admin' or is_creator:
                is_admin = True
                membership_status = 'admin'
        elif m[0] == 'pending':
            membership_status = 'pending'

    # Ensure creator is in group_members
    if is_creator and not is_member:
        with connection.cursor() as cur:
            cur.execute("""
                INSERT IGNORE INTO group_members
                    (group_id, user_id, status, role, joined_at)
                VALUES (%s, %s, 'approved', 'admin', NOW())
            """, [group_id, user.id])
        is_member = True
        is_admin = True
        membership_status = 'admin'

    with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM group_members "
            "WHERE group_id = %s AND status = 'approved'",
            [group_id]
        )
        members_count = cur.fetchone()[0] or 0

        if is_admin:
            cur.execute("SELECT COUNT(*) FROM group_posts WHERE group_id = %s", [group_id])
        else:
            cur.execute(
                "SELECT COUNT(*) FROM group_posts "
                "WHERE group_id = %s AND status = 'approved'",
                [group_id]
            )
        posts_count = cur.fetchone()[0] or 0

    creator = {
        'id': creator_id,
        'name': c_name or 'Unknown',
        'username': c_username or 'unknown',
        'picture': _grp_pic_url(c_picture),
        'is_admin': True,
    }

    # Recent members (sidebar widget)
    recent_members = []
    with connection.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.name, u.username, u.picture, gm.role
            FROM group_members gm
            JOIN auth u ON u.id = gm.user_id
            WHERE gm.group_id = %s AND gm.status = 'approved'
            ORDER BY gm.joined_at DESC
            LIMIT 12
        """, [group_id])
        for r in cur.fetchall():
            recent_members.append({
                'id': r[0],
                'name': r[1] or r[2] or 'User',
                'username': r[2] or '',
                'picture': _grp_pic_url(r[3]),
                'is_admin': (r[4] == 'admin' or r[0] == creator_id),
            })

    if not any(m['id'] == creator['id'] for m in recent_members):
        recent_members.insert(0, creator)

    # Members-for-mention (only if member)
    mention_members = []
    if is_member:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT u.id, u.name, u.username, u.picture
                FROM group_members gm
                JOIN auth u ON gm.user_id = u.id
                WHERE gm.group_id = %s AND gm.status = 'approved'
                ORDER BY u.name ASC
                LIMIT 50
            """, [group_id])
            for r in cur.fetchall():
                mention_members.append({
                    'id': r[0],
                    'name': r[1] or '',
                    'username': r[2] or '',
                    'picture': _grp_pic_url(r[3]),
                })

    can_post = is_member and (int(post_approval or 0) == 0 or is_admin)

    group_data = {
        'id': gid,
        'title': title or '',
        'description': description or '',
        'cover_image_url': _grp_group_pic_url(cover) or '/static/images/avatars/default.png',
        'profile_image_url': _grp_group_pic_url(profile) or '/static/images/avatars/default.png',
        'creator_id': creator_id,
        'creator_name': c_name or 'Unknown',
        'creator_username': c_username or '',
        'creator_picture_url': _grp_pic_url(c_picture),
        'privacy': privacy or 'public',
        'post_approval': int(post_approval or 0),
        'created_at': created_at.strftime('%Y-%m-%d %H:%M:%S') if created_at else None,
        'created_date_display': created_at.strftime('%b %d, %Y') if created_at else 'Unknown',
    }

    return render(request, 'dashboard/group_view.html', {
        'active_page': 'groups',
        'group': group_data,
        'group_id': group_id,
        'creator': creator,
        'is_creator': is_creator,
        'is_admin': is_admin,
        'is_member': is_member,
        'membership_status': membership_status,
        'can_post': can_post,
        'members_count': members_count,
        'posts_count': posts_count,
        'recent_members': recent_members,
        'mention_members_json': json.dumps(mention_members),
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def api_groups_members(request, group_id):
    """GET — approved members of a group."""
    with connection.cursor() as cur:
        cur.execute("""
            SELECT u.id, u.name, u.username, u.picture, gm.role
            FROM group_members gm
            JOIN auth u ON u.id = gm.user_id
            WHERE gm.group_id = %s AND gm.status = 'approved'
            ORDER BY gm.joined_at DESC
        """, [group_id])
        rows = cur.fetchall()

    members = [{
        'id': r[0],
        'name': r[1] or r[2] or 'User',
        'username': r[2] or '',
        'picture': _grp_pic_url(r[3]),
        'is_admin': r[4] == 'admin',
    } for r in rows]

    return JsonResponse({'success': True, 'members': members})


def _grp_format_post(row, user_id):
    """row: (id, group_id, user_id, content, status,
             views, likes, dislikes, comments, shares,
             created_at, updated_at,
             author_id, author_name, author_username, author_picture,
             user_reaction)"""
    pid = row[0]
    with connection.cursor() as cur:
        cur.execute(
            "SELECT media_url, media_type, mime_type FROM group_media "
            "WHERE post_id = %s ORDER BY id ASC",
            [pid]
        )
        media = []
        for m in cur.fetchall():
            url = m[0] or ''
            if url and not url.startswith('http'):
                if url.startswith('uploads/'):
                    url = _grp_s3_base() + url
                else:
                    url = _grp_s3_base() + 'uploads/group_posts/' + url
            media.append({'url': url, 'type': m[1] or 'image', 'mime_type': m[2] or 'image/jpeg'})

    return {
        'id': pid,
        'content': row[3] or '',
        'author': {
            'id': row[12] or row[2],
            'name': row[13] or row[14] or 'User',
            'username': row[14] or '',
            'picture': _grp_pic_url(row[15]),
        },
        'media': media,
        'views': int(row[5] or 0),
        'likes': int(row[6] or 0),
        'dislikes': int(row[7] or 0),
        'comments_count': int(row[8] or 0),
        'shares': int(row[9] or 0),
        'user_reaction': row[16],
        'time_ago': _grp_time_ago(row[10]),
        'created_at': row[10].strftime('%Y-%m-%d %H:%M:%S') if row[10] else None,
        'is_edited': bool(row[11] and row[10] and row[11] > row[10]),
    }


@login_required
def api_groups_posts_list(request, group_id):
    """GET — paginated approved posts."""
    try:
        page = max(1, int(request.GET.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    limit = 10
    offset = (page - 1) * limit

    if not _grp_is_member(group_id, request.user.id):
        return JsonResponse({'success': True, 'posts': [], 'has_more': False})

    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT gp.id, gp.group_id, gp.user_id, gp.content, gp.status,
                   gp.views_count, gp.likes_count, gp.dislikes_count,
                   gp.comments_count, gp.shares_count,
                   gp.created_at, gp.updated_at,
                   a.id, a.name, a.username, a.picture,
                   gui.reaction
            FROM group_posts gp
            JOIN auth a ON gp.user_id = a.id
            LEFT JOIN group_user_interactions gui
                ON gui.post_id = gp.id AND gui.user_id = %s
            WHERE gp.group_id = %s AND gp.status = 'approved'
            ORDER BY gp.created_at DESC
            LIMIT %s OFFSET %s
        """, [user_id, group_id, limit, offset])
        rows = cur.fetchall()

        cur.execute(
            "SELECT COUNT(*) FROM group_posts "
            "WHERE group_id = %s AND status = 'approved'",
            [group_id]
        )
        total = cur.fetchone()[0] or 0

    posts = [_grp_format_post(r, user_id) for r in rows]

    return JsonResponse({
        'success': True,
        'posts': posts,
        'has_more': (offset + len(posts)) < total,
        'page': page,
        'total': total,
    })


@login_required
@require_POST
def api_groups_posts_create(request, group_id):
    """POST — create a group post (multipart, supports media)."""
    user = request.user
    if not _grp_is_member(group_id, user.id):
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    content = (request.POST.get('content') or '').strip()
    media_files = request.FILES.getlist('media[]') or request.FILES.getlist('media')

    if not content and not media_files:
        return JsonResponse({'success': False, 'error': 'Post cannot be empty'})

    if len(content) > 500:
        return JsonResponse({'success': False, 'error': 'Post too long (max 500)'})

    is_admin = _grp_is_admin(group_id, user.id)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT post_approval FROM `groups` WHERE id = %s",
            [group_id]
        )
        row = cur.fetchone()
    post_approval = int(row[0] or 0) if row else 0
    status = 'approved' if (post_approval == 0 or is_admin) else 'pending'

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO group_posts
                (group_id, user_id, content, status, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        """, [group_id, user.id, content, status])
        post_id = cur.lastrowid

    for f in media_files:
        mime = f.content_type or 'application/octet-stream'
        if mime not in GROUP_POST_MEDIA_MIMES:
            continue
        if f.size > GROUP_MAX_MB * 1024 * 1024:
            continue
        key = _upload_to_s3(f, folder='uploads/group_posts')
        if not key:
            continue
        mtype = 'image' if mime.startswith('image/') else 'video'
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO group_media (post_id, media_url, media_type, mime_type)
                VALUES (%s, %s, %s, %s)
            """, [post_id, key, mtype, mime])

    return JsonResponse({
        'success': True,
        'message': 'Post created successfully',
        'post_id': post_id,
        'status': status,
    })


@login_required
@require_POST
def api_groups_post_delete(request, post_id):
    """POST — soft delete a post (author or group admin)."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute(
            "SELECT user_id, group_id FROM group_posts WHERE id = %s",
            [post_id]
        )
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})

    is_owner = row[0] == user.id
    is_admin = _grp_is_admin(row[1], user.id)
    if not is_owner and not is_admin:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    s3_keys = []
    with connection.cursor() as cur:
        cur.execute("SELECT media_url FROM group_media WHERE post_id = %s", [post_id])
        for r in cur.fetchall():
            if r[0] and not r[0].startswith('http'):
                s3_keys.append(r[0].lstrip('/'))

        _cascade_delete_notifications([f'/groups/{row[1]}/%', f'%post_id={post_id}%'])
        cur.execute("DELETE FROM group_media WHERE post_id = %s", [post_id])
        cur.execute("DELETE FROM group_comments WHERE post_id = %s", [post_id])
        cur.execute("DELETE FROM group_user_interactions WHERE post_id = %s", [post_id])
        cur.execute("DELETE FROM group_posts WHERE id = %s", [post_id])

    if s3_keys:
        _delete_from_s3(s3_keys)

    return JsonResponse({'success': True, 'message': 'Post deleted'})

@login_required
@require_POST
def api_groups_post_edit(request, post_id):
    """POST — edit own group post (content + add/remove/keep media)."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute(
            "SELECT user_id, group_id FROM group_posts WHERE id = %s",
            [post_id]
        )
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})
    if row[0] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})
    group_id = row[1]

    content = (request.POST.get('content') or '').strip()
    if len(content) > 500:
        return JsonResponse({'success': False, 'error': 'Post too long (max 500)'})

    existing_raw = (request.POST.get('existing_media') or '').strip()
    existing_urls = [u.strip() for u in existing_raw.split(',') if u.strip()] if existing_raw else []
    new_files = request.FILES.getlist('new_media[]') or request.FILES.getlist('new_media')

    if not content and not existing_urls and not new_files:
        return JsonResponse({'success': False, 'error': 'Post cannot be empty'})

    def _to_full(raw):
        if not raw:
            return ''
        if raw.startswith('http'):
            return raw
        if raw.startswith('uploads/'):
            return _grp_s3_base() + raw
        return _grp_s3_base() + 'uploads/group_posts/' + raw

    # 1) Content update — set updated_at so "Edited" badge appears
    with connection.cursor() as cur:
        cur.execute(
            "UPDATE group_posts SET content = %s, updated_at = NOW() WHERE id = %s",
            [content, post_id]
        )

    # 2) Remove media rows not in existing_urls; also delete S3 objects
    s3_to_delete = []
    with connection.cursor() as cur:
        cur.execute(
            "SELECT id, media_url FROM group_media WHERE post_id = %s",
            [post_id]
        )
        media_rows = cur.fetchall()

        if existing_urls:
            for mid, murl in media_rows:
                if _to_full(murl) not in existing_urls:
                    if murl and not murl.startswith('http'):
                        s3_to_delete.append(murl.lstrip('/'))
                    cur.execute("DELETE FROM group_media WHERE id = %s", [mid])
        else:
            for mid, murl in media_rows:
                if murl and not murl.startswith('http'):
                    s3_to_delete.append(murl.lstrip('/'))
            cur.execute("DELETE FROM group_media WHERE post_id = %s", [post_id])

    # 3) Add new media files
    for f in new_files:
        mime = f.content_type or 'application/octet-stream'
        if mime not in GROUP_POST_MEDIA_MIMES:
            continue
        if f.size > GROUP_MAX_MB * 1024 * 1024:
            continue
        key = _upload_to_s3(f, folder='uploads/group_posts')
        if not key:
            continue
        mtype = 'image' if mime.startswith('image/') else 'video'
        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO group_media (post_id, media_url, media_type, mime_type) "
                "VALUES (%s, %s, %s, %s)",
                [post_id, key, mtype, mime]
            )

    # 4) Delete orphaned S3 files
    if s3_to_delete:
        _delete_from_s3(s3_to_delete)

    # 5) Return the refreshed post
    with connection.cursor() as cur:
        cur.execute("""
            SELECT gp.id, gp.group_id, gp.user_id, gp.content, gp.status,
                   gp.views_count, gp.likes_count, gp.dislikes_count,
                   gp.comments_count, gp.shares_count,
                   gp.created_at, gp.updated_at,
                   a.id, a.name, a.username, a.picture,
                   gui.reaction
            FROM group_posts gp
            JOIN auth a ON gp.user_id = a.id
            LEFT JOIN group_user_interactions gui
                ON gui.post_id = gp.id AND gui.user_id = %s
            WHERE gp.id = %s
        """, [user.id, post_id])
        prow = cur.fetchone()

    return JsonResponse({
        'success': True,
        'message': 'Post updated successfully',
        'post': _grp_format_post(prow, user.id),
    })

@login_required
@require_POST
def api_groups_post_react(request, post_id):
    """POST — like/dislike toggle on a post."""
    import json as _json
    try:
        data = _json.loads(request.body)
    except Exception:
        data = {}
    reaction = (data.get('reaction') or '').strip()
    if reaction not in ('like', 'dislike'):
        return JsonResponse({'success': False, 'error': 'Invalid reaction'})

    user = request.user
    with connection.cursor() as cur:
        cur.execute("SELECT group_id FROM group_posts WHERE id = %s", [post_id])
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})
    if not _grp_is_member(row[0], user.id):
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute(
            "SELECT id, reaction FROM group_user_interactions "
            "WHERE user_id = %s AND post_id = %s",
            [user.id, post_id]
        )
        existing = cur.fetchone()

        new_reaction = None
        if existing:
            ix_id, cur_react = existing
            if cur_react == reaction:
                cur.execute("UPDATE group_user_interactions SET reaction = NULL WHERE id = %s", [ix_id])
                col = 'likes_count' if reaction == 'like' else 'dislikes_count'
                cur.execute(
                    f"UPDATE group_posts SET {col} = GREATEST({col} - 1, 0) WHERE id = %s",
                    [post_id]
                )
                new_reaction = None
            else:
                cur.execute(
                    "UPDATE group_user_interactions SET reaction = %s WHERE id = %s",
                    [reaction, ix_id]
                )
                if cur_react == 'like':
                    cur.execute("""
                        UPDATE group_posts
                        SET likes_count = GREATEST(likes_count - 1, 0),
                            dislikes_count = dislikes_count + 1
                        WHERE id = %s
                    """, [post_id])
                elif cur_react == 'dislike':
                    cur.execute("""
                        UPDATE group_posts
                        SET dislikes_count = GREATEST(dislikes_count - 1, 0),
                            likes_count = likes_count + 1
                        WHERE id = %s
                    """, [post_id])
                else:
                    col = 'likes_count' if reaction == 'like' else 'dislikes_count'
                    cur.execute(
                        f"UPDATE group_posts SET {col} = {col} + 1 WHERE id = %s",
                        [post_id]
                    )
                new_reaction = reaction
        else:
            cur.execute(
                "INSERT INTO group_user_interactions (user_id, post_id, reaction) "
                "VALUES (%s, %s, %s)",
                [user.id, post_id, reaction]
            )
            col = 'likes_count' if reaction == 'like' else 'dislikes_count'
            cur.execute(
                f"UPDATE group_posts SET {col} = {col} + 1 WHERE id = %s",
                [post_id]
            )
            new_reaction = reaction

        cur.execute(
            "SELECT likes_count, dislikes_count FROM group_posts WHERE id = %s",
            [post_id]
        )
        counts = cur.fetchone()

    if new_reaction == 'like':
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT user_id, group_id FROM group_posts WHERE id = %s", [post_id])
                gp_row = cur.fetchone()
                if gp_row and gp_row[0] != user.id:
                    actor_name = user.name or user.username or 'Someone'
                    _notify(
                        user_id=gp_row[0],
                        notif_type='reaction',
                        title=f'{actor_name} liked your group post',
                        message=f'{actor_name} liked your post in the group',
                        icon='heart',
                        link=f'/groups/{gp_row[1]}/',
                        actor_id=user.id
                    )
        except Exception:
            pass

    return JsonResponse({
        'success': True,
        'likes': int(counts[0] or 0),
        'dislikes': int(counts[1] or 0),
        'user_reaction': new_reaction,
    })


@login_required
def api_groups_post_comments(request, post_id):
    """GET — comments for a post."""
    with connection.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.content, c.created_at,
                   a.id, a.name, a.username, a.picture
            FROM group_comments c
            JOIN auth a ON c.user_id = a.id
            WHERE c.post_id = %s
            ORDER BY c.created_at ASC
        """, [post_id])
        rows = cur.fetchall()

    comments = [{
        'id': r[0],
        'content': r[1] or '',
        'author': {
            'id': r[3],
            'name': r[4] or r[5] or 'User',
            'username': r[5] or '',
            'picture': _grp_pic_url(r[6]),
        },
        'time_ago': _grp_time_ago(r[2]),
    } for r in rows]

    return JsonResponse({'success': True, 'comments': comments})


@login_required
@require_POST
def api_groups_post_comment_add(request, post_id):
    """POST — add a comment."""
    import json as _json
    try:
        data = _json.loads(request.body)
    except Exception:
        data = {}
    content = (data.get('content') or '').strip()
    if not content:
        return JsonResponse({'success': False, 'error': 'Comment required'})

    user = request.user
    with connection.cursor() as cur:
        cur.execute("SELECT group_id FROM group_posts WHERE id = %s", [post_id])
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})
    if not _grp_is_member(row[0], user.id):
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO group_comments (post_id, user_id, content, created_at)
            VALUES (%s, %s, %s, NOW())
        """, [post_id, user.id, content])
        comment_id = cur.lastrowid

        cur.execute(
            "UPDATE group_posts SET comments_count = comments_count + 1 WHERE id = %s",
            [post_id]
        )

        cur.execute("SELECT user_id, group_id FROM group_posts WHERE id = %s", [post_id])
        gp_row = cur.fetchone()
        if gp_row and gp_row[0] != user.id:
            actor_name = user.name or user.username or 'Someone'
            _notify(
                user_id=gp_row[0],
                notif_type='comment',
                title=f'{actor_name} commented on your group post',
                message=f'{actor_name}: {content[:100]}',
                icon='comment',
                link=f'/groups/{gp_row[1]}/',
                actor_id=user.id
            )

        cur.execute("""
            SELECT c.id, c.content, c.created_at,
                   a.id, a.name, a.username, a.picture
            FROM group_comments c
            JOIN auth a ON c.user_id = a.id
            WHERE c.id = %s
        """, [comment_id])
        r = cur.fetchone()

    return JsonResponse({
        'success': True,
        'comment': {
            'id': r[0],
            'content': r[1] or '',
            'author': {
                'id': r[3],
                'name': r[4] or r[5] or 'User',
                'username': r[5] or '',
                'picture': _grp_pic_url(r[6]),
            },
            'time_ago': 'Just now',
        }
    })


@login_required
@require_POST
def api_groups_post_comment_delete(request, comment_id):
    """POST — delete own comment."""
    user = request.user
    with connection.cursor() as cur:
        cur.execute(
            "SELECT user_id, post_id FROM group_comments WHERE id = %s",
            [comment_id]
        )
        row = cur.fetchone()
    if not row:
        return JsonResponse({'success': False, 'error': 'Comment not found'})
    if row[0] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute("DELETE FROM group_comments WHERE id = %s", [comment_id])
        cur.execute(
            "UPDATE group_posts "
            "SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = %s",
            [row[1]]
        )

    return JsonResponse({'success': True})

# ============================================================


# ============================================================
# PAGES MODULE ? HELPERS
# ============================================================

def _pg_pic_url(key, kind='profile'):
    """Generate full S3 URL for page profile avatar or cover image."""
    default = '/static/images/avatars/default.png' if kind == 'profile' else '/static/images/covers/default.jpeg'
    if not key:
        return default
    if key.startswith('http://') or key.startswith('https://'):
        return key
    if key.startswith('assets/'):
        return '/' + key
    clean = key if key.startswith('uploads/') else 'uploads/' + key
    return f"https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{clean}"


def _pg_ends_in(ends_at):
    """Future-mode time countdown for poll expiration."""
    from datetime import datetime
    if not ends_at:
        return None
    if isinstance(ends_at, str):
        try:
            ends_at = datetime.strptime(ends_at, '%Y-%m-%d %H:%M:%S')
        except Exception:
            return None
    diff = int((ends_at - datetime.now()).total_seconds())
    if diff < 0:
        return 'Ended'
    if diff < 60:
        return 'Ends in seconds'
    if diff < 3600:
        return f'Ends in {diff // 60}m'
    if diff < 86400:
        return f'Ends in {diff // 3600}h'
    if diff < 604800:
        return f'Ends in {diff // 86400}d'
    if diff < 2592000:
        return f'Ends in {diff // 604800}w'
    return f'Ends in {diff // 2592000}mo'


def _pg_page_is_admin(page_id, user_id):
    """Check if user is creator/owner of the page."""
    if not user_id or not page_id:
        return False
    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM pages WHERE id = %s", [page_id])
        row = cur.fetchone()
    return bool(row and row[0] == user_id)


def _pg_page_is_follower(page_id, user_id):
    """Check if user follows the page."""
    if not user_id or not page_id:
        return False
    with connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM page_followers WHERE page_id = %s AND user_id = %s",
            [page_id, user_id]
        )
        return bool(cur.fetchone())


def _pg_format_page(row, user_id):
    """
    Format raw SQL row from pages table into dictionary.
    Row: (id, creator_id, title, description, cover_image, profile_image, created_at,
          creator_name, creator_username, creator_picture, follower_count,
          is_following, post_count, last_activity)
    """
    pid = row[0]
    creator_id = row[1]
    return {
        'id': pid,
        'creator_id': creator_id,
        'title': row[2] or '',
        'description': row[3] or '',
        'cover_image_url': _pg_pic_url(row[4], kind='cover'),
        'profile_image_url': _pg_pic_url(row[5], kind='profile'),
        'created_at': str(row[6]) if row[6] else '',
        'creator_name': row[7] or 'User',
        'creator_username': row[8] or '',
        'creator_picture_url': _media_url(row[9]) if row[9] else '/static/images/avatars/default.png',
        'follower_count': int(row[10] or 0),
        'is_following': bool(row[11]),
        'post_count': int(row[12] or 0),
        'last_activity_formatted': _time_ago(row[13]) if row[13] else 'No activity',
        'is_creator': (creator_id == user_id),
    }


def _pg_format_post(row, user_id, can_react=True):
    """
    Format raw row from page_posts into dict matching PHP formatPostData.
    Row: (id, page_id, creator_id, content, created_at, views_count, likes_count, dislikes_count,
          comments_count, shares_count, updated_at, author_name, author_username, author_picture)
    """
    post_id = row[0]
    page_id = row[1]
    creator_id = row[2]
    content = row[3] or ''
    created_at = row[4]
    views = int(row[5] or 0)
    likes = int(row[6] or 0)
    dislikes = int(row[7] or 0)
    comments_count = int(row[8] or 0)
    shares = int(row[9] or 0)
    updated_at = row[10]
    author_name = row[11] or 'User'
    author_username = row[12] or ''
    author_picture = row[13]

    is_edited = bool(updated_at and created_at and updated_at != created_at)
    share_url = f"https://xapyx.com/pages/{page_id}/?post={post_id}"

    media = []
    user_reaction = None
    is_saved = False
    poll = None
    mentions = []

    with connection.cursor() as cur:
        cur.execute(
            "SELECT media_url, media_type, mime_type FROM page_media WHERE post_id = %s ORDER BY id ASC",
            [post_id]
        )
        for m in cur.fetchall():
            media.append({'url': _media_url(m[0]), 'type': m[1], 'mime_type': m[2] or ''})

        if user_id:
            cur.execute(
                "SELECT reaction, has_saved FROM page_user_interactions WHERE post_id = %s AND user_id = %s",
                [post_id, user_id]
            )
            inter = cur.fetchone()
            if inter:
                user_reaction = inter[0]
                is_saved = bool(inter[1])

        cur.execute("SELECT question, options, ends_at FROM page_polls WHERE post_id = %s", [post_id])
        p_row = cur.fetchone()
        if p_row:
            question, opts_json, ends_at = p_row
            opts = json.loads(opts_json) if opts_json else []
            tot_v = sum(o.get('votes', 0) for o in opts)
            for o in opts:
                o['percentage'] = round((o.get('votes', 0) / tot_v) * 100) if tot_v > 0 else 0
            u_vote = None
            if user_id:
                cur.execute("SELECT poll_vote_index FROM page_user_interactions WHERE post_id = %s AND user_id = %s", [post_id, user_id])
                v_row = cur.fetchone()
                if v_row:
                    u_vote = v_row[0]
            poll = {
                'question': question,
                'options': opts,
                'total_votes': tot_v,
                'user_vote': u_vote,
                'ends_at': str(ends_at) if ends_at else None,
                'ends_in': _pg_ends_in(ends_at)
            }

        cur.execute("SELECT pm.mentioned_user_id, a.username, a.name FROM page_mentions pm LEFT JOIN auth a ON a.id = pm.mentioned_user_id WHERE pm.post_id = %s AND pm.type = 'post'", [post_id])
        for m_row in cur.fetchall():
            mentions.append({'id': m_row[0], 'username': m_row[1] or '', 'name': m_row[2] or ''})

    return {
        'id': post_id,
        'page_id': page_id,
        'creator_id': creator_id,
        'content': content,
        'created_at': str(created_at) if created_at else '',
        'time_ago': _time_ago(created_at),
        'views': views,
        'likes': likes,
        'dislikes': dislikes,
        'comments_count': comments_count,
        'shares': shares,
        'is_edited': is_edited,
        'share_url': share_url,
        'can_react': can_react,
        'author': {
            'id': creator_id,
            'name': author_name,
            'username': author_username,
            'picture': _media_url(author_picture) if author_picture else '/static/images/avatars/default.png',
        },
        'media': media,
        'poll': poll,
        'mentions': mentions,
        'user_reaction': user_reaction,
        'is_saved': is_saved,
        'is_creator': (creator_id == user_id),
    }


# ============================================================
# PAGES MODULE ? VIEWS
# ============================================================

@login_required
def pages_view(request):
    """Renders /pages/ directory."""
    user = request.user
    sql = """
        SELECT 
            p.id, p.creator_id, p.title, p.description, p.cover_image, p.profile_image, p.created_at,
            a.name AS creator_name,
            a.username AS creator_username,
            a.picture AS creator_picture,
            (SELECT COUNT(*) FROM page_followers pf WHERE pf.page_id = p.id) AS follower_count,
            EXISTS(SELECT 1 FROM page_followers pf WHERE pf.page_id = p.id AND pf.user_id = %s) AS is_following,
            (SELECT COUNT(*) FROM page_posts pp WHERE pp.page_id = p.id) AS post_count,
            (SELECT MAX(created_at) FROM page_posts WHERE page_id = p.id) AS last_activity
        FROM pages p
        LEFT JOIN auth a ON a.id = p.creator_id
        ORDER BY p.created_at DESC
    """
    with connection.cursor() as cur:
        cur.execute(sql, [user.id])
        rows = cur.fetchall()

    pages = [_pg_format_page(row, user.id) for row in rows]
    popular_pages = sorted(pages, key=lambda x: x['follower_count'], reverse=True)[:3]
    recent_pages = pages[:4]

    return render(request, 'dashboard/pages.html', {
        'active_page': 'pages',
        'pages': pages,
        'total_pages': len(pages),
        'total_posts': sum(p['post_count'] for p in pages),
        'total_followers': sum(p['follower_count'] for p in pages),
        'followed_count': sum(1 for p in pages if p['is_following']),
        'popular_pages': popular_pages,
        'recent_pages': recent_pages,
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def page_view_view(request, page_id):
    """Renders /pages/<id>/ single page view with posts feed and widgets."""
    user = request.user

    page_sql = """
        SELECT 
            p.id, p.title, p.description, p.cover_image, p.profile_image,
            p.creator_id, p.created_at,
            a.username AS creator_username,
            a.name AS creator_name,
            a.picture AS creator_picture
        FROM pages p
        LEFT JOIN auth a ON a.id = p.creator_id
        WHERE p.id = %s LIMIT 1
    """
    with connection.cursor() as cur:
        cur.execute(page_sql, [page_id])
        p_row = cur.fetchone()

    if not p_row:
        return redirect('/pages/')

    pid, title, desc, cover_img, profile_img, creator_id, created_at, c_uname, c_name, c_pic = p_row

    with connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM page_followers WHERE page_id = %s AND user_id = %s",
            [page_id, user.id]
        )
        is_follower = bool(cur.fetchone())

        cur.execute("SELECT COUNT(*) FROM page_followers WHERE page_id = %s", [page_id])
        followers_count = cur.fetchone()[0] or 0

        cur.execute("SELECT COUNT(*) FROM page_posts WHERE page_id = %s", [page_id])
        posts_count = cur.fetchone()[0] or 0

        cur.execute("""
            SELECT u.id, u.name, u.username, u.picture
            FROM page_followers pf
            JOIN auth u ON u.id = pf.user_id
            WHERE pf.page_id = %s
            ORDER BY pf.followed_at DESC
            LIMIT 12
        """, [page_id])
        recent_followers_list = [
            {
                'id': r[0],
                'name': r[1] or 'User',
                'username': r[2] or '',
                'picture': _media_url(r[3]) if r[3] else '/static/images/avatars/default.png',
                'is_admin': (r[0] == creator_id),
            }
            for r in cur.fetchall()
        ]
        if not any(f['id'] == creator_id for f in recent_followers_list):
            recent_followers_list.insert(0, {
                'id': creator_id,
                'name': c_name or 'Unknown',
                'username': c_uname or '',
                'picture': _media_url(c_pic) if c_pic else '/static/images/avatars/default.png',
                'is_admin': True,
            })

        cur.execute("""
            SELECT DISTINCT a.id, a.name, a.username, a.picture
            FROM friends f
            JOIN auth a ON (f.sender_id = a.id OR f.receiver_id = a.id)
            WHERE (f.sender_id = %s OR f.receiver_id = %s)
              AND f.status = 'accepted'
              AND a.id != %s
            LIMIT 30
        """, [user.id, user.id, user.id])
        mention_friends = [
            {
                'id': r[0],
                'name': r[1] or 'User',
                'username': r[2] or '',
                'picture': _media_url(r[3]) if r[3] else '/static/images/avatars/default.png',
            }
            for r in cur.fetchall()
        ]

        is_admin = (creator_id == user.id)
        mention_followers = []
        if is_admin:
            cur.execute("""
                SELECT DISTINCT u.id, u.name, u.username, u.picture
                FROM page_followers pf
                JOIN auth u ON u.id = pf.user_id
                WHERE pf.page_id = %s
                ORDER BY pf.followed_at DESC
                LIMIT 30
            """, [page_id])
            mention_followers = [
                {
                    'id': r[0],
                    'name': r[1] or 'User',
                    'username': r[2] or '',
                    'picture': _media_url(r[3]) if r[3] else '/static/images/avatars/default.png',
                }
                for r in cur.fetchall()
            ]

    page_data = {
        'id': pid,
        'title': title or '',
        'description': desc or '',
        'cover_image_url': _pg_pic_url(cover_img, kind='cover'),
        'profile_image_url': _pg_pic_url(profile_img, kind='profile'),
        'creator_id': creator_id,
        'creator_name': c_name or 'Unknown',
        'creator_username': c_uname or '',
        'creator_picture_url': _media_url(c_pic) if c_pic else '/static/images/avatars/default.png',
        'created_date_display': created_at.strftime('%b %d, %Y') if created_at else 'Unknown',
    }

    creator = {
        'id': creator_id,
        'name': c_name or 'Unknown',
        'username': c_uname or '',
        'picture': _media_url(c_pic) if c_pic else '/static/images/avatars/default.png',
        'is_admin': True,
    }

    can_post = is_admin

    return render(request, 'dashboard/page_view.html', {
        'active_page': 'pages',
        'page_id': pid,
        'page': page_data,
        'creator': creator,
        'is_admin': is_admin,
        'is_follower': is_follower,
        'can_post': can_post,
        'followers_count': followers_count,
        'posts_count': posts_count,
        'recent_followers': recent_followers_list,
        'mention_followers_json': json.dumps(mention_followers),
        'mention_friends_json': json.dumps(mention_friends),
        'svg_logo': _load_svg_logo(),
        'user': user,
    })


@login_required
def api_pages_list(request):
    """GET /api/pages/list/ ? JSON list of all pages with opt-in pagination."""
    page_param = request.GET.get('page')
    is_paginated = page_param is not None

    if is_paginated:
        try:
            page = max(1, int(page_param))
        except (ValueError, TypeError):
            page = 1
        limit = 20
        offset = (page - 1) * limit
    else:
        page = 1
        limit = 500
        offset = 0

    sql = """
        SELECT 
            p.id, p.creator_id, p.title, p.description, p.cover_image, p.profile_image, p.created_at,
            a.name AS creator_name,
            a.username AS creator_username,
            a.picture AS creator_picture,
            (SELECT COUNT(*) FROM page_followers pf WHERE pf.page_id = p.id) AS follower_count,
            EXISTS(SELECT 1 FROM page_followers pf WHERE pf.page_id = p.id AND pf.user_id = %s) AS is_following,
            (SELECT COUNT(*) FROM page_posts pp WHERE pp.page_id = p.id) AS post_count,
            (SELECT MAX(created_at) FROM page_posts WHERE page_id = p.id) AS last_activity
        FROM pages p
        LEFT JOIN auth a ON a.id = p.creator_id
        ORDER BY p.created_at DESC
        LIMIT %s OFFSET %s
    """
    with connection.cursor() as cur:
        cur.execute(sql, [request.user.id, limit, offset])
        rows = cur.fetchall()

        cur.execute("SELECT COUNT(*) FROM pages")
        total = cur.fetchone()[0] or 0

    pages = [_pg_format_page(r, request.user.id) for r in rows]
    has_more = (offset + len(pages)) < total

    return JsonResponse({
        'success': True,
        'pages': pages,
        'page': page,
        'total': total,
        'has_more': has_more,
    })

@login_required
@require_POST
def api_pages_create(request):
    """POST /api/pages/create/ ? creates a new page and auto-follows as creator."""
    user = request.user
    title = (request.POST.get('title') or '').strip()
    description = (request.POST.get('description') or '').strip()

    if not title:
        return JsonResponse({'success': False, 'error': 'Page title is required'})

    profile_key = ''
    cover_key = ''
    pfile = request.FILES.get('profile_image')
    cfile = request.FILES.get('cover_image')

    if pfile:
        k = _upload_to_s3(pfile, folder='uploads/pages')
        if k:
            profile_key = k
    if cfile:
        k = _upload_to_s3(cfile, folder='uploads/pages')
        if k:
            cover_key = k

    from django.db import transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    "INSERT INTO pages (title, description, profile_image, cover_image, creator_id, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, NOW())",
                    [title, description, profile_key, cover_key, user.id]
                )
                page_id = cur.lastrowid

                cur.execute(
                    "INSERT INTO page_followers (page_id, user_id, followed_at) VALUES (%s, %s, NOW())",
                    [page_id, user.id]
                )
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to create page: {e}'})

    return JsonResponse({
        'success': True,
        'message': 'Page created successfully',
        'page_id': page_id
    })


@login_required
@require_POST
def api_pages_edit(request, page_id):
    """POST /api/pages/<id>/edit/ ? updates page title, description, and images."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute(
            "SELECT id, profile_image, cover_image FROM pages WHERE id = %s AND creator_id = %s",
            [page_id, user.id]
        )
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    title = (request.POST.get('title') or '').strip()
    description = (request.POST.get('description') or '').strip()

    if not title:
        return JsonResponse({'success': False, 'error': 'Invalid data'})

    current_profile_image = row[1] or ''
    current_cover_image = row[2] or ''

    pfile = request.FILES.get('profile_image')
    if pfile:
        k = _upload_to_s3(pfile, folder='uploads/pages')
        if k:
            if current_profile_image:
                _delete_from_s3([current_profile_image])
            current_profile_image = k

    cfile = request.FILES.get('cover_image')
    if cfile:
        k = _upload_to_s3(cfile, folder='uploads/pages')
        if k:
            if current_cover_image:
                _delete_from_s3([current_cover_image])
            current_cover_image = k

    with connection.cursor() as cur:
        cur.execute(
            "UPDATE pages SET title = %s, description = %s, profile_image = %s, "
            "cover_image = %s, updated_at = NOW() WHERE id = %s",
            [title, description, current_profile_image, current_cover_image, page_id]
        )

    return JsonResponse({'success': True, 'message': 'Page updated successfully'})


@login_required
@require_POST
def api_pages_delete(request, page_id):
    """POST /api/pages/<id>/delete/ ? cascades delete for all page records and S3 assets."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute(
            "SELECT id, profile_image, cover_image FROM pages WHERE id = %s AND creator_id = %s",
            [page_id, user.id]
        )
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    s3_keys = []
    if row[1]:
        s3_keys.append(row[1])
    if row[2]:
        s3_keys.append(row[2])

    with connection.cursor() as cur:
        cur.execute(
            "SELECT media_url FROM page_media WHERE post_id IN (SELECT id FROM page_posts WHERE page_id = %s)",
            [page_id]
        )
        for m in cur.fetchall():
            if m[0] and not m[0].startswith(('http://', 'https://')):
                s3_keys.append(m[0])

    from django.db import transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("DELETE FROM page_followers WHERE page_id = %s", [page_id])
                cur.execute(
                    "DELETE FROM page_messages WHERE conversation_id IN "
                    "(SELECT id FROM page_conversations WHERE page_id = %s)",
                    [page_id]
                )
                cur.execute("DELETE FROM page_conversations WHERE page_id = %s", [page_id])
                cur.execute("DELETE FROM page_mentions WHERE page_id = %s", [page_id])
                cur.execute("DELETE FROM page_comments WHERE post_id IN (SELECT id FROM page_posts WHERE page_id = %s)", [page_id])
                cur.execute("DELETE FROM page_media WHERE post_id IN (SELECT id FROM page_posts WHERE page_id = %s)", [page_id])
                cur.execute("DELETE FROM page_polls WHERE post_id IN (SELECT id FROM page_posts WHERE page_id = %s)", [page_id])
                cur.execute("DELETE FROM page_user_interactions WHERE post_id IN (SELECT id FROM page_posts WHERE page_id = %s)", [page_id])
                cur.execute("DELETE FROM page_posts WHERE page_id = %s", [page_id])
                cur.execute("DELETE FROM pages WHERE id = %s", [page_id])
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to delete page: {e}'})

    s3_keys = [k for k in s3_keys if k and not k.startswith(('http://', 'https://'))]
    if s3_keys:
        _delete_from_s3(s3_keys)

    return JsonResponse({'success': True, 'message': 'Page deleted successfully'})


@login_required
@require_POST
def api_pages_toggle_follow(request, page_id):
    """POST /api/pages/<id>/toggle-follow/ ? toggles follow status for a page."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM pages WHERE id = %s", [page_id])
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Page not found'})
    if row[0] == user.id:
        return JsonResponse({'success': False, 'error': 'You cannot follow your own page'})

    with connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM page_followers WHERE page_id = %s AND user_id = %s",
            [page_id, user.id]
        )
        is_following = bool(cur.fetchone())

        if is_following:
            cur.execute(
                "DELETE FROM page_followers WHERE page_id = %s AND user_id = %s",
                [page_id, user.id]
            )
            is_following = False
        else:
            cur.execute(
                "INSERT INTO page_followers (page_id, user_id, followed_at) VALUES (%s, %s, NOW())",
                [page_id, user.id]
            )
            is_following = True

            try:
                follower_name = getattr(request.user, 'name', None) or request.user.username or 'Someone'
                cur.execute("SELECT title FROM pages WHERE id = %s", [page_id])
                t_row = cur.fetchone()
                page_title = t_row[0] if t_row else 'your page'

                _notify(
                    user_id=row[0],
                    notif_type='page_follow',
                    title='?? New Page Follower',
                    message=f'{follower_name} followed {page_title}',
                    icon='file-earmark-text',
                    link=f'/pages/{page_id}/',
                    actor_id=request.user.id,
                )
            except Exception:
                pass

    return JsonResponse({
        'success': True,
        'is_following': is_following,
        'message': 'Successfully followed the page' if is_following else 'Successfully unfollowed the page'
    })


@login_required
@require_POST
def api_page_update(request, page_id):
    """POST /api/pages/<id>/update/ ? updates page and returns live page dict matching PHP updatePage."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute(
            "SELECT creator_id, profile_image, cover_image FROM pages WHERE id = %s",
            [page_id]
        )
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Invalid page ID'})
    if row[0] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    title = (request.POST.get('title') or '').strip()
    description = (request.POST.get('description') or '').strip()

    if not title:
        return JsonResponse({'success': False, 'error': 'Page title is required'})

    current_profile_image = row[1] or ''
    current_cover_image = row[2] or ''

    pfile = request.FILES.get('profile_image')
    if pfile:
        k = _upload_to_s3(pfile, folder='uploads/pages')
        if k:
            if current_profile_image:
                _delete_from_s3([current_profile_image])
            current_profile_image = k

    cfile = request.FILES.get('cover_image')
    if cfile:
        k = _upload_to_s3(cfile, folder='uploads/pages')
        if k:
            if current_cover_image:
                _delete_from_s3([current_cover_image])
            current_cover_image = k

    with connection.cursor() as cur:
        cur.execute(
            "UPDATE pages SET title = %s, description = %s, profile_image = %s, "
            "cover_image = %s, updated_at = NOW() WHERE id = %s",
            [title, description, current_profile_image, current_cover_image, page_id]
        )

    return JsonResponse({
        'success': True,
        'page': {
            'title': title,
            'description': description,
            'cover_image_url': _pg_pic_url(current_cover_image, kind='cover'),
            'profile_image_url': _pg_pic_url(current_profile_image, kind='profile'),
        },
        'message': 'Page updated successfully'
    })


@login_required
def api_page_posts_list(request, page_id):
    """GET /api/pages/<id>/posts/ ? paginated list of posts for a page."""
    try:
        page = max(1, int(request.GET.get('page', 1)))
    except (ValueError, TypeError):
        page = 1

    limit = 10
    offset = (page - 1) * limit

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM pages WHERE id = %s", [page_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Invalid page ID'})

        posts_sql = """
            SELECT 
                pp.id, pp.page_id, pp.creator_id, pp.content, pp.created_at,
                pp.views_count, pp.likes_count, pp.dislikes_count, pp.comments_count, pp.shares_count,
                pp.updated_at,
                a.name, a.username, a.picture
            FROM page_posts pp
            JOIN auth a ON pp.creator_id = a.id
            WHERE pp.page_id = %s
            ORDER BY pp.created_at DESC
            LIMIT %s OFFSET %s
        """
        cur.execute(posts_sql, [page_id, limit, offset])
        rows = cur.fetchall()

        cur.execute("SELECT COUNT(*) FROM page_posts WHERE page_id = %s", [page_id])
        total = cur.fetchone()[0] or 0

    posts = [_pg_format_post(r, request.user.id, can_react=True) for r in rows]
    has_more = (offset + len(posts)) < total

    return JsonResponse({
        'success': True,
        'posts': posts,
        'has_more': has_more,
        'page': page,
        'total': total
    })


@login_required
@require_POST
def api_page_post_create(request, page_id):
    """POST /api/pages/<id>/posts/create/ ? creates a post on the page (admin only)."""
    user = request.user
    content = (request.POST.get('content') or '').strip()
    media_files = request.FILES.getlist('media[]') or request.FILES.getlist('media')
    poll_question = (request.POST.get('poll_question') or '').strip()
    poll_options_raw = request.POST.get('poll_options') or ''
    poll_duration_raw = request.POST.get('poll_duration') or '7'
    mentions_raw = request.POST.get('mentions') or '[]'

    with connection.cursor() as cur:
        cur.execute("SELECT creator_id, title FROM pages WHERE id = %s", [page_id])
        page_row = cur.fetchone()

    if not page_row:
        return JsonResponse({'success': False, 'error': 'Invalid page ID'})
    if page_row[0] != user.id:
        return JsonResponse({'success': False, 'error': 'Only page admin can post'})

    page_title = page_row[1] or 'a page'

    # Poll options parsing
    poll_options = []
    if poll_options_raw:
        try:
            parsed_opts = json.loads(poll_options_raw) if isinstance(poll_options_raw, str) else poll_options_raw
            if isinstance(parsed_opts, list):
                poll_options = [str(o).strip() for o in parsed_opts if str(o).strip()]
        except Exception:
            poll_options = []

    has_poll = bool(poll_question and len(poll_options) >= 2)

    if not content and not media_files and not has_poll:
        return JsonResponse({'success': False, 'error': 'Post cannot be empty'})

    # Mentions parsing
    try:
        mentions = json.loads(mentions_raw) if isinstance(mentions_raw, str) else mentions_raw
        if not isinstance(mentions, list):
            mentions = []
    except Exception:
        mentions = []

    from django.db import transaction
    from datetime import datetime, timedelta
    inserted_mentions = []

    # Step 1: Insert post, interactions, mentions, poll inside transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    "INSERT INTO page_posts (page_id, creator_id, content, created_at, updated_at) "
                    "VALUES (%s, %s, %s, NOW(), NULL)",
                    [page_id, user.id, content]
                )
                post_id = cur.lastrowid

                cur.execute(
                    "INSERT INTO page_user_interactions (user_id, post_id, view_count, last_viewed_at) "
                    "VALUES (%s, %s, 1, NOW()) "
                    "ON DUPLICATE KEY UPDATE view_count = view_count + 1, last_viewed_at = NOW()",
                    [user.id, post_id]
                )

                for m in mentions:
                    if not isinstance(m, dict):
                        continue
                    try:
                        m_uid = int(m.get('user_id') or 0)
                    except (TypeError, ValueError):
                        continue
                    if m_uid and m_uid != user.id:
                        cur.execute(
                            "INSERT INTO page_mentions (page_id, post_id, comment_id, mentioned_user_id, mentioned_by, type, created_at) "
                            "VALUES (%s, %s, NULL, %s, %s, 'post', NOW())",
                            [page_id, post_id, m_uid, user.id]
                        )
                        inserted_mentions.append(m_uid)

                if has_poll:
                    try:
                        dur_days = max(1, int(poll_duration_raw))
                    except (ValueError, TypeError):
                        dur_days = 7
                    ends_at = datetime.now() + timedelta(days=dur_days)
                    opts_json = json.dumps([{'text': opt, 'votes': 0} for opt in poll_options])
                    cur.execute(
                        "INSERT INTO page_polls (post_id, question, options, ends_at) VALUES (%s, %s, %s, %s)",
                        [post_id, poll_question, opts_json, ends_at]
                    )
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to create post: {e}'})

    # Step 2: Upload media to S3 outside transaction
    uploaded_media = []
    s3_failures = []
    for f in media_files:
        key = _upload_to_s3(f, folder='uploads/page_posts')
        if key:
            mime = f.content_type or 'application/octet-stream'
            m_type = _classify_media(mime)
            uploaded_media.append((key, m_type, mime))
        else:
            s3_failures.append(f"S3 upload failed: {getattr(f, 'name', 'file')}")

    # Step 3: Insert successful S3 media rows into page_media
    if uploaded_media:
        try:
            with transaction.atomic():
                with connection.cursor() as cur:
                    for key, m_type, mime in uploaded_media:
                        cur.execute(
                            "INSERT INTO page_media (post_id, media_url, media_type, mime_type) VALUES (%s, %s, %s, %s)",
                            [post_id, key, m_type, mime]
                        )
        except Exception as e:
            _delete_from_s3([k for k, _, _ in uploaded_media])
            s3_failures.append(f"Media DB insert failed: {e}")

    # Step 4: Mention notifications outside transaction
    sender_name = getattr(request.user, 'name', None) or request.user.username or 'Someone'
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT creator_id FROM page_posts WHERE id = %s", [post_id])
            pp_author = cur.fetchone()
            if pp_author and pp_author[0] != user.id:
                _notify(
                    user_id=pp_author[0],
                    notif_type='comment',
                    title=f'{sender_name} commented on your page post',
                    message=f'{sender_name}: {content[:100]}',
                    icon='comment',
                    link=f'/pages/{page_id}/',
                    actor_id=user.id
                )
    except Exception:
        pass

    for m_uid in inserted_mentions:
        try:
            _notify(
                user_id=m_uid,
                notif_type='page_mention',
                title='?? You were mentioned in a page post',
                message=f'{sender_name} mentioned you on "{page_title}"',
                icon='at',
                link=f'/pages/{page_id}/',
                actor_id=request.user.id,
            )
        except Exception:
            pass

    with connection.cursor() as cur:
        cur.execute("""
            SELECT 
                pp.id, pp.page_id, pp.creator_id, pp.content, pp.created_at,
                pp.views_count, pp.likes_count, pp.dislikes_count, pp.comments_count, pp.shares_count,
                pp.updated_at,
                a.name, a.username, a.picture
            FROM page_posts pp
            JOIN auth a ON pp.creator_id = a.id
            WHERE pp.id = %s
        """, [post_id])
        single_row = cur.fetchone()

    if not single_row:
        return JsonResponse({'success': False, 'error': 'Post created but could not be fetched'})

    post_dict = _pg_format_post(single_row, user.id, can_react=True)
    resp = {'success': True, 'post': post_dict, 'message': 'Post created successfully!'}
    if s3_failures:
        resp['warnings'] = s3_failures
    return JsonResponse(resp)

@login_required
@require_POST
def api_page_post_delete(request, post_id):
    """POST /api/pages/posts/<post_id>/delete/ ? deletes a post and cascades all children (author or page owner)."""
    user = request.user

    with connection.cursor() as cur:
        cur.execute("""
            SELECT pp.creator_id, p.creator_id AS page_admin_id
            FROM page_posts pp
            JOIN pages p ON pp.page_id = p.id
            WHERE pp.id = %s
        """, [post_id])
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})

    if row[0] != user.id and row[1] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    with connection.cursor() as cur:
        cur.execute("SELECT media_url FROM page_media WHERE post_id = %s", [post_id])
        media_rows = cur.fetchall()

    s3_keys = [
        k for (k,) in media_rows
        if k and not str(k).startswith(('http://', 'https://'))
    ]

    from django.db import transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                _cascade_delete_notifications([f'/pages/{row[1]}/%', f'%post_id={post_id}%'])
                cur.execute("DELETE FROM page_mentions WHERE post_id = %s", [post_id])
                cur.execute("DELETE FROM page_comments WHERE post_id = %s", [post_id])
                cur.execute("DELETE FROM page_media WHERE post_id = %s", [post_id])
                cur.execute("DELETE FROM page_polls WHERE post_id = %s", [post_id])
                cur.execute("DELETE FROM page_user_interactions WHERE post_id = %s", [post_id])
                cur.execute("DELETE FROM page_posts WHERE id = %s", [post_id])
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to delete post: {e}'})

    if s3_keys:
        _delete_from_s3(s3_keys)

    return JsonResponse({'success': True, 'message': 'Post deleted successfully'})


@login_required
@require_POST


@login_required
@require_POST
def api_page_post_react(request, post_id):
    """POST /api/pages/posts/<post_id>/react/ ? like/dislike toggle with transaction protection."""
    user = request.user
    import json as _json
    try:
        data = _json.loads(request.body)
    except Exception:
        data = {}

    reaction = (data.get('reaction') or '').strip()
    if reaction not in ('like', 'dislike'):
        return JsonResponse({'success': False, 'error': 'Invalid data'})

    from django.db import transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("SELECT id FROM page_posts WHERE id = %s", [post_id])
                if not cur.fetchone():
                    return JsonResponse({'success': False, 'error': 'Post not found'})

                cur.execute(
                    "SELECT id, reaction FROM page_user_interactions WHERE user_id = %s AND post_id = %s",
                    [user.id, post_id]
                )
                row = cur.fetchone()

                if row:
                    inter_id, current_reaction = row[0], row[1]
                    if current_reaction == reaction:
                        cur.execute("UPDATE page_user_interactions SET reaction = NULL WHERE id = %s", [inter_id])
                        if current_reaction == 'like':
                            cur.execute("UPDATE page_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = %s", [post_id])
                        else:
                            cur.execute("UPDATE page_posts SET dislikes_count = GREATEST(dislikes_count - 1, 0) WHERE id = %s", [post_id])
                        new_reaction = None
                    else:
                        cur.execute("UPDATE page_user_interactions SET reaction = %s WHERE id = %s", [reaction, inter_id])
                        if current_reaction == 'like':
                            cur.execute(
                                "UPDATE page_posts SET likes_count = GREATEST(likes_count - 1, 0), dislikes_count = dislikes_count + 1 WHERE id = %s",
                                [post_id]
                            )
                        elif current_reaction == 'dislike':
                            cur.execute(
                                "UPDATE page_posts SET dislikes_count = GREATEST(dislikes_count - 1, 0), likes_count = likes_count + 1 WHERE id = %s",
                                [post_id]
                            )
                        else:
                            if reaction == 'like':
                                cur.execute("UPDATE page_posts SET likes_count = likes_count + 1 WHERE id = %s", [post_id])
                            else:
                                cur.execute("UPDATE page_posts SET dislikes_count = dislikes_count + 1 WHERE id = %s", [post_id])
                        new_reaction = reaction
                else:
                    cur.execute(
                        "INSERT INTO page_user_interactions (user_id, post_id, reaction) VALUES (%s, %s, %s)",
                        [user.id, post_id, reaction]
                    )
                    if reaction == 'like':
                        cur.execute("UPDATE page_posts SET likes_count = likes_count + 1 WHERE id = %s", [post_id])
                    else:
                        cur.execute("UPDATE page_posts SET dislikes_count = dislikes_count + 1 WHERE id = %s", [post_id])
                    new_reaction = reaction

                cur.execute("SELECT likes_count, dislikes_count FROM page_posts WHERE id = %s", [post_id])
                counts = cur.fetchone()
                likes = counts[0] if counts else 0
                dislikes = counts[1] if counts else 0
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Reaction failed: {e}'})

    if new_reaction == 'like':
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT creator_id, page_id FROM page_posts WHERE id = %s", [post_id])
                pp_row = cur.fetchone()
                if pp_row and pp_row[0] != user.id:
                    actor_name = user.name or user.username or 'Someone'
                    _notify(
                        user_id=pp_row[0],
                        notif_type='reaction',
                        title=f'{actor_name} liked your page post',
                        message=f'{actor_name} liked your post',
                        icon='heart',
                        link=f'/pages/{pp_row[1]}/',
                        actor_id=user.id
                    )
        except Exception:
            pass

    return JsonResponse({
        'success': True,
        'likes': likes or 0,
        'dislikes': dislikes or 0,
        'user_reaction': new_reaction
    })


@login_required
@require_POST
def api_page_post_view(request, post_id):
    """POST /api/pages/posts/<post_id>/view/ ? tracks view count on post and user interaction."""
    user = request.user
    import json as _json
    try:
        data = _json.loads(request.body)
    except Exception:
        data = {}

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM page_posts WHERE id = %s", [post_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Invalid post ID'})

    from django.db import transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("UPDATE page_posts SET views_count = views_count + 1 WHERE id = %s", [post_id])

                cur.execute(
                    "SELECT id FROM page_user_interactions WHERE user_id = %s AND post_id = %s",
                    [user.id, post_id]
                )
                r = cur.fetchone()
                if r:
                    cur.execute(
                        "UPDATE page_user_interactions SET view_count = view_count + 1, last_viewed_at = NOW() WHERE id = %s",
                        [r[0]]
                    )
                else:
                    cur.execute(
                        "INSERT INTO page_user_interactions (user_id, post_id, view_count, last_viewed_at) "
                        "VALUES (%s, %s, 1, NOW())",
                        [user.id, post_id]
                    )
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to record view: {e}'})

    return JsonResponse({'success': True})


@login_required
def api_page_comments_list(request, post_id):
    """GET /api/pages/posts/<post_id>/comments/ ? list comments with author and mentions."""
    try:
        page = max(1, int(request.GET.get('page', 1)))
    except (ValueError, TypeError):
        page = 1
    limit = 20
    offset = (page - 1) * limit

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM page_posts WHERE id = %s", [post_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Invalid post ID'})

        cur.execute("""
            SELECT 
                pc.id, pc.content, pc.created_at,
                a.id, a.name, a.username, a.picture
            FROM page_comments pc
            JOIN auth a ON pc.user_id = a.id
            WHERE pc.post_id = %s
            ORDER BY pc.created_at ASC
            LIMIT %s OFFSET %s
        """, [post_id, limit, offset])
        rows = cur.fetchall()

        comments = []
        for r in rows:
            cur.execute("""
                SELECT pm.mentioned_user_id, u.username, u.name
                FROM page_mentions pm
                JOIN auth u ON pm.mentioned_user_id = u.id
                WHERE pm.comment_id = %s AND pm.type = 'comment'
                ORDER BY pm.created_at DESC
            """, [r[0]])
            m_rows = cur.fetchall()
            mentions = [{'id': m[0], 'username': m[1] or '', 'name': m[2] or ''} for m in m_rows]

            comments.append({
                'id': r[0],
                'content': r[1] or '',
                'author': {
                    'id': r[3],
                    'name': r[4] or r[5] or 'User',
                    'username': r[5] or '',
                    'picture': _media_url(r[6]) if r[6] else '/static/images/avatars/default.png',
                },
                'mentions': mentions,
                'time_ago': _time_ago(r[2]),
            })

    return JsonResponse({'success': True, 'comments': comments})


@login_required
@require_POST
def api_page_comment_add(request, post_id):
    """POST /api/pages/posts/<post_id>/comments/add/ ? adds a comment to a page post."""
    user = request.user
    import json as _json
    try:
        data = _json.loads(request.body)
    except Exception:
        data = {}

    content = (data.get('content') or '').strip()
    mentions = data.get('mentions') or []
    if not isinstance(mentions, list):
        mentions = []

    if not content:
        return JsonResponse({'success': False, 'error': 'Invalid data'})

    with connection.cursor() as cur:
        cur.execute("""
            SELECT pp.page_id, p.title
            FROM page_posts pp
            JOIN pages p ON pp.page_id = p.id
            WHERE pp.id = %s
        """, [post_id])
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Post not found'})

    page_id = row[0]
    page_title = row[1] or 'a page'

    from django.db import transaction
    inserted_mentions = []
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    "INSERT INTO page_comments (post_id, user_id, content, created_at) "
                    "VALUES (%s, %s, %s, NOW())",
                    [post_id, user.id, content]
                )
                comment_id = cur.lastrowid

                for m in mentions:
                    if not isinstance(m, dict):
                        continue
                    try:
                        m_uid = int(m.get('user_id') or 0)
                    except (TypeError, ValueError):
                        continue
                    if m_uid and m_uid != user.id:
                        cur.execute(
                            "INSERT INTO page_mentions (page_id, post_id, comment_id, mentioned_user_id, mentioned_by, type, created_at) "
                            "VALUES (%s, %s, %s, %s, %s, 'comment', NOW())",
                            [page_id, post_id, comment_id, m_uid, user.id]
                        )
                        inserted_mentions.append(m_uid)

                cur.execute(
                    "UPDATE page_posts SET comments_count = comments_count + 1 WHERE id = %s",
                    [post_id]
                )
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to add comment: {e}'})

    sender_name = getattr(request.user, 'name', None) or request.user.username or 'Someone'
    for m_uid in inserted_mentions:
        try:
            _notify(
                user_id=m_uid,
                notif_type='page_mention',
                title='?? You were mentioned in a page comment',
                message=f'{sender_name} mentioned you in a comment on "{page_title}"',
                icon='at',
                link=f'/pages/{page_id}/',
                actor_id=request.user.id,
            )
        except Exception:
            pass

    with connection.cursor() as cur:
        cur.execute("""
            SELECT pc.id, pc.content, pc.created_at, a.id, a.name, a.username, a.picture
            FROM page_comments pc
            JOIN auth a ON pc.user_id = a.id
            WHERE pc.id = %s
        """, [comment_id])
        c_row = cur.fetchone()

        cur.execute("""
            SELECT pm.mentioned_user_id, u.username, u.name
            FROM page_mentions pm
            JOIN auth u ON pm.mentioned_user_id = u.id
            WHERE pm.comment_id = %s AND pm.type = 'comment'
            ORDER BY pm.created_at DESC
        """, [comment_id])
        m_rows = cur.fetchall()
        comment_mentions = [{'id': m[0], 'username': m[1] or '', 'name': m[2] or ''} for m in m_rows]

    author_name = (c_row[4] or c_row[5] or 'User') if c_row else (getattr(user, 'name', None) or user.username or 'User')
    author_username = (c_row[5] or '') if c_row else (user.username or '')
    author_picture = c_row[6] if c_row else getattr(user, 'picture', None)

    return JsonResponse({
        'success': True,
        'comment': {
            'id': comment_id,
            'content': content,
            'author': {
                'id': user.id,
                'name': author_name,
                'username': author_username,
                'picture': _media_url(author_picture) if author_picture else '/static/images/avatars/default.png',
            },
            'mentions': comment_mentions,
            'time_ago': 'Just now',
        }
    })


@login_required
@require_POST
def api_page_comment_delete(request, comment_id):
    """POST /api/pages/comments/<comment_id>/delete/ ? deletes a comment (author or page admin)."""
    user = request.user
    import json as _json
    try:
        data = _json.loads(request.body)
    except Exception:
        data = {}

    try:
        post_id = int(data.get('post_id') or 0)
    except (TypeError, ValueError):
        post_id = 0

    if not post_id:
        return JsonResponse({'success': False, 'error': 'Invalid data'})

    with connection.cursor() as cur:
        cur.execute("""
            SELECT pc.user_id, pc.post_id, p.creator_id AS page_admin_id
            FROM page_comments pc
            JOIN page_posts pp ON pc.post_id = pp.id
            JOIN pages p ON pp.page_id = p.id
            WHERE pc.id = %s AND pc.post_id = %s
        """, [comment_id, post_id])
        row = cur.fetchone()

    if not row:
        return JsonResponse({'success': False, 'error': 'Comment not found'})

    if row[0] != user.id and row[2] != user.id:
        return JsonResponse({'success': False, 'error': 'Not authorized'})

    from django.db import transaction
    try:
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("DELETE FROM page_comments WHERE id = %s", [comment_id])
                cur.execute("DELETE FROM page_mentions WHERE comment_id = %s", [comment_id])
                cur.execute(
                    "UPDATE page_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = %s",
                    [post_id]
                )
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Failed to delete comment: {e}'})

    return JsonResponse({'success': True, 'message': 'Comment deleted successfully'})


@login_required
def api_page_followers_list(request, page_id):
    """GET /api/pages/<page_id>/followers/ ? list followers of a page."""
    with connection.cursor() as cur:
        cur.execute("SELECT id FROM pages WHERE id = %s", [page_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Invalid page ID'})

        cur.execute("""
            SELECT u.id, u.name, u.username, u.picture
            FROM page_followers f
            JOIN auth u ON f.user_id = u.id
            WHERE f.page_id = %s
            ORDER BY f.followed_at DESC
        """, [page_id])
        rows = cur.fetchall()

    followers = []
    for r in rows:
        followers.append({
            'id': r[0],
            'name': r[1] or r[2] or 'User',
            'username': r[2] or '',
            'picture': _media_url(r[3]) if r[3] else '/static/images/avatars/default.png',
        })

    return JsonResponse({'success': True, 'followers': followers})


@login_required
def api_page_posts_feed(request):
    """GET /api/page-posts/?page=N ? placeholder; page posts in main feed deferred."""
    return JsonResponse({
        'success': True,
        'posts': [],
        'has_more': False,
        'total_posts': 0,
        'page': 1,
        'type': 'page',
    })


# ============================================================
# PAGE INBOX (Task 17) — Page Conversations & Messaging
# ============================================================

def _push_page_message_firebase(conversation_id, message_data):
    """
    Push a page message to Firebase RTDB node:
    conversations/{conversation_id}/messages/{message_id}
    Matches PHP controller/page_messages.php sendToFirebase().
    """
    import os, requests, logging
    _log = logging.getLogger(__name__)
    base_url = os.environ.get('FIREBASE_PAGES_DB_URL', 'https://xapyx-pages-messages-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/conversations/{conversation_id}/messages/{message_data['id']}.json"
    try:
        resp = requests.put(url, json=message_data, timeout=5)
        if resp.status_code == 200:
            return True
        _log.warning(f"Firebase page message push returned HTTP {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        _log.warning(f"Firebase page message push failed: {e}")
        return False


@login_required
def page_inbox_view(request):
    """
    GET /pages/inbox/ — Full page inbox interface.
    Accepts ?conv_id=<int>&page_id=<int> to preselect a conversation or page.
    """
    user_id = request.user.id
    conv_id = request.GET.get('conv_id')
    page_id = request.GET.get('page_id')

    with connection.cursor() as cur:
        cur.execute(
            "SELECT id, title, profile_image FROM pages WHERE creator_id = %s ORDER BY title ASC",
            [user_id]
        )
        page_rows = cur.fetchall()

    user_pages = []
    for r in page_rows:
        user_pages.append({
            'id': r[0],
            'title': r[1] or '',
            'profile_image': _full_avatar_url(r[2]) if r[2] else '/static/images/avatars/default.png',
        })

    is_page_admin = len(user_pages) > 0

    return render(request, 'dashboard/page_inbox.html', {
        'active_page': 'pages',
        'user_pages': user_pages,
        'is_page_admin': is_page_admin,
        'selected_conv_id': int(conv_id) if conv_id and str(conv_id).isdigit() else 0,
        'selected_page_id': int(page_id) if page_id and str(page_id).isdigit() else 0,
        'svg_logo': _load_svg_logo(),
    })


def _page_seconds_to_ago(seconds):
    if seconds is None:
        return ''
    try:
        s = int(seconds)
    except (ValueError, TypeError):
        return ''
    if s < 60:
        return 'Just now'
    if s < 3600:
        return f'{s // 60}m ago'
    if s < 86400:
        return f'{s // 3600}h ago'
    if s < 604800:
        return f'{s // 86400}d ago'
    return f'{s // 604800}w ago'


@login_required
def api_page_conversations(request):
    """
    GET /api/pages/conversations/
    Returns conversation list for user.
    If user owns pages, returns conversations across their owned pages.
    Otherwise (or with ?role=user), returns conversations where user_id = request.user.id.
    """
    user_id = request.user.id
    role_filter = (request.GET.get('role') or '').strip().lower()
    page_filter = request.GET.get('page_id')

    with connection.cursor() as cur:
        cur.execute("SELECT id, title, profile_image FROM pages WHERE creator_id = %s", [user_id])
        my_pages_rows = cur.fetchall()

    my_pages = [{'id': r[0], 'title': r[1] or '', 'image': _full_avatar_url(r[2])} for r in my_pages_rows]
    is_page_admin = len(my_pages) > 0
    viewing_as_admin = is_page_admin and role_filter != 'user'

    conversations = []
    with connection.cursor() as cur:
        if viewing_as_admin:
            page_ids = [p['id'] for p in my_pages]
            if page_filter and str(page_filter).isdigit() and int(page_filter) in page_ids:
                page_ids = [int(page_filter)]

            format_strings = ','.join(['%s'] * len(page_ids))
            sql = f"""
                SELECT pc.id AS conversation_id, pc.page_id, pc.user_id,
                       pc.last_message, pc.last_message_time,
                       TIMESTAMPDIFF(SECOND, pc.last_message_time, NOW()) AS seconds_ago,
                       pc.admin_unread_count AS unread_count, pc.created_at AS conversation_created,
                       p.title AS page_title, p.profile_image AS page_image,
                       a.name AS user_name, a.username AS user_username, a.picture AS user_picture
                FROM page_conversations pc
                JOIN pages p ON pc.page_id = p.id
                JOIN auth a ON pc.user_id = a.id
                WHERE p.id IN ({format_strings})
                ORDER BY pc.last_message_time DESC
            """
            cur.execute(sql, page_ids)
            rows = cur.fetchall()

            for r in rows:
                user_pic = _full_avatar_url(r[12])
                page_pic = _full_avatar_url(r[9])
                conversations.append({
                    'conversation_id': r[0],
                    'page_id': r[1],
                    'user_id': r[2],
                    'last_message': r[3] or '',
                    'last_message_time': r[4].isoformat() if r[4] else '',
                    'time_ago': _page_seconds_to_ago(r[5]),
                    'unread_count': r[6] or 0,
                    'conversation_created': r[7].isoformat() if r[7] else '',
                    'page_title': r[8] or '',
                    'page_image_url': page_pic,
                    'user_name': r[10] or '',
                    'user_username': r[11] or '',
                    'user_picture_url': user_pic,
                    'display_name': r[10] or r[11] or 'User',
                    'display_avatar': user_pic,
                    'display_link': f'/user/{r[2]}/',
                    'conversation_type': 'admin',
                })
        else:
            sql = """
                SELECT pc.id AS conversation_id, pc.page_id, pc.user_id,
                       pc.last_message, pc.last_message_time,
                       TIMESTAMPDIFF(SECOND, pc.last_message_time, NOW()) AS seconds_ago,
                       pc.user_unread_count AS unread_count, pc.created_at AS conversation_created,
                       p.title AS page_title, p.profile_image AS page_image,
                       a.name AS user_name, a.username AS user_username, a.picture AS user_picture
                FROM page_conversations pc
                JOIN pages p ON pc.page_id = p.id
                JOIN auth a ON pc.user_id = a.id
                WHERE pc.user_id = %s
                ORDER BY pc.last_message_time DESC
            """
            cur.execute(sql, [user_id])
            rows = cur.fetchall()

            for r in rows:
                user_pic = _full_avatar_url(r[12])
                page_pic = _full_avatar_url(r[9])
                conversations.append({
                    'conversation_id': r[0],
                    'page_id': r[1],
                    'user_id': r[2],
                    'last_message': r[3] or '',
                    'last_message_time': r[4].isoformat() if r[4] else '',
                    'time_ago': _page_seconds_to_ago(r[5]),
                    'unread_count': r[6] or 0,
                    'conversation_created': r[7].isoformat() if r[7] else '',
                    'page_title': r[8] or '',
                    'page_image_url': page_pic,
                    'user_name': r[10] or '',
                    'user_username': r[11] or '',
                    'user_picture_url': user_pic,
                    'display_name': r[8] or 'Page',
                    'display_avatar': page_pic,
                    'display_link': f'/pages/{r[1]}/',
                    'conversation_type': 'user',
                })

    return JsonResponse({
        'success': True,
        'conversations': conversations,
        'is_page_admin': is_page_admin,
        'viewing_as_admin': viewing_as_admin,
        'my_pages': my_pages,
    })


@login_required
def api_page_messages(request):
    """
    GET /api/pages/messages/?conversation_id=<int>
    Fetches all messages in a conversation.
    Enforces authorization check: user must be conversation user OR page creator.
    """
    user_id = request.user.id
    conv_id = request.GET.get('conversation_id')
    if not conv_id or not str(conv_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid conversation ID'}, status=400)

    conv_id = int(conv_id)
    with connection.cursor() as cur:
        cur.execute("""
            SELECT pc.id, pc.page_id, pc.user_id, p.creator_id AS page_admin_id, p.title AS page_title,
                   p.profile_image AS page_image
            FROM page_conversations pc
            JOIN pages p ON pc.page_id = p.id
            WHERE pc.id = %s
        """, [conv_id])
        conv = cur.fetchone()

    if not conv:
        return JsonResponse({'success': False, 'error': 'Conversation not found'}, status=404)

    page_admin_id = conv[3]
    conv_user_id = conv[2]
    page_title = conv[4] or ''
    page_image = _full_avatar_url(conv[5])

    is_admin = (page_admin_id == user_id)
    if not is_admin and conv_user_id != user_id:
        return JsonResponse({'success': False, 'error': 'Not authorized'}, status=403)

    with connection.cursor() as cur:
        cur.execute("""
            SELECT pm.id, pm.conversation_id, pm.sender_id, pm.sender_type, pm.message, pm.is_read, pm.created_at,
                   a.name AS sender_name, a.username AS sender_username, a.picture AS sender_picture
            FROM page_messages pm
            JOIN auth a ON pm.sender_id = a.id
            WHERE pm.conversation_id = %s
            ORDER BY pm.created_at ASC
        """, [conv_id])
        rows = cur.fetchall()

    messages = []
    for r in rows:
        pic = _full_avatar_url(r[9])
        messages.append({
            'id': r[0],
            'conversation_id': r[1],
            'sender_id': r[2],
            'sender_type': r[3],
            'message': r[4] or '',
            'is_read': bool(r[5]),
            'created_at': r[6].isoformat() if r[6] else '',
            'sender_name': r[7] or '',
            'sender_username': r[8] or '',
            'sender_picture': pic,
        })

    return JsonResponse({
        'success': True,
        'messages': messages,
        'is_admin': is_admin,
        'page_title': page_title,
        'page_image': page_image,
        'conversation_id': conv_id,
    })


@login_required
@require_POST
def api_page_start_conversation(request):
    """
    POST /api/pages/messages/start/
    Body: page_id, message (optional)
    Starts or retrieves an existing conversation with a page.
    """
    user_id = request.user.id
    page_id = request.POST.get('page_id')
    initial_message = (request.POST.get('message') or '').strip()

    if not page_id or not str(page_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid page ID'}, status=400)

    page_id = int(page_id)

    with connection.cursor() as cur:
        cur.execute("SELECT creator_id, title FROM pages WHERE id = %s", [page_id])
        page = cur.fetchone()

    if not page:
        return JsonResponse({'success': False, 'error': 'Page not found'}, status=404)

    page_creator_id = page[0]
    page_title = page[1] or 'Page'
    is_page_admin = (page_creator_id == user_id)

    # Check for existing conversation
    with connection.cursor() as cur:
        cur.execute("SELECT id FROM page_conversations WHERE page_id = %s AND user_id = %s", [page_id, user_id])
        existing = cur.fetchone()

    if existing:
        return JsonResponse({
            'success': True,
            'conversation_id': existing[0],
            'is_admin': is_page_admin,
            'page_title': page_title,
        })

    default_message = initial_message or "Hello! I'm interested in your page."

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO page_conversations (page_id, user_id, last_message, last_message_time, user_unread_count, admin_unread_count, created_at)
            VALUES (%s, %s, %s, NOW(), 0, 1, NOW())
        """, [page_id, user_id, default_message])
        conv_id = cur.lastrowid

        cur.execute("""
            INSERT INTO page_messages (conversation_id, sender_id, sender_type, message, is_read, created_at)
            VALUES (%s, %s, 'user', %s, 0, NOW())
        """, [conv_id, user_id, default_message])
        message_id = cur.lastrowid

    from datetime import datetime
    sender_name = getattr(request.user, 'name', '') or request.user.username or 'User'
    sender_pic = _full_avatar_url(getattr(request.user, 'picture', None))
    firebase_payload = {
        'id': message_id,
        'message': default_message,
        'sender_id': user_id,
        'sender_name': sender_name,
        'sender_username': request.user.username or '',
        'sender_picture': sender_pic,
        'sender_type': 'user',
        'media_data': None,
        'created_at': int(datetime.utcnow().timestamp() * 1000),
    }
    _push_page_message_firebase(conv_id, firebase_payload)

    # Bell notification to page creator (if not self)
    if page_creator_id != user_id:
        try:
            _notify(
                page_creator_id,
                'page_message',
                f'New message for {page_title}',
                f'{sender_name}: {default_message}',
                link=f'/pages/inbox/?conv_id={conv_id}&page_id={page_id}',
                actor_id=user_id,
            )
        except Exception as e:
            _log.warning(f"Notification error in start_conversation: {e}")

    return JsonResponse({
        'success': True,
        'conversation_id': conv_id,
        'is_admin': is_page_admin,
        'page_title': page_title,
    })


@login_required
@require_POST
def api_page_send_message(request):
    """
    POST /api/pages/messages/send/
    Body: conversation_id, message
    Sends a message in an existing conversation.
    """
    user_id = request.user.id
    conv_id = request.POST.get('conversation_id')
    message_text = (request.POST.get('message') or '').strip()

    if not conv_id or not str(conv_id).isdigit() or not message_text:
        return JsonResponse({'success': False, 'error': 'Invalid data'}, status=400)

    conv_id = int(conv_id)

    with connection.cursor() as cur:
        cur.execute("""
            SELECT pc.id, pc.page_id, pc.user_id, p.creator_id AS page_admin_id, p.title AS page_title
            FROM page_conversations pc
            JOIN pages p ON pc.page_id = p.id
            WHERE pc.id = %s
        """, [conv_id])
        conv = cur.fetchone()

    if not conv:
        return JsonResponse({'success': False, 'error': 'Conversation not found'}, status=404)

    page_id = conv[1]
    conv_user_id = conv[2]
    page_admin_id = conv[3]
    page_title = conv[4] or 'Page'

    is_admin = (page_admin_id == user_id)
    sender_type = 'admin' if is_admin else 'user'

    if not is_admin and conv_user_id != user_id:
        return JsonResponse({'success': False, 'error': 'Not authorized'}, status=403)

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO page_messages (conversation_id, sender_id, sender_type, message, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        """, [conv_id, user_id, sender_type, message_text])
        message_id = cur.lastrowid

        if is_admin:
            cur.execute("""
                UPDATE page_conversations
                SET last_message = %s, last_message_time = NOW(), user_unread_count = user_unread_count + 1
                WHERE id = %s
            """, [message_text, conv_id])
        else:
            cur.execute("""
                UPDATE page_conversations
                SET last_message = %s, last_message_time = NOW(), admin_unread_count = admin_unread_count + 1
                WHERE id = %s
            """, [message_text, conv_id])

    from datetime import datetime
    sender_name = getattr(request.user, 'name', '') or request.user.username or 'User'
    sender_pic = _full_avatar_url(getattr(request.user, 'picture', None))
    now_dt = datetime.utcnow()

    message_data = {
        'id': message_id,
        'conversation_id': conv_id,
        'message': message_text,
        'sender_id': user_id,
        'sender_name': sender_name,
        'sender_username': request.user.username or '',
        'sender_picture': sender_pic,
        'sender_type': sender_type,
        'media_data': None,
        'created_at': now_dt.isoformat(),
    }

    # Firebase RTDB push
    firebase_payload = dict(message_data)
    firebase_payload['created_at'] = int(now_dt.timestamp() * 1000)
    _push_page_message_firebase(conv_id, firebase_payload)

    # Notification integration:
    try:
        if not is_admin:
            _notify(
                page_admin_id,
                'page_message',
                f'New message from {sender_name}',
                message_text,
                link=f'/pages/inbox/?conv_id={conv_id}&page_id={page_id}',
                actor_id=user_id,
            )
        else:
            _notify(
                conv_user_id,
                'page_message',
                f'{page_title} replied',
                message_text,
                link=f'/pages/inbox/?conv_id={conv_id}&page_id={page_id}',
                actor_id=user_id,
            )
    except Exception as e:
        _log.warning(f"Notification error in send_message: {e}")

    return JsonResponse({'success': True, 'message': message_data})


@login_required
@require_POST
def api_page_mark_read(request):
    """
    POST /api/pages/messages/read/
    Body: conversation_id
    Marks messages read and resets unread count for the viewer.
    """
    user_id = request.user.id
    conv_id = request.POST.get('conversation_id')
    if not conv_id or not str(conv_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid conversation ID'}, status=400)

    conv_id = int(conv_id)
    with connection.cursor() as cur:
        cur.execute("""
            SELECT pc.id, pc.user_id, p.creator_id AS page_admin_id
            FROM page_conversations pc
            JOIN pages p ON pc.page_id = p.id
            WHERE pc.id = %s
        """, [conv_id])
        conv = cur.fetchone()

    if not conv:
        return JsonResponse({'success': False, 'error': 'Conversation not found'}, status=404)

    conv_user_id = conv[1]
    page_admin_id = conv[2]

    is_admin = (page_admin_id == user_id)
    if not is_admin and conv_user_id != user_id:
        return JsonResponse({'success': False, 'error': 'Not authorized'}, status=403)

    with connection.cursor() as cur:
        if is_admin:
            cur.execute("UPDATE page_conversations SET admin_unread_count = 0 WHERE id = %s", [conv_id])
            cur.execute("UPDATE page_messages SET is_read = 1 WHERE conversation_id = %s AND sender_type = 'user'", [conv_id])
        else:
            cur.execute("UPDATE page_conversations SET user_unread_count = 0 WHERE id = %s", [conv_id])
            cur.execute("UPDATE page_messages SET is_read = 1 WHERE conversation_id = %s AND sender_type = 'admin'", [conv_id])

    return JsonResponse({'success': True})


# ============================================================
# DIRECT MESSAGES (Task 18 Phase 1)
# ============================================================

def _push_chat_message_firebase(chat_id, message_data):
    """
    Push a 1-on-1 DM to Firebase RTDB node:
    chats/{chat_id}/messages/{message_id}
    Using FIREBASE_CHAT_DB_URL REST endpoint.
    """
    import os, requests, logging
    _log = logging.getLogger(__name__)
    base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/chats/{chat_id}/messages/{message_data['id']}.json"
    try:
        resp = requests.put(url, json=message_data, timeout=5)
        if resp.status_code == 200:
            return True
        _log.warning(f"Firebase chat push returned HTTP {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        _log.warning(f"Firebase chat push failed: {e}")
        return False


@login_required
def chat_view(request, friend_id=None):
    """
    GET /chat/ or /chat/<friend_id>/ — Full 1-on-1 DM interface.
    """
    selected_friend_id = int(friend_id) if friend_id else 0
    return render(request, 'dashboard/chat.html', {
        'active_page': 'chat',
        'selected_friend_id': selected_friend_id,
        'svg_logo': _load_svg_logo(),
    })


@login_required
def api_chat_conversations(request):
    """
    GET /api/chat/conversations/
    Returns conversation list for logged-in user from messages & friends tables.
    """
    user_id = request.user.id
    conversations = []

    with connection.cursor() as cur:
        # Find all distinct partners: either from messages or from accepted friendships
        sql = """
            SELECT 
                f.friend_id,
                a.name, a.username, a.picture, a.last_seen,
                lm.id AS last_msg_id, lm.message AS last_message, lm.message_type, lm.created_at AS last_time,
                COALESCE(un.unread_count, 0) AS unread_count
            FROM (
                SELECT DISTINCT
                    CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END AS friend_id
                FROM messages
                WHERE (sender_id = %s OR receiver_id = %s) AND (is_deleted = 0 OR is_deleted IS NULL)
                UNION
                SELECT CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END AS friend_id
                FROM friends
                WHERE (sender_id = %s OR receiver_id = %s) AND status = 'accepted'
            ) f
            JOIN auth a ON a.id = f.friend_id
            LEFT JOIN (
                SELECT m1.*
                FROM messages m1
                JOIN (
                    SELECT 
                        CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END AS partner_id,
                        MAX(id) AS max_id
                    FROM messages
                    WHERE (sender_id = %s OR receiver_id = %s) AND (is_deleted = 0 OR is_deleted IS NULL)
                    GROUP BY partner_id
                ) m2 ON m1.id = m2.max_id
            ) lm ON lm.id IS NOT NULL AND (lm.sender_id = f.friend_id OR lm.receiver_id = f.friend_id)
            LEFT JOIN (
                SELECT sender_id, COUNT(*) AS unread_count
                FROM messages
                WHERE receiver_id = %s AND is_read = 0 AND (is_deleted = 0 OR is_deleted IS NULL)
                GROUP BY sender_id
            ) un ON un.sender_id = f.friend_id
            ORDER BY COALESCE(lm.created_at, '2000-01-01') DESC
        """
        cur.execute(sql, [user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id])
        rows = cur.fetchall()

        now = timezone.now()
        for r in rows:
            fid = r[0]
            name = r[1] or r[2] or 'User'
            username = r[2] or 'user'
            pic = _full_avatar_url(r[3])
            last_seen = r[4]
            is_online = False
            if last_seen:
                if timezone.is_naive(last_seen):
                    last_seen_aware = timezone.make_aware(last_seen)
                else:
                    last_seen_aware = last_seen
                is_online = (now - last_seen_aware).total_seconds() < 120

            last_msg = r[6] or 'Start conversation'
            msg_type = r[7] or 'text'
            if msg_type == 'image':
                last_msg = '📷 Photo'
            elif msg_type == 'video':
                last_msg = '🎥 Video'
            elif msg_type == 'file':
                last_msg = '📁 File'
            elif msg_type == 'voice':
                last_msg = '🎤 Voice message'

            if len(last_msg) > 40:
                last_msg = last_msg[:40] + '...'

            last_time = r[8]
            time_ago_str = _format_time_ago(last_time, now) if last_time else ''

            chat_id = f"{min(user_id, fid)}_{max(user_id, fid)}"

            conversations.append({
                'friend_id': fid,
                'chat_id': chat_id,
                'name': name,
                'username': username,
                'picture': pic,
                'online': is_online,
                'last_message': last_msg,
                'last_time': last_time.isoformat() if last_time else '',
                'time_ago': time_ago_str,
                'unread_count': int(r[9]),
            })

    return JsonResponse({'success': True, 'conversations': conversations})


@login_required
def api_chat_messages(request):
    """
    GET /api/chat/messages/?friend_id=<id>
    Returns sorted message history between request.user and friend.
    Also automatically marks received messages as read.
    """
    user_id = request.user.id
    friend_id = request.GET.get('friend_id')
    if not friend_id or not str(friend_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid friend ID'}, status=400)

    friend_id = int(friend_id)

    # Get friend info
    with connection.cursor() as cur:
        cur.execute("SELECT id, name, username, picture, last_seen FROM auth WHERE id = %s", [friend_id])
        friend_row = cur.fetchone()

    if not friend_row:
        return JsonResponse({'success': False, 'error': 'User not found'}, status=404)

    now = timezone.now()
    friend_last_seen = friend_row[4]
    is_online = False
    if friend_last_seen:
        if timezone.is_naive(friend_last_seen):
            fls_aware = timezone.make_aware(friend_last_seen)
        else:
            fls_aware = friend_last_seen
        is_online = (now - fls_aware).total_seconds() < 120

    friend_data = {
        'id': friend_row[0],
        'name': friend_row[1] or friend_row[2] or 'User',
        'username': friend_row[2] or 'user',
        'picture': _full_avatar_url(friend_row[3]),
        'online': is_online,
    }

    # Fetch messages
    with connection.cursor() as cur:
        cur.execute("""
            SELECT m.id, m.sender_id, m.receiver_id, m.message, m.message_type,
                   m.media_url, m.s3_url, m.s3_key, m.file_name, m.file_size,
                   m.reply_to, m.is_read, m.created_at, m.edited,
                   a.name AS sender_name, a.username AS sender_username, a.picture AS sender_picture,
                   rm.message AS reply_text, rm.sender_id AS reply_sender_id, ra.name AS reply_sender_name
            FROM messages m
            JOIN auth a ON m.sender_id = a.id
            LEFT JOIN messages rm ON m.reply_to = rm.id
            LEFT JOIN auth ra ON rm.sender_id = ra.id
            WHERE ((m.sender_id = %s AND m.receiver_id = %s) OR (m.sender_id = %s AND m.receiver_id = %s))
              AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
            ORDER BY m.created_at ASC
        """, [user_id, friend_id, friend_id, user_id])
        rows = cur.fetchall()

        # Mark received messages as read
        cur.execute("""
            UPDATE messages
            SET is_read = 1, read_at = NOW()
            WHERE sender_id = %s AND receiver_id = %s AND is_read = 0
        """, [friend_id, user_id])

        msg_ids = [r[0] for r in rows]
        reactions_by_msg = {}
        if msg_ids:
            placeholders = ','.join(['%s'] * len(msg_ids))
            cur.execute(f"""
                SELECT cr.message_id, cr.user_id, cr.reaction, a.name
                FROM chat_reactions cr
                JOIN auth a ON cr.user_id = a.id
                WHERE cr.message_id IN ({placeholders})
            """, msg_ids)
            for cr_row in cur.fetchall():
                mid = cr_row[0]
                reactions_by_msg.setdefault(mid, []).append({
                    'user_id': cr_row[1],
                    'reaction': cr_row[2],
                    'name': cr_row[3] or 'User',
                })

    messages = []
    for r in rows:
        mid = r[0]
        sender_pic = _full_avatar_url(r[16])
        created_at_dt = r[12]
        time_str = created_at_dt.strftime('%I:%M %p').lstrip('0') if created_at_dt else ''
        
        reply_data = None
        if r[10] and r[17]:
            reply_data = {
                'id': r[10],
                'message': r[17][:80] + ('...' if len(r[17]) > 80 else ''),
                'sender_id': r[18],
                'sender_name': r[19] or 'User',
            }

        s3_url = r[6]
        if not s3_url and r[7]:
            s3_url = f"https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{r[7]}"
        elif not s3_url and r[5]:
            s3_url = r[5]

        messages.append({
            'id': mid,
            'sender_id': r[1],
            'receiver_id': r[2],
            'message': r[3] or '',
            'message_type': r[4] or 'text',
            'media_url': r[5] or '',
            's3_url': s3_url or '',
            's3_key': r[7] or '',
            'file_name': r[8] or '',
            'file_size': r[9] or 0,
            'reply_to': r[10],
            'reply_snippet': reply_data,
            'is_read': bool(r[11]),
            'created_at': created_at_dt.isoformat() if created_at_dt else '',
            'time': time_str,
            'time_ago': _format_time_ago(created_at_dt, now) if created_at_dt else '',
            'edited': bool(r[13]),
            'sender_name': r[14] or r[15] or 'User',
            'sender_username': r[15] or '',
            'sender_picture': sender_pic,
            'reactions': reactions_by_msg.get(mid, []),
        })

    chat_id = f"{min(user_id, friend_id)}_{max(user_id, friend_id)}"

    return JsonResponse({
        'success': True,
        'messages': messages,
        'friend': friend_data,
        'chat_id': chat_id,
        'current_user_id': user_id,
    })


@login_required
@require_POST
def api_chat_send(request):
    """
    POST /api/chat/send/
    Body: friend_id, message, [message_type, s3_key, file_name, file_size, duration, reply_to]
    Inserts into messages table, pushes to Firebase RTDB, and sends notification.
    """
    user_id = request.user.id
    friend_id = request.POST.get('friend_id')
    message_text = (request.POST.get('message') or '').strip()
    message_type = (request.POST.get('message_type') or 'text').strip().lower()
    s3_key = (request.POST.get('s3_key') or '').strip()
    file_name = (request.POST.get('file_name') or '').strip()
    file_size = int(request.POST.get('file_size') or 0)
    duration = int(request.POST.get('duration') or 0)
    reply_to = request.POST.get('reply_to')
    reply_to_id = int(reply_to) if reply_to and str(reply_to).isdigit() else None

    if not friend_id or not str(friend_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid friend ID'}, status=400)

    friend_id = int(friend_id)
    if friend_id == user_id:
        return JsonResponse({'success': False, 'error': 'Cannot send message to yourself'}, status=400)

    if not message_text and not s3_key:
        return JsonResponse({'success': False, 'error': 'Empty message and no media attached'}, status=400)

    with connection.cursor() as cur:
        cur.execute("SELECT id, name, username FROM auth WHERE id = %s", [friend_id])
        friend = cur.fetchone()

    if not friend:
        return JsonResponse({'success': False, 'error': 'Recipient not found'}, status=404)

    s3_url = f"https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{s3_key}" if s3_key else ''
    display_content = message_text
    if not display_content:
        if message_type == 'image': display_content = '📷 Photo'
        elif message_type == 'video': display_content = '🎥 Video'
        elif message_type == 'audio': display_content = '🎵 Audio'
        elif message_type == 'voice': display_content = '🎤 Voice message'
        elif message_type == 'file': display_content = f'📁 {file_name or "File"}'

    with connection.cursor() as cur:
        cur.execute("""
            INSERT INTO messages (
                sender_id, receiver_id, message, message_type,
                media_url, s3_key, s3_url, file_name, file_size, reply_to,
                is_read, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, NOW())
        """, [
            user_id, friend_id, display_content, message_type,
            s3_url, s3_key, s3_url, file_name, file_size, reply_to_id
        ])
        msg_id = cur.lastrowid

        # Update last_seen for sender
        cur.execute("UPDATE auth SET last_seen = NOW() WHERE id = %s", [user_id])

    now_dt = timezone.now()
    sender_name = getattr(request.user, 'name', '') or request.user.username or 'User'
    sender_pic = _full_avatar_url(getattr(request.user, 'picture', None))
    chat_id = f"{min(user_id, friend_id)}_{max(user_id, friend_id)}"
    time_str = now_dt.strftime('%I:%M %p').lstrip('0')

    message_data = {
        'id': msg_id,
        'sender_id': user_id,
        'receiver_id': friend_id,
        'message': display_content,
        'message_type': message_type,
        'media_url': s3_url,
        's3_url': s3_url,
        's3_key': s3_key,
        'file_name': file_name,
        'file_size': file_size,
        'duration': duration,
        'reply_to': reply_to_id,
        'is_read': False,
        'created_at': now_dt.isoformat(),
        'time': time_str,
        'time_ago': 'Just now',
        'sender_name': sender_name,
        'sender_username': request.user.username or '',
        'sender_picture': sender_pic,
        'reactions': [],
    }

    # Firebase RTDB push
    firebase_payload = {
        'id': str(msg_id),
        'sender_id': user_id,
        'sender_name': sender_name,
        'content': display_content,
        'message_type': message_type,
        'media_url': s3_url,
        's3_url': s3_url,
        'duration': duration,
        'reply_to': reply_to_id,
        'timestamp': int(now_dt.timestamp()),
    }
    _push_chat_message_firebase(chat_id, firebase_payload)

    # In-app notification to receiver (deduped: 1 unread notification per conversation, updated in place)
    try:
        chat_key = f'/chat/{user_id}/'
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id FROM notifications
                WHERE user_id = %s
                  AND type = 'chat_message'
                  AND link = %s
                  AND is_read = 0
                  AND created_at > NOW() - INTERVAL 60 MINUTE
                ORDER BY id DESC LIMIT 1
            """, [friend_id, chat_key])
            existing_notif = cur.fetchone()

        if existing_notif:
            existing_id = existing_notif[0]
            updated_title = f'New messages from {sender_name}'
            updated_body = display_content[:100]

            with connection.cursor() as cur:
                cur.execute("""
                    UPDATE notifications
                    SET title = %s,
                        message = %s,
                        actor_id = %s,
                        created_at = NOW(),
                        expires_at = NOW() + INTERVAL 30 DAY
                    WHERE id = %s
                """, [updated_title, updated_body, user_id, existing_id])

            # Push updated notification to Firebase (overwrites same node, no extra badge increment)
            try:
                from landing.tasks import send_push_notification
                send_push_notification.delay(
                    user_id=friend_id,
                    title=f"💬 {updated_title}",
                    body=updated_body,
                    link=chat_key,
                    notif_id=existing_id,
                    actor_id=user_id,
                    actor_name=sender_name,
                    actor_username=request.user.username or '',
                    actor_picture=sender_pic,
                    notif_type='chat_message',
                    overwrite=True,
                )
            except Exception as e:
                logger.warning(f"Celery dispatch failed in api_chat_send update: {e}")
        else:
            _notify(
                friend_id,
                'chat_message',
                f'New message from {sender_name}',
                display_content[:100],
                link=chat_key,
                actor_id=user_id,
            )
    except Exception as e:
        logger.warning(f"Notification error in api_chat_send: {e}")

    return JsonResponse({'success': True, 'message': message_data})


@login_required
@require_POST
def api_chat_upload(request):
    """
    POST /api/chat/upload/
    Generate a presigned PUT URL for direct browser -> S3 upload for chat media.
    Allowed types: image/*, video/*, audio/*, pdf, zip, docx.
    """
    import boto3, json as _json
    ALLOWED_CONTENT_TYPES = {
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime',
        'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
        'application/pdf', 'application/zip', 'application/x-zip-compressed',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword', 'text/plain',
    }

    try:
        body = _json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        body = request.POST

    filename = (body.get('filename') or 'file').strip()
    content_type = (body.get('content_type') or 'image/jpeg').strip().lower()

    if content_type not in ALLOWED_CONTENT_TYPES and not content_type.startswith('image/') and not content_type.startswith('audio/'):
        return JsonResponse({'success': False, 'error': f'File type {content_type} not supported'}, status=400)

    bucket = os.environ.get('AWS_STORAGE_BUCKET_NAME', 'xapyx.com-media')
    region = os.environ.get('AWS_S3_REGION_NAME', 'eu-west-1')
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    if not access_key or not secret_key:
        return JsonResponse({'success': False, 'error': 'AWS credentials missing'}, status=500)

    ext = os.path.splitext(filename)[1].lower() or ''
    key = f'uploads/chat/{uuid.uuid4().hex}{ext}'

    try:
        s3 = boto3.client(
            's3',
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        upload_url = s3.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': bucket,
                'Key': key,
                'ContentType': content_type,
            },
            ExpiresIn=300,
        )
        public_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{key}'
        return JsonResponse({
            'success': True,
            'upload_url': upload_url,
            'key': key,
            'public_url': public_url,
        })
    except Exception as e:
        logger.error(f'api_chat_upload failed: {e}')
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_POST
def api_chat_typing(request):
    """
    POST /api/chat/typing/
    Body: {friend_id, typing: true|false}
    Writes or removes typing indicator node on Firebase RTDB chats/{chat_id}/typing/{user_id}.
    """
    import requests
    user_id = request.user.id
    friend_id = request.POST.get('friend_id')
    is_typing = str(request.POST.get('typing', 'false')).lower() in ('true', '1')

    if not friend_id or not str(friend_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid friend ID'}, status=400)

    friend_id = int(friend_id)
    chat_id = f"{min(user_id, friend_id)}_{max(user_id, friend_id)}"
    base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/chats/{chat_id}/typing/{user_id}.json"

    try:
        if is_typing:
            now_ts = int(timezone.now().timestamp())
            requests.put(url, json={'typing': True, 'timestamp': now_ts}, timeout=3)
        else:
            requests.delete(url, timeout=3)
    except Exception as e:
        logger.warning(f"Firebase typing update error: {e}")

    return JsonResponse({'success': True})


@login_required
@require_POST
def api_chat_react(request):
    """
    POST /api/chat/react/
    Body: {message_id, reaction}
    Updates chat_reactions table and pushes to Firebase RTDB chats/{chat_id}/messages/{msg_id}/reactions/{uid}.
    """
    import requests
    user_id = request.user.id
    message_id = request.POST.get('message_id')
    reaction = (request.POST.get('reaction') or '').strip()

    if not message_id or not str(message_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid message ID'}, status=400)

    message_id = int(message_id)

    with connection.cursor() as cur:
        cur.execute("SELECT sender_id, receiver_id FROM messages WHERE id = %s", [message_id])
        msg = cur.fetchone()

    if not msg:
        return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)

    sender_id, receiver_id = msg[0], msg[1]
    if user_id not in (sender_id, receiver_id):
        return JsonResponse({'success': False, 'error': 'Unauthorized'}, status=403)

    chat_id = f"{min(sender_id, receiver_id)}_{max(sender_id, receiver_id)}"
    base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
    fb_reaction_url = f"{base_url}/chats/{chat_id}/messages/{message_id}/reactions/{user_id}.json"

    user_name = getattr(request.user, 'name', '') or request.user.username or 'User'

    with connection.cursor() as cur:
        if reaction:
            cur.execute("""
                INSERT INTO chat_reactions (message_id, user_id, reaction, created_at)
                VALUES (%s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE reaction = VALUES(reaction)
            """, [message_id, user_id, reaction])
            try:
                requests.put(fb_reaction_url, json={'reaction': reaction, 'user_id': user_id, 'name': user_name}, timeout=3)
            except Exception as e:
                logger.warning(f"Firebase reaction push error: {e}")
        else:
            cur.execute("DELETE FROM chat_reactions WHERE message_id = %s AND user_id = %s", [message_id, user_id])
            try:
                requests.delete(fb_reaction_url, timeout=3)
            except Exception as e:
                logger.warning(f"Firebase reaction delete error: {e}")

    # Fetch updated reactions for this message
    with connection.cursor() as cur:
        cur.execute("""
            SELECT cr.user_id, cr.reaction, a.name
            FROM chat_reactions cr
            JOIN auth a ON cr.user_id = a.id
            WHERE cr.message_id = %s
        """, [message_id])
        reactions = [{'user_id': r[0], 'reaction': r[1], 'name': r[2] or 'User'} for r in cur.fetchall()]

    return JsonResponse({'success': True, 'reactions': reactions})


@login_required
@require_POST
def api_chat_edit(request):
    """
    POST /api/chat/edit/
    Body: {message_id, new_content}
    Updates message content in MySQL and Firebase RTDB.
    """
    import requests
    user_id = request.user.id
    message_id = request.POST.get('message_id')
    new_content = (request.POST.get('new_content') or '').strip()

    if not message_id or not str(message_id).isdigit() or not new_content:
        return JsonResponse({'success': False, 'error': 'Invalid parameters'}, status=400)

    message_id = int(message_id)

    with connection.cursor() as cur:
        cur.execute("SELECT sender_id, receiver_id FROM messages WHERE id = %s", [message_id])
        msg = cur.fetchone()

    if not msg:
        return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)

    if msg[0] != user_id:
        return JsonResponse({'success': False, 'error': 'Only sender can edit message'}, status=403)

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE messages
            SET message = %s, edited = 1, edited_at = NOW()
            WHERE id = %s AND sender_id = %s
        """, [new_content, message_id, user_id])

    chat_id = f"{min(msg[0], msg[1])}_{max(msg[0], msg[1])}"
    base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/chats/{chat_id}/messages/{message_id}.json"
    try:
        requests.patch(url, json={'content': new_content, 'edited': True}, timeout=3)
    except Exception as e:
        logger.warning(f"Firebase edit update error: {e}")

    return JsonResponse({'success': True, 'new_content': new_content})


@login_required
@require_POST
def api_chat_delete(request):
    """
    POST /api/chat/delete/
    Body: {message_id}
    Soft-deletes message in MySQL and updates/removes from Firebase RTDB.
    """
    import requests
    user_id = request.user.id
    message_id = request.POST.get('message_id')

    if not message_id or not str(message_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid message ID'}, status=400)

    message_id = int(message_id)

    with connection.cursor() as cur:
        cur.execute("SELECT sender_id, receiver_id FROM messages WHERE id = %s", [message_id])
        msg = cur.fetchone()

    if not msg:
        return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)

    if msg[0] != user_id:
        return JsonResponse({'success': False, 'error': 'Only sender can delete message'}, status=403)

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE messages
            SET is_deleted = 1, deleted_at = NOW()
            WHERE id = %s AND sender_id = %s
        """, [message_id, user_id])

    chat_id = f"{min(msg[0], msg[1])}_{max(msg[0], msg[1])}"
    base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/chats/{chat_id}/messages/{message_id}.json"
    try:
        requests.delete(url, timeout=3)
    except Exception as e:
        logger.warning(f"Firebase delete error: {e}")

    return JsonResponse({'success': True, 'message_id': message_id})


@login_required
@require_POST
def api_chat_mark_read(request):
    """
    POST /api/chat/read/
    Body: friend_id
    Marks messages from friend to request.user as read in DB and Firebase.
    """
    import requests
    user_id = request.user.id
    friend_id = request.POST.get('friend_id')

    if not friend_id or not str(friend_id).isdigit():
        return JsonResponse({'success': False, 'error': 'Invalid friend ID'}, status=400)

    friend_id = int(friend_id)

    with connection.cursor() as cur:
        cur.execute("""
            UPDATE messages
            SET is_read = 1, read_at = NOW()
            WHERE sender_id = %s AND receiver_id = %s AND is_read = 0
        """, [friend_id, user_id])
        affected = cur.rowcount

    chat_id = f"{min(user_id, friend_id)}_{max(user_id, friend_id)}"
    base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/chats/{chat_id}/read_at/{user_id}.json"
    try:
        requests.put(url, json=int(timezone.now().timestamp()), timeout=3)
    except Exception as e:
        logger.warning(f"Firebase read_at update error: {e}")

    return JsonResponse({'success': True, 'affected': affected})




# ============================================================
# CHAT ROOMS DIRECTORY & MANAGEMENT (Task 18 Phase 3)
# ============================================================

@login_required
def chatrooms_view(request):
    """
    GET /chatrooms/ — Chat Rooms directory and management view.
    """
    return render(request, 'dashboard/chatrooms.html', {
        'active_page': 'chatrooms',
        'svg_logo': _load_svg_logo(),
    })


@login_required
def chatroom_view(request, room_id):
    """
    GET /chatrooms/<room_id>/ — Live Chat Room view.
    Enforces membership: non-members receive HTTP 403.
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.name, c.description, c.picture, c.creator_id, c.privacy, c.member_limit,
                   cm.is_admin, cm.user_id
            FROM chatrooms c
            LEFT JOIN chatroom_members cm ON cm.chatroom_id = c.id AND cm.user_id = %s
            WHERE c.id = %s AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
        """, [user_id, room_id])
        room = cur.fetchone()

    if not room:
        return redirect('/chatrooms/')

    is_member = (room[8] is not None)
    if not is_member:
        return HttpResponse("Access Denied: You must be a member of this chat room to access it.", status=403)

    creator_id = room[4]
    is_creator = (creator_id == user_id)
    is_admin = bool(room[7]) or is_creator

    return render(request, 'dashboard/chatroom_chat.html', {
        'active_page': 'chatrooms',
        'room_id': room_id,
        'room_name': room[1],
        'room_desc': room[2] or '',
        'room_pic': room[3] or '',
        'is_admin': is_admin,
        'is_creator': is_creator,
        'creator_id': creator_id,
        'svg_logo': _load_svg_logo(),
    })


@login_required
def api_chatrooms_list(request):
    """
    GET /api/chatrooms/list/?tab=all|my|joined&search=...&privacy=...
    Lists chatrooms with member count, user membership status, and admin rights.
    """
    user_id = request.user.id
    tab = (request.GET.get('tab') or 'all').strip().lower()
    search = (request.GET.get('search') or '').strip().lower()
    privacy = (request.GET.get('privacy') or 'all').strip().lower()

    sql = """
        SELECT 
            c.id, c.name, c.description, c.picture, c.creator_id,
            c.privacy, c.invite_code, c.member_limit, c.created_at,
            COALESCE(m_cnt.cnt, 0) AS member_count,
            CASE WHEN cm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_member,
            COALESCE(cm.is_admin, 0) AS is_admin,
            a.name AS creator_name, a.username AS creator_username, a.picture AS creator_picture
        FROM chatrooms c
        LEFT JOIN (
            SELECT chatroom_id, COUNT(*) AS cnt
            FROM chatroom_members
            GROUP BY chatroom_id
        ) m_cnt ON m_cnt.chatroom_id = c.id
        LEFT JOIN chatroom_members cm ON cm.chatroom_id = c.id AND cm.user_id = %s
        LEFT JOIN auth a ON a.id = c.creator_id
        WHERE (c.is_deleted = 0 OR c.is_deleted IS NULL)
    """
    params = [user_id]

    if tab == 'my':
        sql += " AND c.creator_id = %s"
        params.append(user_id)
    elif tab == 'joined':
        sql += " AND cm.user_id IS NOT NULL"

    if privacy in ('public', 'private'):
        sql += " AND c.privacy = %s"
        params.append(privacy)

    if search:
        sql += " AND (LOWER(c.name) LIKE %s OR LOWER(COALESCE(c.description, '')) LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])

    sql += " ORDER BY c.created_at DESC"

    with connection.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    now = timezone.now()
    rooms = []
    for r in rows:
        room_id = r[0]
        creator_id = r[4]
        is_creator = (creator_id == user_id)
        is_member = bool(r[10])
        is_admin = bool(r[11]) or is_creator

        raw_pic = r[3]
        if raw_pic:
            if raw_pic.startswith('http://') or raw_pic.startswith('https://'):
                pic_url = raw_pic
            elif raw_pic.startswith('uploads/'):
                pic_url = f"https://s3.eu-west-1.amazonaws.com/xapyx.com-media/{raw_pic}"
            else:
                pic_url = _full_avatar_url(raw_pic)
        else:
            pic_url = ''

        created_dt = r[8]
        time_ago_str = _format_time_ago(created_dt, now) if created_dt else ''

        # Only expose invite_code to creator or admin
        invite_code = r[6] if (is_creator or is_admin) else ''

        rooms.append({
            'id': room_id,
            'name': r[1],
            'description': r[2] or '',
            'picture': pic_url,
            'creator_id': creator_id,
            'creator_name': r[12] or r[13] or 'User',
            'creator_picture': _full_avatar_url(r[14]),
            'privacy': r[5] or 'public',
            'invite_code': invite_code or '',
            'member_limit': int(r[7] or 20),
            'member_count': int(r[9]),
            'is_member': is_member,
            'is_admin': is_admin,
            'is_creator': is_creator,
            'created_at': created_dt.isoformat() if created_dt else '',
            'time_ago': time_ago_str,
        })

    return JsonResponse({'success': True, 'rooms': rooms, 'current_user_id': user_id})


@login_required
@require_POST
def api_chatrooms_create(request):
    """
    POST /api/chatrooms/create/
    Body: name, description, privacy ('public'|'private'), member_limit, picture (optional)
    Creates room and adds creator as admin member.
    """
    import secrets
    user_id = request.user.id
    name = (request.POST.get('name') or '').strip()
    description = (request.POST.get('description') or '').strip()
    privacy = (request.POST.get('privacy') or 'public').strip().lower()
    picture = (request.POST.get('picture') or '').strip()
    member_limit = request.POST.get('member_limit')

    if not name:
        return JsonResponse({'success': False, 'error': 'Room name is required'}, status=400)

    if len(name) > 150:
        return JsonResponse({'success': False, 'error': 'Room name cannot exceed 150 characters'}, status=400)

    if privacy not in ('public', 'private'):
        privacy = 'public'

    try:
        member_limit = int(member_limit or 20)
        if member_limit < 2:
            member_limit = 2
        elif member_limit > 500:
            member_limit = 500
    except (ValueError, TypeError):
        member_limit = 20

    invite_code = secrets.token_hex(4).upper() if privacy == 'private' else None

    with connection.cursor() as cur:
        # Check uniqueness
        cur.execute("SELECT id FROM chatrooms WHERE LOWER(name) = LOWER(%s) AND (is_deleted = 0 OR is_deleted IS NULL)", [name])
        if cur.fetchone():
            return JsonResponse({'success': False, 'error': 'A chat room with this name already exists'}, status=400)

        cur.execute("""
            INSERT INTO chatrooms (
                name, description, picture, creator_id, privacy,
                invite_code, member_limit, is_deleted, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 0, NOW(), NOW())
        """, [name, description, picture, user_id, privacy, invite_code, member_limit])
        room_id = cur.lastrowid

        # Add creator to chatroom_members as admin
        cur.execute("""
            INSERT INTO chatroom_members (chatroom_id, user_id, is_admin, joined_at, last_activity)
            VALUES (%s, %s, 1, NOW(), NOW())
        """, [room_id, user_id])

    return JsonResponse({
        'success': True,
        'room': {
            'id': room_id,
            'name': name,
            'description': description,
            'privacy': privacy,
            'invite_code': invite_code or '',
            'member_limit': member_limit,
            'member_count': 1,
        }
    })


@login_required
@require_POST
def api_chatrooms_edit(request, room_id):
    """
    POST /api/chatrooms/<room_id>/edit/
    Body: name, description, privacy, member_limit, picture (optional)
    Creator or admin can edit room settings.
    """
    import secrets
    user_id = request.user.id
    name = (request.POST.get('name') or '').strip()
    description = (request.POST.get('description') or '').strip()
    privacy = (request.POST.get('privacy') or '').strip().lower()
    picture = (request.POST.get('picture') or '').strip()
    member_limit = request.POST.get('member_limit')

    with connection.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.name, c.creator_id, c.privacy, c.invite_code, c.member_limit,
                   cm.is_admin
            FROM chatrooms c
            LEFT JOIN chatroom_members cm ON cm.chatroom_id = c.id AND cm.user_id = %s
            WHERE c.id = %s AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
        """, [user_id, room_id])
        room = cur.fetchone()

    if not room:
        return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)

    is_creator = (room[2] == user_id)
    is_admin = bool(room[6]) or is_creator
    if not is_admin:
        return JsonResponse({'success': False, 'error': 'Only creator or room admins can edit this room'}, status=403)

    if name and name.lower() != room[1].lower():
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id FROM chatrooms 
                WHERE LOWER(name) = LOWER(%s) AND id != %s AND (is_deleted = 0 OR is_deleted IS NULL)
            """, [name, room_id])
            if cur.fetchone():
                return JsonResponse({'success': False, 'error': 'A chat room with this name already exists'}, status=400)
    else:
        name = room[1]

    curr_privacy = room[3]
    invite_code = room[4]
    new_privacy = privacy if privacy in ('public', 'private') else curr_privacy

    if new_privacy == 'private' and not invite_code:
        invite_code = secrets.token_hex(4).upper()
    elif new_privacy == 'public':
        invite_code = None

    try:
        new_limit = int(member_limit or room[5] or 20)
        new_limit = max(2, min(new_limit, 500))
    except (ValueError, TypeError):
        new_limit = room[5] or 20

    with connection.cursor() as cur:
        if picture:
            cur.execute("""
                UPDATE chatrooms
                SET name = %s, description = %s, picture = %s, privacy = %s,
                    invite_code = %s, member_limit = %s, updated_at = NOW()
                WHERE id = %s
            """, [name, description, picture, new_privacy, invite_code, new_limit, room_id])
        else:
            cur.execute("""
                UPDATE chatrooms
                SET name = %s, description = %s, privacy = %s,
                    invite_code = %s, member_limit = %s, updated_at = NOW()
                WHERE id = %s
            """, [name, description, new_privacy, invite_code, new_limit, room_id])

    return JsonResponse({
        'success': True,
        'room': {
            'id': room_id,
            'name': name,
            'description': description,
            'privacy': new_privacy,
            'invite_code': invite_code or '',
            'member_limit': new_limit,
        }
    })


@login_required
@require_POST
def api_chatrooms_delete(request, room_id):
    """
    POST /api/chatrooms/<room_id>/delete/
    Soft-deletes room. Only creator can delete.
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM chatrooms WHERE id = %s AND (is_deleted = 0 OR is_deleted IS NULL)", [room_id])
        room = cur.fetchone()

    if not room:
        return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)

    if room[0] != user_id:
        return JsonResponse({'success': False, 'error': 'Only the room creator can delete this room'}, status=403)

    with connection.cursor() as cur:
        cur.execute("UPDATE chatrooms SET is_deleted = 1, updated_at = NOW() WHERE id = %s", [room_id])

    return JsonResponse({'success': True, 'room_id': room_id})


@login_required
@require_POST
def api_chatrooms_join(request, room_id):
    """
    POST /api/chatrooms/<room_id>/join/
    Joins a public chat room. Enforces member_limit.
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("""
            SELECT id, privacy, member_limit 
            FROM chatrooms 
            WHERE id = %s AND (is_deleted = 0 OR is_deleted IS NULL)
        """, [room_id])
        room = cur.fetchone()

    if not room:
        return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)

    if room[1] == 'private':
        return JsonResponse({'success': False, 'error': 'This is a private room. An invite code is required to join.'}, status=400)

    member_limit = room[2] or 20

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        if cur.fetchone():
            return JsonResponse({'success': True, 'already_member': True, 'room_id': room_id})

        cur.execute("SELECT COUNT(*) FROM chatroom_members WHERE chatroom_id = %s", [room_id])
        curr_count = cur.fetchone()[0]
        if curr_count >= member_limit:
            return JsonResponse({'success': False, 'error': 'Room is full (member limit reached)'}, status=400)

        cur.execute("""
            INSERT INTO chatroom_members (chatroom_id, user_id, is_admin, joined_at, last_activity)
            VALUES (%s, %s, 0, NOW(), NOW())
        """, [room_id, user_id])

    return JsonResponse({'success': True, 'room_id': room_id})


@login_required
@require_POST
def api_chatrooms_join_private(request, room_id):
    """
    POST /api/chatrooms/<room_id>/join-private/
    Body: invite_code
    Joins a private chat room with valid invite_code. Enforces member_limit.
    """
    user_id = request.user.id
    invite_code = (request.POST.get('invite_code') or '').strip().upper()

    if not invite_code:
        return JsonResponse({'success': False, 'error': 'Invite code is required'}, status=400)

    with connection.cursor() as cur:
        cur.execute("""
            SELECT id, privacy, invite_code, member_limit 
            FROM chatrooms 
            WHERE id = %s AND (is_deleted = 0 OR is_deleted IS NULL)
        """, [room_id])
        room = cur.fetchone()

    if not room:
        return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)

    expected_code = (room[2] or '').strip().upper()
    if not expected_code or invite_code != expected_code:
        return JsonResponse({'success': False, 'error': 'Invalid invite code'}, status=400)

    member_limit = room[3] or 20

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        if cur.fetchone():
            return JsonResponse({'success': True, 'already_member': True, 'room_id': room_id})

        cur.execute("SELECT COUNT(*) FROM chatroom_members WHERE chatroom_id = %s", [room_id])
        curr_count = cur.fetchone()[0]
        if curr_count >= member_limit:
            return JsonResponse({'success': False, 'error': 'Room is full (member limit reached)'}, status=400)

        cur.execute("""
            INSERT INTO chatroom_members (chatroom_id, user_id, is_admin, joined_at, last_activity)
            VALUES (%s, %s, 0, NOW(), NOW())
        """, [room_id, user_id])

    return JsonResponse({'success': True, 'room_id': room_id})


@login_required
@require_POST
def api_chatrooms_exit(request, room_id):
    """
    POST /api/chatrooms/<room_id>/exit/
    Leaves a chat room.
    If creator leaves: assigns new admin or marks room closed if empty.
    """
    user_id = request.user.id

    with connection.cursor() as cur:
        cur.execute("SELECT id, creator_id FROM chatrooms WHERE id = %s AND (is_deleted = 0 OR is_deleted IS NULL)", [room_id])
        room = cur.fetchone()

    if not room:
        return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)

    creator_id = room[1]

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'You are not a member of this chat room'}, status=400)

        cur.execute("DELETE FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])

        if user_id == creator_id:
            cur.execute("""
                SELECT user_id, is_admin FROM chatroom_members 
                WHERE chatroom_id = %s 
                ORDER BY is_admin DESC, joined_at ASC 
                LIMIT 1
            """, [room_id])
            next_member = cur.fetchone()
            if next_member:
                new_admin_id = next_member[0]
                cur.execute("UPDATE chatroom_members SET is_admin = 1 WHERE chatroom_id = %s AND user_id = %s", [room_id, new_admin_id])
                cur.execute("UPDATE chatrooms SET creator_id = %s, updated_at = NOW() WHERE id = %s", [new_admin_id, room_id])
            else:
                cur.execute("UPDATE chatrooms SET is_deleted = 1, updated_at = NOW() WHERE id = %s", [room_id])

    return JsonResponse({'success': True, 'room_id': room_id})


@login_required
def api_chatrooms_check_name(request):
    """
    GET /api/chatrooms/check-name/?name=...&room_id=...
    Checks if a room name is available.
    """
    name = (request.GET.get('name') or '').strip()
    room_id = request.GET.get('room_id')

    if not name:
        return JsonResponse({'available': False, 'error': 'Name is empty'})

    sql = "SELECT id FROM chatrooms WHERE LOWER(name) = LOWER(%s) AND (is_deleted = 0 OR is_deleted IS NULL)"
    params = [name]

    if room_id and str(room_id).isdigit():
        sql += " AND id != %s"
        params.append(int(room_id))

    with connection.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()

    available = (row is None)
    return JsonResponse({'available': available, 'name': name})


# ============================================================
# CHAT ROOM MESSAGING & MODERATION (Task 18 Phase 4)
# ============================================================

def _push_chatroom_message_firebase(room_id, message_data):
    """
    Push a chatroom message to Firebase RTDB node:
    chatrooms/{room_id}/messages/{message_id}
    Using FIREBASE_CHATROOM_DB_URL REST endpoint.
    """
    import os, requests, logging
    _log = logging.getLogger(__name__)
    base_url = os.environ.get('FIREBASE_CHATROOM_DB_URL', 'https://xapyx-chatroom-chat-default-rtdb.firebaseio.com').rstrip('/')
    url = f"{base_url}/chatrooms/{room_id}/messages/{message_data['id']}.json"
    try:
        resp = requests.put(url, json=message_data, timeout=5)
        if resp.status_code == 200:
            return True
        _log.warning(f"Firebase chatroom push returned HTTP {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        _log.warning(f"Firebase chatroom push failed: {e}")
        return False


@login_required
def api_chatroom_messages(request, room_id):
    """
    GET /api/chatrooms/<room_id>/messages/
    Verifies membership, fetches messages in ascending order joining auth.
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        # Verify membership
        cur.execute("SELECT id, is_admin FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        membership = cur.fetchone()
        if not membership:
            return JsonResponse({'success': False, 'error': 'Not a member of this room'}, status=403)

        cur.execute("""
            SELECT m.id, m.chatroom_id, m.user_id, m.message, m.media_data, m.image_path,
                   m.created_at, m.edited, m.edited_at,
                   a.name AS sender_name, a.username AS sender_username, a.picture AS sender_picture
            FROM chatroom_messages m
            JOIN auth a ON a.id = m.user_id
            WHERE m.chatroom_id = %s
            ORDER BY m.created_at ASC, m.id ASC
        """, [room_id])
        rows = cur.fetchall()

        # Update last_activity for current user
        cur.execute("UPDATE chatroom_members SET last_activity = NOW() WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])

    now = timezone.now()
    messages = []
    for r in rows:
        mid = r[0]
        sender_id = r[2]
        created_at_dt = r[6]
        time_str = created_at_dt.strftime('%I:%M %p').lstrip('0') if created_at_dt else ''
        sender_pic = _full_avatar_url(r[11])

        messages.append({
            'id': mid,
            'chatroom_id': r[1],
            'user_id': sender_id,
            'message': r[3] or '',
            'media_data': r[4] or '',
            'image_path': r[5] or '',
            'created_at': created_at_dt.isoformat() if created_at_dt else '',
            'time': time_str,
            'edited': bool(r[7]),
            'sender_name': r[9] or r[10] or 'User',
            'sender_username': r[10] or '',
            'sender_picture': sender_pic,
            'is_me': (sender_id == user_id),
        })

    return JsonResponse({'success': True, 'messages': messages, 'current_user_id': user_id})


@login_required
@require_POST
def api_chatroom_send(request, room_id):
    """
    POST /api/chatrooms/<room_id>/messages/send/
    Verifies membership, inserts message into chatroom_messages, updates last_activity,
    pushes to Firebase RTDB chatrooms/{id}/messages/{msg_id}.
    """
    user_id = request.user.id
    message_text = (request.POST.get('message') or '').strip()

    if not message_text:
        return JsonResponse({'success': False, 'error': 'Message content cannot be empty'}, status=400)

    if len(message_text) > 4000:
        return JsonResponse({'success': False, 'error': 'Message too long (max 4000 chars)'}, status=400)

    with connection.cursor() as cur:
        # Verify membership
        cur.execute("SELECT id FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Not a member of this room'}, status=403)

        cur.execute("""
            INSERT INTO chatroom_messages (
                chatroom_id, user_id, message, created_at, edited
            )
            VALUES (%s, %s, %s, NOW(), 0)
        """, [room_id, user_id, message_text])
        msg_id = cur.lastrowid

        # Update last_activity
        cur.execute("UPDATE chatroom_members SET last_activity = NOW() WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])

    now_dt = timezone.now()
    sender_name = getattr(request.user, 'name', '') or request.user.username or 'User'
    sender_pic = _full_avatar_url(getattr(request.user, 'picture', None))
    time_str = now_dt.strftime('%I:%M %p').lstrip('0')

    # Push to Firebase RTDB
    fb_payload = {
        'id': str(msg_id),
        'sender_id': user_id,
        'sender_name': sender_name,
        'message': message_text,
        'type': 'user',
        'timestamp': int(now_dt.timestamp()),
    }
    _push_chatroom_message_firebase(room_id, fb_payload)

    return JsonResponse({
        'success': True,
        'message': {
            'id': msg_id,
            'chatroom_id': room_id,
            'user_id': user_id,
            'message': message_text,
            'created_at': now_dt.isoformat(),
            'time': time_str,
            'edited': False,
            'sender_name': sender_name,
            'sender_username': request.user.username or '',
            'sender_picture': sender_pic,
            'is_me': True,
        }
    })


@login_required
def api_chatroom_members(request, room_id):
    """
    GET /api/chatrooms/<room_id>/members/
    Returns member list with admin flag and online status (last_activity < 60s).
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("SELECT id FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Not a member of this room'}, status=403)

        cur.execute("""
            SELECT cm.user_id, cm.is_admin, cm.joined_at, cm.last_activity,
                   a.name, a.username, a.picture, a.last_seen,
                   c.creator_id
            FROM chatroom_members cm
            JOIN auth a ON a.id = cm.user_id
            JOIN chatrooms c ON c.id = cm.chatroom_id
            WHERE cm.chatroom_id = %s
            ORDER BY cm.is_admin DESC, cm.joined_at ASC
        """, [room_id])
        rows = cur.fetchall()

    now = timezone.now()
    members = []
    for r in rows:
        uid = r[0]
        last_act = r[3]
        is_online = False
        if last_act:
            if timezone.is_naive(last_act):
                la_aware = timezone.make_aware(last_act)
            else:
                la_aware = last_act
            is_online = (now - la_aware).total_seconds() < 60
        if not is_online and r[7]:
            ls = r[7]
            if timezone.is_naive(ls):
                ls_aware = timezone.make_aware(ls)
            else:
                ls_aware = ls
            is_online = (now - ls_aware).total_seconds() < 120

        is_creator = (uid == r[8])
        is_admin = bool(r[1]) or is_creator

        members.append({
            'user_id': uid,
            'name': r[4] or r[5] or 'User',
            'username': r[5] or '',
            'picture': _full_avatar_url(r[6]),
            'is_admin': is_admin,
            'is_creator': is_creator,
            'is_online': is_online,
            'is_me': (uid == user_id),
        })

    return JsonResponse({'success': True, 'members': members})


@login_required
@require_POST
def api_chatroom_kick(request, room_id, uid):
    """
    POST /api/chatrooms/<room_id>/members/<uid>/remove/
    Kicks member from room. Only admin/creator can kick, cannot kick room creator.
    """
    current_uid = request.user.id
    target_uid = int(uid)

    with connection.cursor() as cur:
        # Check room creator
        cur.execute("SELECT creator_id FROM chatrooms WHERE id = %s AND (is_deleted = 0 OR is_deleted IS NULL)", [room_id])
        room = cur.fetchone()
        if not room:
            return JsonResponse({'success': False, 'error': 'Chat room not found'}, status=404)
        creator_id = room[0]

        # Check current user is admin
        cur.execute("SELECT is_admin FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, current_uid])
        actor_member = cur.fetchone()
        is_actor_admin = (actor_member and bool(actor_member[0])) or (current_uid == creator_id)
        if not is_actor_admin:
            return JsonResponse({'success': False, 'error': 'Only room admins can remove members'}, status=403)

        if target_uid == creator_id:
            return JsonResponse({'success': False, 'error': 'Cannot remove the room creator'}, status=403)

        cur.execute("DELETE FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, target_uid])
        affected = cur.rowcount

    return JsonResponse({'success': True, 'kicked_user_id': target_uid, 'affected': affected})


@login_required
@require_POST
def api_chatroom_edit_msg(request, room_id, mid):
    """
    POST /api/chatrooms/<room_id>/messages/<mid>/edit/
    Author only. Updates chatroom_messages with edited=1, patches Firebase.
    """
    user_id = request.user.id
    message_id = int(mid)
    new_message = (request.POST.get('message') or '').strip()

    if not new_message:
        return JsonResponse({'success': False, 'error': 'Message content cannot be empty'}, status=400)

    with connection.cursor() as cur:
        cur.execute("SELECT user_id FROM chatroom_messages WHERE id = %s AND chatroom_id = %s", [message_id, room_id])
        msg = cur.fetchone()
        if not msg:
            return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)

        if msg[0] != user_id:
            return JsonResponse({'success': False, 'error': 'Only the author can edit this message'}, status=403)

        cur.execute("""
            UPDATE chatroom_messages
            SET message = %s, edited = 1, edited_at = NOW()
            WHERE id = %s AND chatroom_id = %s
        """, [new_message, message_id, room_id])

    # Patch Firebase
    base_url = os.environ.get('FIREBASE_CHATROOM_DB_URL', 'https://xapyx-chatroom-chat-default-rtdb.firebaseio.com').rstrip('/')
    fb_url = f"{base_url}/chatrooms/{room_id}/messages/{message_id}.json"
    try:
        import requests
        requests.patch(fb_url, json={'message': new_message, 'edited': True}, timeout=3)
    except Exception as e:
        logger.warning(f"Firebase chatroom edit error: {e}")

    return JsonResponse({'success': True, 'message_id': message_id, 'new_message': new_message})


@login_required
@require_POST
def api_chatroom_delete_msg(request, room_id, mid):
    """
    POST /api/chatrooms/<room_id>/messages/<mid>/delete/
    Author or admin can delete message. Deletes from DB and Firebase.
    """
    user_id = request.user.id
    message_id = int(mid)

    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM chatrooms WHERE id = %s", [room_id])
        c_row = cur.fetchone()
        creator_id = c_row[0] if c_row else 0

        cur.execute("SELECT is_admin FROM chatroom_members WHERE chatroom_id = %s AND user_id = %s", [room_id, user_id])
        cm_row = cur.fetchone()
        is_admin = (cm_row and bool(cm_row[0])) or (user_id == creator_id)

        cur.execute("SELECT user_id FROM chatroom_messages WHERE id = %s AND chatroom_id = %s", [message_id, room_id])
        msg = cur.fetchone()
        if not msg:
            return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)

        author_id = msg[0]
        if author_id != user_id and not is_admin:
            return JsonResponse({'success': False, 'error': 'Only the author or an admin can delete this message'}, status=403)

        cur.execute("DELETE FROM chatroom_messages WHERE id = %s AND chatroom_id = %s", [message_id, room_id])

    # Delete from Firebase
    base_url = os.environ.get('FIREBASE_CHATROOM_DB_URL', 'https://xapyx-chatroom-chat-default-rtdb.firebaseio.com').rstrip('/')
    fb_url = f"{base_url}/chatrooms/{room_id}/messages/{message_id}.json"
    try:
        import requests
        requests.delete(fb_url, timeout=3)
    except Exception as e:
        logger.warning(f"Firebase chatroom delete error: {e}")

    return JsonResponse({'success': True, 'message_id': message_id})


@login_required
@require_POST
def api_chatroom_report(request, room_id, mid):
    """
    POST /api/chatrooms/<room_id>/messages/<mid>/report/
    Body: reason
    Inserts into chatroom_reports.
    """
    user_id = request.user.id
    message_id = int(mid)
    reason = (request.POST.get('reason') or 'Inappropriate content').strip()

    with connection.cursor() as cur:
        cur.execute("SELECT id FROM chatroom_messages WHERE id = %s AND chatroom_id = %s", [message_id, room_id])
        if not cur.fetchone():
            return JsonResponse({'success': False, 'error': 'Message not found'}, status=404)

        cur.execute("""
            INSERT INTO chatroom_reports (
                message_id, reporter_id, reason, room_id, status, created_at
            )
            VALUES (%s, %s, %s, %s, 'pending', NOW())
        """, [message_id, user_id, reason, room_id])
        report_id = cur.lastrowid

    return JsonResponse({'success': True, 'report_id': report_id})


@login_required
@require_POST
def api_chatroom_clear(request, room_id):
    """
    POST /api/chatrooms/<room_id>/clear/
    Creator only. Deletes all messages in the chat room.
    """
    user_id = request.user.id
    with connection.cursor() as cur:
        cur.execute("SELECT creator_id FROM chatrooms WHERE id = %s AND (is_deleted = 0 OR is_deleted IS NULL)", [room_id])
        room = cur.fetchone()
        if not room:
            return JsonResponse({'success': False, 'error': 'Room not found'}, status=404)

        if room[0] != user_id:
            return JsonResponse({'success': False, 'error': 'Only the room creator can clear message history'}, status=403)

        cur.execute("DELETE FROM chatroom_messages WHERE chatroom_id = %s", [room_id])
        deleted_count = cur.rowcount

    # Clear Firebase
    base_url = os.environ.get('FIREBASE_CHATROOM_DB_URL', 'https://xapyx-chatroom-chat-default-rtdb.firebaseio.com').rstrip('/')
    fb_url = f"{base_url}/chatrooms/{room_id}/messages.json"
    try:
        import requests
        requests.delete(fb_url, timeout=3)
    except Exception as e:
        logger.warning(f"Firebase chatroom clear error: {e}")

    return JsonResponse({'success': True, 'deleted_count': deleted_count})


# ============================================================
# CHAT ROULETTE (Task 19 Phase 1)
# ============================================================
from .redis_roulette import (
    join_queue, leave_queue, try_match, get_user_state,
    get_partner, send_message as roulette_send_message,
    fetch_messages as roulette_fetch_messages, leave_session,
    heartbeat as roulette_heartbeat, get_active_counts, next_partner,
    check_rate_limit, is_session_expired, end_expired_session, set_cooldown
)
from .models import RouletteReport


def _roulette_partner_info(user_id):
    """Helper to return sanitized partner dictionary."""
    try:
        partner = Auth.objects.filter(id=user_id).values('id', 'name', 'username', 'picture').first()
        if not partner:
            return {
                'id': int(user_id),
                'name': 'Anonymous User',
                'username': 'anonymous',
                'picture': '/static/images/avatars/default.png',
            }

        pic = partner.get('picture') or ''
        if not pic:
            pic_url = '/static/images/avatars/default.png'
        elif pic.startswith('http://') or pic.startswith('https://') or pic.startswith('/'):
            pic_url = pic
        else:
            pic_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'

        return {
            'id': partner['id'],
            'name': partner.get('name') or partner.get('username') or 'Anonymous User',
            'username': partner.get('username') or 'anonymous',
            'picture': pic_url,
        }
    except Exception:
        return {
            'id': int(user_id),
            'name': 'Anonymous User',
            'username': 'anonymous',
            'picture': '/static/images/avatars/default.png',
        }


@login_required
def roulette_view(request):
    """GET /roulette/ -- Chat Roulette main page."""
    return render(request, 'dashboard/roulette.html', {
        'active_page': 'roulette',
        'svg_logo': _load_svg_logo(),
    })


@login_required
def api_roulette_active(request):
    """GET /api/roulette/active/ -- Returns active counts (waiting, chatting, total)."""
    counts = get_active_counts()
    return JsonResponse({'success': True, 'counts': counts})


@login_required
def api_roulette_join(request):
    """POST /api/roulette/join/ -- Join waiting queue and attempt atomic matching."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    user_id = request.user.id
    join_queue(user_id)
    partner_id, session_id = try_match(user_id)

    if partner_id:
        partner_info = _roulette_partner_info(partner_id)
        return JsonResponse({
            'status': 'matched',
            'session_id': session_id,
            'partner': partner_info,
        })
    else:
        return JsonResponse({
            'status': 'waiting',
        })


@login_required
def api_roulette_poll(request):
    """
    GET /api/roulette/poll/ -- Poll for match status, messages, and partner presence.
    Query params: since_id (default 0).
    """
    user_id = request.user.id
    roulette_heartbeat(user_id)
    user_state = get_user_state(user_id)

    if not user_state:
        return JsonResponse({'status': 'idle'})

    current_status = user_state.get('status')

    if current_status == 'waiting':
        partner_id, session_id = try_match(user_id)
        if partner_id:
            partner_info = _roulette_partner_info(partner_id)
            return JsonResponse({
                'status': 'matched',
                'session_id': session_id,
                'partner': partner_info,
                'messages': [],
                'since_id': 0,
            })
        return JsonResponse({'status': 'waiting'})

    elif current_status == 'matched':
        partner_id = user_state.get('partner_id')
        session_id = user_state.get('session_id')

        # Check 30 min duration cap
        if is_session_expired(session_id):
            end_expired_session(session_id)
            try:
                since_id = int(request.GET.get('since_id', 0))
            except (ValueError, TypeError):
                since_id = 0
            messages, next_since_id = roulette_fetch_messages(session_id, since_id)
            return JsonResponse({
                'status': 'left',
                'session_id': session_id,
                'messages': messages,
                'error': 'Session ended (30 min limit)'
            })

        partner_state = get_user_state(partner_id) if partner_id else None
        if not partner_state or partner_state.get('session_id') != session_id or partner_state.get('status') == 'left':
            leave_session(user_id)
            return JsonResponse({'status': 'left'})

        try:
            since_id = int(request.GET.get('since_id', 0))
        except (ValueError, TypeError):
            since_id = 0

        messages, next_since_id = roulette_fetch_messages(session_id, since_id)
        partner_info = _roulette_partner_info(partner_id)

        return JsonResponse({
            'status': 'matched',
            'session_id': session_id,
            'partner': partner_info,
            'messages': messages,
            'since_id': next_since_id,
        })

    elif current_status == 'left':
        session_id = user_state.get('session_id')
        messages = []
        if session_id:
            try:
                since_id = int(request.GET.get('since_id', 0))
            except (ValueError, TypeError):
                since_id = 0
            messages, _ = roulette_fetch_messages(session_id, since_id)
        leave_session(user_id)
        return JsonResponse({'status': 'left', 'messages': messages})

    return JsonResponse({'status': 'idle'})


@login_required
def api_roulette_send(request):
    """POST /api/roulette/send/ -- Send message in active roulette session."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    user_id = request.user.id
    partner_id, session_id = get_partner(user_id)
    if not partner_id or not session_id:
        return JsonResponse({'error': 'Not in an active chat'}, status=400)

    text = request.POST.get('text', '').strip()
    if not text:
        return JsonResponse({'error': 'Message cannot be empty'}, status=400)

    if len(text) > 1000:
        text = text[:1000]

    # Rate limit check (max 10 msgs per 10s)
    if not check_rate_limit(user_id):
        return JsonResponse({'success': False, 'error': 'Slow down'}, status=429)

    # 30 min session cap check
    if is_session_expired(session_id):
        end_expired_session(session_id)
        return JsonResponse({'success': False, 'error': 'Session ended (30 min limit)'}, status=400)

    msg = roulette_send_message(user_id, partner_id, text)
    if not msg:
        return JsonResponse({'error': 'Failed to send message'}, status=400)

    return JsonResponse({'success': True, 'message': msg})


@login_required
def api_roulette_leave(request):
    """POST /api/roulette/leave/ -- Leave current queue or active session."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    user_id = request.user.id
    leave_session(user_id)
    leave_queue(user_id)
    return JsonResponse({'success': True})

@login_required
def api_roulette_next(request):
    """POST /api/roulette/next/ -- Leave current partner cleanly and instantly re-queue."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    user_id = request.user.id
    partner_id, session_id = next_partner(user_id)

    if partner_id:
        partner_info = _roulette_partner_info(partner_id)
        return JsonResponse({
            'status': 'matched',
            'session_id': session_id,
            'partner': partner_info,
        })
    else:
        return JsonResponse({
            'status': 'waiting',
        })


@login_required
def api_roulette_heartbeat(request):
    """POST/GET /api/roulette/heartbeat/ -- Refresh presence TTL and detect partner expiry."""
    user_id = request.user.id
    roulette_heartbeat(user_id)
    user_state = get_user_state(user_id)

    if not user_state:
        return JsonResponse({'status': 'idle'})

    current_status = user_state.get('status')
    if current_status == 'matched':
        partner_id = user_state.get('partner_id')
        session_id = user_state.get('session_id')
        partner_state = get_user_state(partner_id) if partner_id else None

        if not partner_state or partner_state.get('session_id') != session_id or partner_state.get('status') == 'left':
            leave_session(user_id)
            return JsonResponse({'status': 'left', 'partner_expired': True})

    return JsonResponse({'status': current_status, 'success': True})

@login_required
def api_roulette_report(request):
    """POST /api/roulette/report/ -- Report partner and disconnect."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    user_id = request.user.id
    partner_id, session_id = get_partner(user_id)

    reported_id = request.POST.get('partner_id')
    if not reported_id and partner_id:
        reported_id = partner_id

    if not reported_id:
        return JsonResponse({'error': 'No partner to report'}, status=400)

    try:
        reported_id = int(reported_id)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid partner ID'}, status=400)

    reason = request.POST.get('reason', '').strip()
    valid_reasons = [
        'Harassment / abuse',
        'Spam / advertising',
        'Sexual content',
        'Underage user',
        'Other'
    ]
    if reason not in valid_reasons:
        return JsonResponse({'error': 'Invalid report reason'}, status=400)

    details = request.POST.get('details', '').strip()
    if reason == 'Other' and not details:
        return JsonResponse({'error': "Details are required when selecting 'Other'"}, status=400)

    report = RouletteReport.objects.create(
        reporter_id=user_id,
        reported_id=reported_id,
        reason=reason,
        details=details if details else None,
        status='pending'
    )

    # Set cooldown and immediately un-match
    set_cooldown(user_id, reported_id)
    leave_session(user_id)
    leave_queue(user_id)

    return JsonResponse({'success': True, 'report_id': report.id})


# ============================================================
# GAMES HUB & CORE APIS (Task 22 Phase 1)
# ============================================================

from django.db import models
from .models import Game, GameScore


def _get_game_by_type(game_type):
    gt = str(game_type or '').strip().lower()
    if gt in ('spaceshooter', 'space_shooter', 'space'):
        return Game.objects.filter(title__iexact='Space Shooter').first()
    elif gt in ('lovemeter', 'love_meter', 'love'):
        return Game.objects.filter(title__iexact='Love Meter').first()
    elif gt in ('tictactoe', 'ttt'):
        return Game.objects.filter(models.Q(game_type='tictactoe') | models.Q(title__iexact='Tictactoe')).first()
    elif gt in ('checkers', 'checker'):
        return Game.objects.filter(models.Q(game_type='checkers') | models.Q(title__iexact='Checkers')).first()
    elif gt in ('catchme', 'catchmeifyoucan', 'catch_me'):
        return Game.objects.filter(title__icontains='Catch Me').first()
    return None


@login_required
def games_view(request):
    """Renders the main Games Hub page."""
    games_config = [
        {
            'id': 'spaceshooter',
            'title': 'Space Shooter',
            'badge': 'Arcade',
            'badge_class': 'arcade',
            'icon': 'bi-rocket-takeoff-fill',
            'gradient': 'linear-gradient(135deg, #1e3c72, #2a5298)',
            'description': 'Shoot down enemy ships, dodge attacks, and survive as long as possible! Addictive arcade action with increasing difficulty.',
            'url': '/games/spaceshooter/',
            'plays_count': Game.objects.filter(title__iexact='Space Shooter').aggregate(t=models.Sum('plays_count'))['t'] or 0
        },
        {
            'id': 'lovemeter',
            'title': 'Love Meter',
            'badge': 'Social',
            'badge_class': 'social',
            'icon': 'bi-heart-fill',
            'gradient': 'linear-gradient(135deg, #ff416c, #ff4b2b)',
            'description': 'Calculate your love compatibility! Enter two names and see your love percentage with beautiful animations.',
            'url': '/games/lovemeter/',
            'plays_count': Game.objects.filter(title__iexact='Love Meter').aggregate(t=models.Sum('plays_count'))['t'] or 0
        },
        {
            'id': 'tictactoe',
            'title': 'Online Tic Tac Toe',
            'badge': 'Live · Multiplayer',
            'badge_class': 'multiplayer',
            'icon': 'bi-grid-3x3',
            'gradient': 'linear-gradient(135deg, #8e2de2, #4a00e0)',
            'description': 'Play against friends in real-time! Create a game room, share the link or invite friends to challenge anyone instantly.',
            'url': '/games/tictactoe/',
            'plays_count': Game.objects.filter(models.Q(game_type='tictactoe') | models.Q(title__iexact='Tictactoe')).aggregate(t=models.Sum('plays_count'))['t'] or 0
        },
        {
            'id': 'catchme',
            'title': 'Catch Me If You Can',
            'badge': 'Reflex',
            'badge_class': 'reflex',
            'icon': 'bi-stopwatch',
            'gradient': 'linear-gradient(135deg, #f7971e, #ffd200)',
            'description': 'Test your reflexes! Stop the timer exactly at the random target time. Perfect your timing!',
            'url': '/games/catchme/',
            'plays_count': Game.objects.filter(title__icontains='Catch Me').aggregate(t=models.Sum('plays_count'))['t'] or 0
        }
    ]

    total_plays = sum(g['plays_count'] for g in games_config)
    recent_scores = GameScore.objects.filter(user=request.user).select_related('game').order_by('-created_at')[:5]

    context = {
        'active_page': 'games',
        'games': games_config,
        'total_plays': total_plays,
        'recent_scores': recent_scores,
    }
    context.update(_get_games_right_widgets_context(request))
    return render(request, 'dashboard/games.html', context)

def _get_games_right_widgets_context(request):
    """Calculates shared right widgets data for Games Hub and game pages (Task 22)."""
    user = request.user
    user_games_played = GameScore.objects.filter(user=user).count() if user.is_authenticated else 0
    user_best_score = GameScore.objects.filter(user=user).aggregate(m=models.Max('score'))['m'] or 0 if user.is_authenticated else 0
    if user_best_score > 0:
        higher_scorers = GameScore.objects.values('user').annotate(
            m=models.Max('score')
        ).filter(m__gt=user_best_score).count()
        rank_display = f"#{higher_scorers + 1}"
    elif user_games_played > 0:
        higher_scorers = GameScore.objects.values('user').annotate(
            m=models.Max('score')
        ).filter(m__gt=0).count()
        rank_display = f"#{higher_scorers + 1}"
    else:
        rank_display = "-"

    your_stats = {
        'games_played': user_games_played,
        'best_score': user_best_score,
        'rank': rank_display,
        'rank_display': rank_display
    }

    top_scores = GameScore.objects.select_related('user', 'game').order_by('-score', '-created_at')
    seen_users = set()
    top_players = []
    for s in top_scores:
        if s.user_id not in seen_users:
            seen_users.add(s.user_id)
            u = s.user
            pic = _media_url(u.picture) if u.picture else '/static/images/avatars/default.png'
            top_players.append({
                'user_id': u.id,
                'username': u.username,
                'name': u.name or u.username,
                'picture': pic,
                'score': s.score,
                'game_title': s.game.title,
                'rank': len(top_players) + 1
            })
            if len(top_players) >= 5:
                break

    friend_ids = []
    if user.is_authenticated:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT CASE WHEN sender_id = %s THEN receiver_id ELSE sender_id END
                FROM friends
                WHERE (sender_id = %s OR receiver_id = %s)
                  AND status = 'accepted'
            """, [user.id, user.id, user.id])
            friend_ids = [row[0] for row in cur.fetchall()]

    recent_friend_activity = []
    if friend_ids:
        qs = GameScore.objects.filter(user_id__in=friend_ids).select_related('user', 'game').order_by('-created_at')[:5]
        for s in qs:
            u = s.user
            pic = _media_url(u.picture) if u.picture else '/static/images/avatars/default.png'
            recent_friend_activity.append({
                'username': u.username,
                'name': u.name or u.username,
                'picture': pic,
                'game_title': s.game.title,
                'score': s.score,
                'winner': s.winner or '',
                'created_at': s.created_at
            })

    if not recent_friend_activity:
        platform_qs = GameScore.objects.exclude(user=user).select_related('user', 'game').order_by('-created_at')[:5] if user.is_authenticated else GameScore.objects.none()
        if not platform_qs.exists():
            platform_qs = GameScore.objects.select_related('user', 'game').order_by('-created_at')[:5]
        for s in platform_qs:
            u = s.user
            pic = _media_url(u.picture) if u.picture else '/static/images/avatars/default.png'
            recent_friend_activity.append({
                'username': u.username,
                'name': u.name or u.username,
                'picture': pic,
                'game_title': s.game.title,
                'score': s.score,
                'winner': s.winner or '',
                'created_at': s.created_at
            })

    return {
        'your_stats': your_stats,
        'top_players': top_players,
        'recent_friend_activity': recent_friend_activity,
    }


@login_required
def space_view(request):
    """Renders Space Shooter 2D canvas game (Task 22 Phase 2)."""
    ctx = {
        'active_page': 'games',
        'game_title': 'Space Shooter',
    }
    ctx.update(_get_games_right_widgets_context(request))
    return render(request, 'dashboard/games/spaceshooter.html', ctx)


@login_required
def love_view(request):
    """Renders Love Meter compatibility calculator (Task 22 Phase 2)."""
    ctx = {
        'active_page': 'games',
        'game_title': 'Love Meter',
    }
    ctx.update(_get_games_right_widgets_context(request))
    return render(request, 'dashboard/games/lovemeter.html', ctx)


@login_required
def catch_view(request):
    """Renders Catch Me If You Can reflex stopwatch game (Task 22 Phase 2)."""
    ctx = {
        'active_page': 'games',
        'game_title': 'Catch Me If You Can',
    }
    ctx.update(_get_games_right_widgets_context(request))
    return render(request, 'dashboard/games/catchme.html', ctx)


@login_required
def api_games_hub(request):
    """API: Returns game directory, play counts, total platform plays, and recent user scores."""
    games_config = [
        {
            'id': 'spaceshooter',
            'title': 'Space Shooter',
            'badge': 'Arcade',
            'badge_class': 'arcade',
            'icon': 'bi-rocket-takeoff-fill',
            'gradient': 'linear-gradient(135deg, #1e3c72, #2a5298)',
            'description': 'Shoot down enemy ships, dodge attacks, and survive as long as possible! Addictive arcade action with increasing difficulty.',
            'url': '/games/spaceshooter/',
            'plays_count': Game.objects.filter(title__iexact='Space Shooter').aggregate(t=models.Sum('plays_count'))['t'] or 0
        },
        {
            'id': 'lovemeter',
            'title': 'Love Meter',
            'badge': 'Social',
            'badge_class': 'social',
            'icon': 'bi-heart-fill',
            'gradient': 'linear-gradient(135deg, #ff416c, #ff4b2b)',
            'description': 'Calculate your love compatibility! Enter two names and see your love percentage with beautiful animations.',
            'url': '/games/lovemeter/',
            'plays_count': Game.objects.filter(title__iexact='Love Meter').aggregate(t=models.Sum('plays_count'))['t'] or 0
        },
        {
            'id': 'tictactoe',
            'title': 'Online Tic Tac Toe',
            'badge': 'Live · Multiplayer',
            'badge_class': 'multiplayer',
            'icon': 'bi-grid-3x3',
            'gradient': 'linear-gradient(135deg, #8e2de2, #4a00e0)',
            'description': 'Play against friends in real-time! Create a game room, share the link or invite friends to challenge anyone instantly.',
            'url': '/games/tictactoe/',
            'plays_count': Game.objects.filter(models.Q(game_type='tictactoe') | models.Q(title__iexact='Tictactoe')).aggregate(t=models.Sum('plays_count'))['t'] or 0
        },
        {
            'id': 'catchme',
            'title': 'Catch Me If You Can',
            'badge': 'Reflex',
            'badge_class': 'reflex',
            'icon': 'bi-stopwatch',
            'gradient': 'linear-gradient(135deg, #f7971e, #ffd200)',
            'description': 'Test your reflexes! Stop the timer exactly at the random target time. Perfect your timing!',
            'url': '/games/catchme/',
            'plays_count': Game.objects.filter(title__icontains='Catch Me').aggregate(t=models.Sum('plays_count'))['t'] or 0
        }
    ]

    total_plays = sum(g['plays_count'] for g in games_config)
    recent_scores_qs = GameScore.objects.filter(user=request.user).select_related('game').order_by('-created_at')[:6]
    recent_scores = []
    for s in recent_scores_qs:
        recent_scores.append({
            'game_title': s.game.title,
            'score': s.score,
            'winner': s.winner or '',
            'created_at': s.created_at.strftime('%b %d, %H:%M') if s.created_at else ''
        })

    return JsonResponse({
        'success': True,
        'games': games_config,
        'total_plays': total_plays,
        'recent_scores': recent_scores
    })


@login_required
def api_games_leaderboard(request):
    """API: Returns top 10 scores for a given game_type."""
    game_type = request.GET.get('game_type', 'spaceshooter').strip().lower()
    try:
        limit = min(max(int(request.GET.get('limit', 10)), 1), 50)
    except (ValueError, TypeError):
        limit = 10

    if game_type in ('spaceshooter', 'space_shooter', 'space'):
        q_filter = models.Q(game__title__iexact='Space Shooter') | models.Q(game__game_type='spaceshooter')
    elif game_type in ('lovemeter', 'love_meter', 'love'):
        q_filter = models.Q(game__title__iexact='Love Meter') | models.Q(game__game_type='lovemeter')
    elif game_type in ('tictactoe', 'ttt'):
        q_filter = models.Q(game__game_type='tictactoe') | models.Q(game__title__iexact='Tictactoe')
    elif game_type in ('checkers', 'checker'):
        q_filter = models.Q(game__game_type='checkers') | models.Q(game__title__iexact='Checkers')
    elif game_type in ('catchme', 'catchmeifyoucan', 'catch_me', 'catch'):
        q_filter = models.Q(game__title__icontains='Catch Me') | models.Q(game__game_type='catchme')
    else:
        q_filter = models.Q(game__game_type=game_type) | models.Q(game__title__icontains=game_type)

    scores = GameScore.objects.filter(q_filter).select_related('user', 'game').order_by('-score', '-created_at')[:limit]

    leaderboard = []
    for rank, s in enumerate(scores, 1):
        u = s.user
        pic = _media_url(u.picture) if u.picture else '/static/images/avatars/default.png'
        leaderboard.append({
            'rank': rank,
            'name': u.name or u.username,
            'username': u.username,
            'picture': pic,
            'score': s.score,
            'winner': s.winner or '',
            'created_at': s.created_at.strftime('%b %d, %Y') if s.created_at else ''
        })

    return JsonResponse({
        'success': True,
        'game_type': game_type,
        'leaderboard': leaderboard
    })


@csrf_exempt
@login_required
@require_POST
def api_games_track_play(request):
    """API: Increments plays_count for a given game_type."""
    try:
        data = json.loads(request.body) if request.body else {}
    except Exception:
        data = request.POST.dict()

    game_type = str(data.get('game_type', '')).strip().lower()
    game = _get_game_by_type(game_type)
    if not game:
        return JsonResponse({'success': False, 'error': f'Game type "{game_type}" not found'}, status=404)

    Game.objects.filter(id=game.id).update(plays_count=models.F('plays_count') + 1)

    # Get aggregated total for response
    if game_type in ('spaceshooter', 'space_shooter', 'space'):
        tot = Game.objects.filter(title__iexact='Space Shooter').aggregate(t=models.Sum('plays_count'))['t'] or 0
    elif game_type in ('lovemeter', 'love_meter', 'love'):
        tot = Game.objects.filter(title__iexact='Love Meter').aggregate(t=models.Sum('plays_count'))['t'] or 0
    elif game_type in ('tictactoe', 'ttt'):
        tot = Game.objects.filter(models.Q(game_type='tictactoe') | models.Q(title__iexact='Tictactoe')).aggregate(t=models.Sum('plays_count'))['t'] or 0
    elif game_type in ('catchme', 'catchmeifyoucan', 'catch_me', 'catch'):
        tot = Game.objects.filter(title__icontains='Catch Me').aggregate(t=models.Sum('plays_count'))['t'] or 0
    else:
        game.refresh_from_db()
        tot = game.plays_count

    return JsonResponse({'success': True, 'game_type': game_type, 'plays_count': tot})


@csrf_exempt
@login_required
@require_POST
def api_games_save_score(request):
    """API: Saves a game score with server-side bounds validation."""
    try:
        data = json.loads(request.body) if request.body else {}
    except Exception:
        data = request.POST.dict()

    game_type = str(data.get('game_type', '')).strip().lower()
    game = _get_game_by_type(game_type)
    if not game:
        return JsonResponse({'success': False, 'error': f'Game type "{game_type}" not found'}, status=404)

    try:
        raw_score = int(data.get('score', 0))
    except (ValueError, TypeError):
        raw_score = 0

    # Bounds check: score must be between 0 and 10000
    score = max(0, min(raw_score, 10000))

    try:
        moves = max(0, int(data.get('moves', 0)))
    except (ValueError, TypeError):
        moves = 0

    try:
        duration = max(0, int(data.get('duration', 0)))
    except (ValueError, TypeError):
        duration = 0

    winner = data.get('winner')
    valid_winners = ['X', 'O', 'red', 'black', 'white', 'draw']
    if winner not in valid_winners:
        winner = None

    # Increment play count on target game
    Game.objects.filter(id=game.id).update(plays_count=models.F('plays_count') + 1)

    score_obj = GameScore.objects.create(
        game=game,
        user=request.user,
        score=score,
        winner=winner,
        moves=moves,
        duration=duration
    )

    return JsonResponse({
        'success': True,
        'score_id': score_obj.id,
        'message': 'Score saved successfully'
    })