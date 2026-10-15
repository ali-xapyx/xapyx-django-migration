from .base import *

DEBUG = False

env_hosts = os.environ.get('DJANGO_ALLOWED_HOSTS', 'xapyx.com,betaa.xapyx.com')
ALLOWED_HOSTS = [h.strip() for h in env_hosts.split(',') if h.strip()]

env_csrf = os.environ.get('DJANGO_CSRF_TRUSTED_ORIGINS', 'https://xapyx.com,https://betaa.xapyx.com')
CSRF_TRUSTED_ORIGINS = [o.strip() for o in env_csrf.split(',') if o.strip()]

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# AWS Application Load Balancer / Nginx Reverse Proxy SSL Header
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Connection pooling under high concurrency (500+ users)
DATABASES['default']['CONN_MAX_AGE'] = int(os.environ.get('DB_CONN_MAX_AGE', 60))
