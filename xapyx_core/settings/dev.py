from .base import *

DEBUG = True

ALLOWED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '184.192.39.68',
    'testserver',
    'beta.xapyx.com',
    'xapyx.com',
    '*',
]

CSRF_TRUSTED_ORIGINS = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://184.192.39.68:8000',
    'http://beta.xapyx.com',
    'https://beta.xapyx.com',
    'https://*.trycloudflare.com',
]
