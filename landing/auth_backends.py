# landing/auth_backends.py
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth.hashers import check_password as django_check_password
from django.db.models import Q
from .models import Auth
import bcrypt


def _normalize_php_bcrypt(hash_value):
    """
    PHP's password_hash() generates bcrypt hashes with the $2y$ prefix.
    Django's BCryptPasswordHasher is supposed to accept $2a$ and $2b$
    but not always reliably. We'll handle $2y$ hashes ourselves.
    """
    if hash_value and hash_value.startswith('$2y$'):
        return '$2b$' + hash_value[4:]
    return hash_value


def _verify_password(password, hash_value):
    """
    Verify a password against a hash, trying multiple approaches:
    1. bcrypt library directly (works for $2a$, $2b$, $2y$ hashes)
    2. Django's check_password (for hashes Django created itself)

    Returns True if any approach succeeds.
    """
    if not hash_value:
        return False

    # Approach 1: raw bcrypt for bcrypt-style hashes
    if hash_value.startswith(('$2a$', '$2b$', '$2y$')):
        try:
            normalized = _normalize_php_bcrypt(hash_value)
            if bcrypt.checkpw(password.encode('utf-8'), normalized.encode('utf-8')):
                return True
        except (ValueError, TypeError):
            # Not a valid bcrypt hash — fall through to Django's checker
            pass

    # Approach 2: Django's hasher (for pbkdf2, argon2, and other Django formats)
    try:
        if django_check_password(password, hash_value):
            return True
    except Exception:
        pass

    return False


class MultiFieldAuthBackend(BaseBackend):
    """
    Allows login with username, email, OR cell phone.
    Also handles PHP-style $2y$ bcrypt hashes transparently.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None

        try:
            user = Auth.objects.get(
                Q(username=username) | Q(email=username) | Q(cell=username)
            )
        except Auth.DoesNotExist:
            return None
        except Auth.MultipleObjectsReturned:
            user = Auth.objects.filter(
                Q(username=username) | Q(email=username) | Q(cell=username)
            ).first()

        if not user:
            return None

        if _verify_password(password, user.password):
            return user

        return None

    def get_user(self, user_id):
        try:
            return Auth.objects.get(pk=user_id)
        except Auth.DoesNotExist:
            return None