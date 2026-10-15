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
