"""
Web Push Notification Service for XAPYX
Handles Web Push (VAPID) subscriptions, persistence via raw SQL cursor,
and push dispatch for new chat messages and support updates.
"""
import os
import json
import logging
from django.db import connection
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_VAPID_PUBLIC_KEY = os.environ.get(
    'VAPID_PUBLIC_KEY',
    'BAs0JGf-ILa3tApPSlQq6XA6tOdm20lPlWY3Yxe7dcSR7uXcSqrk0J_ELbfItmruTNW5qlTmgF2W48fMOYQWhkA'
)
DEFAULT_VAPID_PRIVATE_KEY_PATH = os.environ.get(
    'VAPID_PRIVATE_KEY_PATH',
    os.path.join(settings.BASE_DIR, 'vapid_private_key.pem')
)
DEFAULT_VAPID_ADMIN_EMAIL = os.environ.get(
    'VAPID_ADMIN_EMAIL',
    'mailto:admin@xapyx.com'
)


def get_vapid_public_key():
    """Return the VAPID URL-safe base64 public key."""
    return os.environ.get('VAPID_PUBLIC_KEY') or DEFAULT_VAPID_PUBLIC_KEY


def get_vapid_private_key():
    """Return the VAPID private key (path or PEM string)."""
    priv_path = os.environ.get('VAPID_PRIVATE_KEY_PATH') or DEFAULT_VAPID_PRIVATE_KEY_PATH
    if os.path.exists(priv_path):
        return priv_path
    priv_content = os.environ.get('VAPID_PRIVATE_KEY')
    if priv_content:
        return priv_content
    return priv_path


def save_push_subscription(user_id, subscription_data):
    """
    Save or update a Web Push subscription for a user using raw SQL.
    subscription_data is typically the JSON output of PushSubscription.toJSON().
    """
    if not user_id or not subscription_data:
        return False, "User ID and subscription data are required"

    endpoint = (subscription_data.get('endpoint') or '').strip()
    if not endpoint:
        return False, "Push subscription endpoint is missing"

    keys = subscription_data.get('keys') or {}
    auth_key = (keys.get('auth') or subscription_data.get('auth_key') or subscription_data.get('auth') or '').strip()
    p256dh_key = (keys.get('p256dh') or subscription_data.get('p256dh_key') or subscription_data.get('p256dh') or '').strip()

    if not auth_key or not p256dh_key:
        return False, "Subscription auth and p256dh encryption keys are required"

    try:
        with connection.cursor() as cur:
            cur.execute("""
                INSERT INTO push_subscriptions 
                    (user_id, endpoint, auth_key, p256dh_key, is_active, updated_at)
                VALUES (%s, %s, %s, %s, 1, NOW())
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id),
                    auth_key = VALUES(auth_key),
                    p256dh_key = VALUES(p256dh_key),
                    is_active = 1,
                    updated_at = NOW()
            """, [user_id, endpoint, auth_key, p256dh_key])
        return True, "Subscription saved successfully"
    except Exception as e:
        logger.error(f"Error saving push subscription for user {user_id}: {e}")
        return False, str(e)


def deactivate_push_subscription(user_id, endpoint):
    """Mark a Web Push subscription as inactive."""
    if not endpoint:
        return False
    try:
        with connection.cursor() as cur:
            cur.execute("""
                UPDATE push_subscriptions
                SET is_active = 0, updated_at = NOW()
                WHERE endpoint = %s AND user_id = %s
            """, [endpoint, user_id])
        return True
    except Exception as e:
        logger.error(f"Error deactivating push subscription: {e}")
        return False


def send_web_push(user_id, title, body, url='/feed/', tag='xapyx-notif', icon=None, badge=None):
    """
    Dispatch a Web Push notification to all active devices of a user.
    Executes in a safe try-catch so it never disrupts the main request flow.
    """
    if not user_id:
        return 0

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush is not installed. Skipping web push dispatch.")
        return 0

    priv_key = get_vapid_private_key()
    claims = {"sub": DEFAULT_VAPID_ADMIN_EMAIL}

    # Fetch active subscriptions for this user
    try:
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id, endpoint, auth_key, p256dh_key
                FROM push_subscriptions
                WHERE user_id = %s AND is_active = 1
            """, [user_id])
            subs = cur.fetchall()
    except Exception as e:
        logger.error(f"Failed to query push subscriptions for user {user_id}: {e}")
        return 0

    if not subs:
        return 0

    payload_data = {
        "title": title or "XAPYX Notification",
        "body": body or "",
        "icon": icon or "/static/images/icons/icon-192x192.png",
        "badge": badge or "/static/images/icons/icon-192x192.png",
        "tag": tag or "xapyx-notif",
        "data": {
            "url": url or "/feed/",
            "tag": tag or "xapyx-notif"
        }
    }
    payload_json = json.dumps(payload_data)

    successful_sends = 0
    expired_sub_ids = []

    for sub_id, endpoint, auth_key, p256dh_key in subs:
        if not endpoint or not auth_key or not p256dh_key:
            continue

        subscription_info = {
            "endpoint": endpoint,
            "keys": {
                "auth": auth_key,
                "p256dh": p256dh_key
            }
        }

        try:
            webpush(
                subscription_info=subscription_info,
                data=payload_json,
                vapid_private_key=priv_key,
                vapid_claims=claims,
                timeout=5
            )
            successful_sends += 1
        except WebPushException as ex:
            # HTTP 404 or 410 indicates subscription has expired or user unsubscribed
            status_code = getattr(ex.response, 'status_code', None) if getattr(ex, 'response', None) else None
            if status_code in (404, 410):
                expired_sub_ids.append(sub_id)
            else:
                logger.warning(f"WebPush send failed for sub {sub_id}: {ex}")
        except Exception as ex:
            logger.warning(f"Unexpected error sending web push to sub {sub_id}: {ex}")

    # Clean up expired subscriptions
    if expired_sub_ids:
        try:
            placeholders = ','.join(['%s'] * len(expired_sub_ids))
            with connection.cursor() as cur:
                cur.execute(f"""
                    UPDATE push_subscriptions
                    SET is_active = 0, updated_at = NOW()
                    WHERE id IN ({placeholders})
                """, expired_sub_ids)
        except Exception as e:
            logger.error(f"Failed to deactivate expired subscriptions: {e}")

    return successful_sends