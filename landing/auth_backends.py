# landing/auth_backends.py
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth.hashers import check_password as django_check_password
from django.db import connection
from django.db.models import Q
from .models import Auth
import bcrypt


def _normalize_php_bcrypt(hash_value):
    """Normalize $2y$ or bcrypt$$2b$ to $2b$ for Python bcrypt.checkpw()."""
    if not hash_value:
        return hash_value
    if hash_value.startswith('bcrypt$'):
        hash_value = hash_value[len('bcrypt$'):]
    if hash_value.startswith('$2y$'):
        return '$2b$' + hash_value[4:]
    return hash_value


def _make_php_bcrypt(raw_password):
    """Generate a PHP-compatible $2y$12$... bcrypt hash."""
    h = bcrypt.hashpw(raw_password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
    if h.startswith('$2b$'):
        h = '$2y$' + h[4:]
    return h


def _verify_password(password, hash_value):
    """
    Verify a password against:
    1. Raw or bcrypt$-prefixed bcrypt hashes ($2a$, $2b$, $2y$)
    2. Django's check_password (for bcrypt_sha256$, pbkdf2_, etc.)
    """
    if not hash_value:
        return False

    normalized = _normalize_php_bcrypt(hash_value)
    if normalized.startswith(('$2a$', '$2b$', '$2y$')):
        try:
            if bcrypt.checkpw(password.encode('utf-8'), normalized.encode('utf-8')):
                return True
        except (ValueError, TypeError):
            pass

    try:
        if django_check_password(password, hash_value):
            return True
    except Exception:
        pass

    return False


class MultiFieldAuthBackend(BaseBackend):
    """
    Allows login with username, email, OR cell phone.
    Automatically upgrades any Django-prefixed hash (bcrypt$, bcrypt_sha256$, pbkdf2_)
    to a raw PHP-compatible $2y$ bcrypt hash upon successful login.
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
            # Auto-upgrade non-PHP hashes (e.g. bcrypt_sha256$, bcrypt$, $2b$) to raw $2y$
            if not user.password.startswith('$2y$'):
                new_hash = _make_php_bcrypt(password)
                Auth.objects.filter(pk=user.pk).update(password=new_hash)
                user.password = new_hash
                if user.email:
                    with connection.cursor() as cur:
                        cur.execute("UPDATE admins SET password = %s WHERE email = %s", [new_hash, user.email])
            return user

        return None

    def get_user(self, user_id):
        try:
            return Auth.objects.get(pk=user_id)
        except Auth.DoesNotExist:
            return None
