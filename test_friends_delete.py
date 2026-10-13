from django.test import Client
from landing.models import Auth
from django.db import connection

user = Auth.objects.get(username='test')
c = Client()
c.force_login(user)
print(f"Testing as user {user.id} (@{user.username})")

# Setup: find a pending request that I RECEIVED (to test decline)
with connection.cursor() as cur:
    cur.execute(
        "SELECT id, sender_id FROM friends "
        "WHERE receiver_id = %s AND status = 'pending' LIMIT 1",
        [user.id]
    )
    row = cur.fetchone()

if row:
    req_id, sender = row
    print(f"Found incoming request id={req_id} from {sender}")
    r = c.post('/api/friends/decline/', data={'request_id': req_id})
    print("Decline:", r.status_code, r.json())

    # Verify it's gone
    with connection.cursor() as cur:
        cur.execute("SELECT id FROM friends WHERE id = %s", [req_id])
        print("Row after decline:", cur.fetchone())

# Setup: create a pending request I SENT (to test cancel)
with connection.cursor() as cur:
    cur.execute("SELECT id FROM auth WHERE id != %s LIMIT 1", [user.id])
    other = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO friends (sender_id, receiver_id, status) VALUES (%s, %s, 'pending')",
        [user.id, other]
    )
    new_req_id = cur.lastrowid
print(f"\nCreated outgoing request id={new_req_id} to user {other}")

r = c.post('/api/friends/cancel/', data={'request_id': new_req_id})
print("Cancel:", r.status_code, r.json())

# Setup: create an accepted friendship (to test remove)
with connection.cursor() as cur:
    cur.execute(
        "INSERT INTO friends (sender_id, receiver_id, status) VALUES (%s, %s, 'accepted')",
        [user.id, other]
    )
    accepted_id = cur.lastrowid
print(f"\nCreated accepted friendship id={accepted_id} with user {other}")

r = c.post('/api/friends/remove/', data={'friend_id': other})
print("Remove:", r.status_code, r.json())

# Error case: try to remove someone we're not friends with
r = c.post('/api/friends/remove/', data={'friend_id': 999999})
print("Remove non-friend:", r.status_code, r.json())

exit()