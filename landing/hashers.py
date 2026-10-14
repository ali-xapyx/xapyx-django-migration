import bcrypt
from django.contrib.auth.hashers import BCryptPasswordHasher


class RawBCryptPasswordHasher(BCryptPasswordHasher):
    """BCrypt hasher that writes raw $2b$ hashes (PHP-compatible).
    Reads both prefixed (legacy) and raw formats."""

    def encode(self, password, salt):
        pw = password.encode() if isinstance(password, str) else password
        s = salt.encode() if isinstance(salt, str) else salt
        h = bcrypt.hashpw(pw, s).decode()
        return ('$2y$' + h[4:]) if h.startswith('$2b$') else h

    def verify(self, password, encoded):
        if isinstance(encoded, bytes):
            encoded = encoded.decode()
        if encoded.startswith('bcrypt$'):
            encoded = encoded[len('bcrypt$'):]
        try:
            pw = password.encode() if isinstance(password, str) else password
            enc = encoded.encode() if isinstance(encoded, str) else encoded
            return bcrypt.checkpw(pw, enc)
        except (ValueError, TypeError):
            return False

    def safe_summary(self, encoded):
        if encoded.startswith('bcrypt$'):
            encoded = encoded[len('bcrypt$'):]
        return super().safe_summary(encoded)

    def must_update(self, encoded):
        # Only update if the hash uses bcrypt_sha256 or old format
        return encoded.startswith('bcrypt_sha256$') or encoded.startswith('pbkdf2_')
