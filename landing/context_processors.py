from .views import get_sidebar_unread_counts

def sidebar_badges(request):
    """
    Context processor providing real-time unread counts for sidebar navigation badges.
    """
    if hasattr(request, 'user') and request.user.is_authenticated:
        counts = get_sidebar_unread_counts(request.user.id)
        return {'sidebar_counts': counts}
    return {
        'sidebar_counts': {
            'chat': 0,
            'groups': 0,
            'pages': 0,
            'chatrooms': 0,
            'shoutbox': 0,
            'friends': 0,
            'total_notifications': 0,
        }
    }


def google_auth_context(request):
    """
    Injects GOOGLE_CLIENT_ID and GOOGLE_CALLBACK_URL into all template contexts.
    """
    from django.conf import settings
    scheme = 'https' if request.is_secure() or request.META.get('HTTP_X_FORWARDED_PROTO') == 'https' else request.scheme
    host = request.get_host()
    callback_url = f"{scheme}://{host}/auth/google/callback/"
    return {
        'GOOGLE_CLIENT_ID': getattr(settings, 'GOOGLE_CLIENT_ID', ''),
        'GOOGLE_CALLBACK_URL': callback_url,
    }
