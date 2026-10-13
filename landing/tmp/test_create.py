from django.test import Client
from landing.models import Auth
import json
from django.db import connection
from django.core.files.uploadedfile import SimpleUploadedFile
user = Auth.objects.get(username='test')
c = Client()
c.force_login(user)
r = c.post('/api/posts/create/', data={'content': 'Test text'})
print("Test 1:", r.status_code, r.json().get('success'))
pid1 = r.json().get('post', {}).get('id')
r = c.post('/api/posts/create/', data={
    'content': 'Poll test',
    'poll_question': 'Best color?',
    'poll_options': json.dumps(['Red', 'Blue']),
    'poll_duration': '3',
})
print("Test 2:", r.status_code, r.json().get('success'))
pid2 = r.json().get('post', {}).get('id')
with connection.cursor() as cur:
    cur.execute("SELECT id FROM auth WHERE id != %s LIMIT 1", [user.id])
    other = cur.fetchone()
other_id = other[0] if other else user.id
r = c.post('/api/posts/create/', data={
    'content': 'Mention test',
    'mentions': json.dumps([{'user_id': other_id, 'username': 'someone'}]),
})
print("Test 3 (valid mention):", r.status_code, r.json().get('success'))
pid3 = r.json().get('post', {}).get('id')
r = c.post('/api/posts/create/', data={
    'content': 'Bad mention test',
    'mentions': json.dumps([{'user_id': 999999999, 'username': 'ghost'}]),
})
print("Test 4 (bad mention):", r.status_code, r.json().get('success'))
pid4 = r.json().get('post', {}).get('id')
with connection.cursor() as cur:
    for pid in [pid1, pid2, pid3, pid4]:
        if pid:
            cur.execute("DELETE FROM space_media WHERE post_id=%s", [pid])
            cur.execute("DELETE FROM space_polls WHERE post_id=%s", [pid])
            cur.execute("DELETE FROM mentions WHERE post_id=%s", [pid])
            cur.execute("DELETE FROM space_posts WHERE post_id=%s", [pid])
print("cleaned up")
