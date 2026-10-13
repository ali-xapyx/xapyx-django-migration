import os
import logging

log = logging.getLogger(__name__)

_initialized = False
_ok = False
_db_module = None
_app = None


def _init():
    global _initialized, _ok, _db_module, _app
    if _initialized:
        return _ok

    _initialized = True

    try:
        import firebase_admin
        from firebase_admin import credentials, db as fb_db
    except ImportError:
        log.error('firebase_push: firebase-admin not installed')
        return False

    cred_path = os.environ.get('FIREBASE_CREDENTIALS_PATH', '')
    db_url = os.environ.get('FIREBASE_DB_URL', '')

    if not cred_path or not os.path.exists(cred_path):
        log.error(f'firebase_push: credentials file not found: {cred_path}')
        return False
    if not db_url:
        log.error('firebase_push: FIREBASE_DB_URL not set')
        return False

    try:
        cred = credentials.Certificate(cred_path)
        # Reuse app if already created (avoid duplicate-app error on reload)
        try:
            _app = firebase_admin.get_app('xapyx-notifications')
        except ValueError:
            _app = firebase_admin.initialize_app(
                cred,
                {'databaseURL': db_url},
                name='xapyx-notifications',
            )
        _db_module = fb_db
        _ok = True
        log.info('firebase_push: initialized')
    except Exception as e:
        log.error(f'firebase_push: init failed: {e}')
        _ok = False

    return _ok


def _refresh_unread(user_id):
    """Recompute unread from MySQL and write unread_counts/{uid}."""
    from django.db import connection
    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM notifications "
                "WHERE user_id = %s AND is_read = 0 "
                "AND (expires_at IS NULL OR expires_at > NOW())",
                [user_id]
            )
            count = cur.fetchone()[0] or 0
        _db_module.reference(f'unread_counts/{user_id}', app=_app).set(count)
        return count
    except Exception as e:
        log.error(f'firebase_push: refresh_unread failed: {e}')
        return None


def push_notification(user_id, notification_id, data, overwrite=False):
    """
    Write a notification to notifications/{user_id}/{notification_id}
    and refresh the unread count.
    Idempotent: if key already exists, skip writing unless overwrite=True.
    """
    if not _init():
        return False
    try:
        node_ref = _db_module.reference(
            f'notifications/{user_id}/{notification_id}',
            app=_app,
        )
        if not overwrite and node_ref.get() is not None:
            log.info(f'firebase_push: notification {user_id}/{notification_id} already exists, skipping write')
            return True

        node_ref.set(data)
        _refresh_unread(user_id)
        return True
    except Exception as e:
        log.error(f'firebase_push: push_notification failed: {e}')
        return False


def mark_notification_read(user_id, notification_id):
    """
    Update is_read = 1 on notifications/{user_id}/{notification_id}
    and refresh unread count.
    """
    if not _init():
        return False
    try:
        node_ref = _db_module.reference(
            f'notifications/{user_id}/{notification_id}',
            app=_app,
        )
        node_ref.update({'is_read': 1})
        _refresh_unread(user_id)
        return True
    except Exception as e:
        log.error(f'firebase_push: mark_notification_read failed: {e}')
        return False


def mark_all_notifications_read(user_id):
    """
    Update is_read = 1 across all notifications/{user_id} nodes
    and set unread_counts/{user_id} = 0.
    """
    if not _init():
        return False
    try:
        user_ref = _db_module.reference(f'notifications/{user_id}', app=_app)
        user_notifs = user_ref.get()
        if user_notifs and isinstance(user_notifs, dict):
            updates = {}
            for nid in user_notifs.keys():
                updates[f'{nid}/is_read'] = 1
            user_ref.update(updates)
        set_unread_count(user_id, 0)
        return True
    except Exception as e:
        log.error(f'firebase_push: mark_all_notifications_read failed: {e}')
        return False


def delete_notification(user_id, notification_id):
    """Remove a notification from Firebase (used on delete)."""
    if not _init():
        return False
    try:
        _db_module.reference(
            f'notifications/{user_id}/{notification_id}',
            app=_app,
        ).delete()
        _refresh_unread(user_id)
        return True
    except Exception as e:
        log.error(f'firebase_push: delete_notification failed: {e}')
        return False


def set_unread_count(user_id, count):
    """Force a specific count (used on read-all)."""
    if not _init():
        return False
    try:
        _db_module.reference(f'unread_counts/{user_id}', app=_app).set(count)
        return True
    except Exception as e:
        log.error(f'firebase_push: set_unread_count failed: {e}')
        return False
