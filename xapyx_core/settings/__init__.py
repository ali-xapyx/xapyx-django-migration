import os

env = os.environ.get('DJANGO_ENV', 'dev').lower()
if env in ('prod', 'production'):
    from .prod import *
else:
    from .dev import *
