import redis
import os
import json
import time
import uuid
import logging
from datetime import datetime

_log = logging.getLogger(__name__)

r = redis.Redis(
    host='127.0.0.1',
    port=6379,
    db=4,  # separate DB from cache(1)/sessions/celery(2,3)
    decode_responses=True,
)

QUEUE_KEY = 'roulette:waiting'
USER_KEY = 'roulette:user:{}'          # hash: {status, partner_id, session_id, joined_at, last_seen}
SESSION_KEY = 'roulette:session:{}'    # hash: {session_id, user_a, user_b, created_at}
MESSAGES_KEY = 'roulette:messages:{}'  # list of JSON strings
ACTIVE_SESSIONS_KEY = 'roulette:active_sessions'

TTL = 300  # 5 minutes for session/messages
PRESENCE_TTL = 30  # 30 seconds presence TTL for user state
COOLDOWN_KEY = 'roulette:cooldown:{}:{}'
COOLDOWN_TTL = 1800  # 30 minutes cooldown between same pair
RATE_LIMIT_KEY = 'roulette:rate:{}'
RATE_LIMIT_MAX = 10
RATE_LIMIT_WINDOW = 10  # max 10 messages per 10 seconds
MAX_SESSION_DURATION = 1800  # 30 minutes maximum session duration

# Atomic matchmaking Lua script with presence & ghost purge
LUA_MATCH = """
local waiting = KEYS[1]
local me = ARGV[1]
local now = tonumber(ARGV[2]) or 0
local members = redis.call('SMEMBERS', waiting)
for _, uid in ipairs(members) do
    if uid ~= me then
        local user_key = 'roulette:user:' .. uid
        local status = redis.call('HGET', user_key, 'status')
        if status == 'waiting' then
            local last_seen = tonumber(redis.call('HGET', user_key, 'last_seen')) or 0
            if now > 0 and last_seen > 0 and (now - last_seen) > 20 then
                redis.call('SREM', waiting, uid)
                redis.call('DEL', user_key)
            else
                local removed = redis.call('SREM', waiting, uid)
                if removed == 1 then
                    redis.call('SREM', waiting, me)
                    return uid
                end
            end
        else
            redis.call('SREM', waiting, uid)
        end
    end
end
return nil
"""


def get_user_profile_for_roulette(user_id):
    """Fetch user profile with raw SQL."""
    try:
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("SELECT id, name, username, picture FROM auth WHERE id = %s LIMIT 1", [user_id])
            row = cur.fetchone()
            if row:
                pic = row[3] or ''
                if not pic:
                    pic_url = '/static/images/avatars/default.png'
                elif pic.startswith('http://') or pic.startswith('https://') or pic.startswith('/'):
                    pic_url = pic
                else:
                    pic_url = f'https://s3.eu-west-1.amazonaws.com/xapyx.com-media/uploads/{pic}'
                return {
                    'id': int(row[0]),
                    'name': row[1] or row[2] or 'Anonymous User',
                    'username': row[2] or 'anonymous',
                    'picture': pic_url,
                }
    except Exception:
        pass
    return {
        'id': int(user_id),
        'name': 'Anonymous User',
        'username': 'anonymous',
        'picture': '/static/images/avatars/default.png',
    }


def broadcast_roulette_match(user_a_id, user_b_id, session_id):
    """
    Pushes match payload to Firebase RTDB for both users so their clients connect instantly.
    """
    try:
        import requests
        base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
        prof_a = get_user_profile_for_roulette(user_a_id)
        prof_b = get_user_profile_for_roulette(user_b_id)
        now_ms = int(time.time() * 1000)

        payload_a = {
            'room_id': session_id,
            'session_id': session_id,
            'partner': prof_b,
            'is_initiator': (int(user_a_id) < int(user_b_id)),
            'matched_at': now_ms,
            'status': 'matched',
        }
        payload_b = {
            'room_id': session_id,
            'session_id': session_id,
            'partner': prof_a,
            'is_initiator': (int(user_b_id) < int(user_a_id)),
            'matched_at': now_ms,
            'status': 'matched',
        }

        requests.put(f"{base_url}/roulette/matches/{user_a_id}.json", json=payload_a, timeout=3)
        requests.put(f"{base_url}/roulette/matches/{user_b_id}.json", json=payload_b, timeout=3)
        requests.put(f"{base_url}/roulette/rooms/{session_id}/status.json", json='active', timeout=3)
        requests.delete(f"{base_url}/roulette/queue/{user_a_id}.json", timeout=2)
        requests.delete(f"{base_url}/roulette/queue/{user_b_id}.json", timeout=2)
    except Exception as e:
        _log.warning(f"Roulette Firebase match broadcast failed: {e}")


def purge_stale_queue():
    """Scans QUEUE_KEY and deletes members whose USER_KEY is expired, not 'waiting', or last_seen > 20s ago."""
    try:
        now = time.time()
        members = r.smembers(QUEUE_KEY)
        for uid in list(members):
            u_key = USER_KEY.format(uid)
            data = r.hgetall(u_key)
            if not data or data.get('status') != 'waiting':
                r.srem(QUEUE_KEY, uid)
                continue
            last_seen = data.get('last_seen')
            if last_seen:
                try:
                    if (now - float(last_seen)) > 20:
                        r.srem(QUEUE_KEY, uid)
                        r.delete(u_key)
                except (ValueError, TypeError):
                    pass
    except Exception:
        pass


def join_queue(user_id):
    """Adds user to waiting set and initializes USER_KEY with TTL."""
    uid = str(user_id)
    user_state = get_user_state(uid)
    if user_state and user_state.get('status') == 'matched':
        leave_session(uid)

    purge_stale_queue()
    now = str(time.time())
    r.hset(USER_KEY.format(uid), mapping={
        'status': 'waiting',
        'partner_id': '',
        'session_id': '',
        'joined_at': now,
        'last_seen': now,
    })
    r.expire(USER_KEY.format(uid), PRESENCE_TTL)
    r.sadd(QUEUE_KEY, uid)
    return True


def leave_queue(user_id):
    """Removes user from waiting set and deletes USER_KEY."""
    uid = str(user_id)
    r.srem(QUEUE_KEY, uid)
    r.delete(USER_KEY.format(uid))
    try:
        import requests
        base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
        requests.delete(f"{base_url}/roulette/queue/{uid}.json", timeout=2)
    except Exception:
        pass
    return True


def set_cooldown(uid_a, uid_b):
    """Sets 30 min cooldown between two users."""
    if not uid_a or not uid_b or str(uid_a) == str(uid_b):
        return
    low = min(int(uid_a), int(uid_b))
    high = max(int(uid_a), int(uid_b))
    r.setex(COOLDOWN_KEY.format(low, high), COOLDOWN_TTL, 1)


def is_in_cooldown(uid_a, uid_b):
    """Returns True if pair is in cooldown."""
    try:
        low = min(int(uid_a), int(uid_b))
        high = max(int(uid_a), int(uid_b))
        return r.exists(COOLDOWN_KEY.format(low, high)) == 1
    except Exception:
        return False


def is_blocked_pair(uid_a, uid_b):
    """Checks MariaDB blocks table if either user blocked the other."""
    try:
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM blocks 
                WHERE (blocker_id = %s AND blocked_id = %s)
                   OR (blocker_id = %s AND blocked_id = %s)
                LIMIT 1
            """, [uid_a, uid_b, uid_b, uid_a])
            return cur.fetchone() is not None
    except Exception:
        return False


def check_rate_limit(user_id):
    """
    Rate limit check: allows max 10 messages per 10 seconds.
    Returns True if allowed, False if exceeded.
    """
    key = RATE_LIMIT_KEY.format(user_id)
    current = r.incr(key)
    if current == 1:
        r.expire(key, RATE_LIMIT_WINDOW)
    return current <= RATE_LIMIT_MAX


def is_session_expired(session_id):
    """Checks if session exceeds 30 minutes."""
    if not session_id:
        return False
    s_data = r.hgetall(SESSION_KEY.format(session_id))
    if not s_data:
        return True
    created_at = s_data.get('created_at')
    if not created_at:
        return False
    try:
        return (time.time() - float(created_at)) > MAX_SESSION_DURATION
    except (ValueError, TypeError):
        return False


def end_expired_session(session_id):
    """Appends system message and terminates expired session."""
    if not session_id or not r.exists(SESSION_KEY.format(session_id)):
        return
    m_key = MESSAGES_KEY.format(session_id)
    sys_msg = {
        'id': r.llen(m_key) + 1,
        'sender_id': 0,
        'text': 'Session ended (30 min limit)',
        'created_at': time.time(),
        'time_str': datetime.now().strftime('%H:%M'),
        'system': True,
    }
    r.rpush(m_key, json.dumps(sys_msg))
    
    s_data = r.hgetall(SESSION_KEY.format(session_id))
    user_a = s_data.get('user_a')
    user_b = s_data.get('user_b')
    
    for uid in [user_a, user_b]:
        if uid:
            u_key = USER_KEY.format(uid)
            r.hset(u_key, mapping={
                'status': 'left',
                'partner_id': '',
                'session_id': session_id,
            })
            r.expire(u_key, 60)
            
    r.srem(ACTIVE_SESSIONS_KEY, session_id)
    r.expire(SESSION_KEY.format(session_id), 60)
    r.expire(MESSAGES_KEY.format(session_id), 60)

    try:
        import requests
        base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
        requests.put(f"{base_url}/roulette/rooms/{session_id}/status.json", json='expired', timeout=2)
    except Exception:
        pass


def try_match(user_id):
    """
    Atomic matchmaking with cooldown and block-list checks (skips up to 20 candidates).
    Returns (partner_id, session_id) or (None, None).
    """
    uid = str(user_id)
    # Check if this user was already matched concurrently
    state = get_user_state(uid)
    if state and state.get('status') == 'matched' and state.get('partner_id') and state.get('session_id'):
        return int(state['partner_id']), state['session_id']

    now_ts = time.time()
    skipped_candidates = []
    matched_candidate = None

    for _ in range(20):
        candidate = r.eval(LUA_MATCH, 1, QUEUE_KEY, uid, str(now_ts))
        if not candidate:
            break

        cand_str = str(candidate)
        if is_in_cooldown(uid, cand_str) or is_blocked_pair(uid, cand_str):
            skipped_candidates.append(cand_str)
            continue

        matched_candidate = cand_str
        break

    for sc in skipped_candidates:
        sc_state = get_user_state(sc)
        if sc_state and sc_state.get('status') == 'waiting':
            r.sadd(QUEUE_KEY, sc)

    if not matched_candidate:
        user_state = get_user_state(uid)
        if user_state and user_state.get('status') == 'waiting':
            r.sadd(QUEUE_KEY, uid)
        elif user_state and user_state.get('status') == 'matched' and user_state.get('partner_id') and user_state.get('session_id'):
            return int(user_state['partner_id']), user_state['session_id']
        return None, None

    partner_id = matched_candidate
    now = str(time.time())
    u_min = min(int(uid), int(partner_id))
    u_max = max(int(uid), int(partner_id))
    session_id = f"roulette_{u_min}_{u_max}_{int(float(now))}"

    # Record wait times for stats
    try:
        user_a_joined = float(r.hget(USER_KEY.format(uid), 'joined_at') or now)
        user_b_joined = float(r.hget(USER_KEY.format(partner_id), 'joined_at') or now)
        wait_a = max(1, int(float(now) - user_a_joined))
        wait_b = max(1, int(float(now) - user_b_joined))
        r.lpush('roulette:match_times', wait_a, wait_b)
        r.ltrim('roulette:match_times', 0, 19)
    except Exception:
        pass

    # Session hash
    r.hset(SESSION_KEY.format(session_id), mapping={
        'session_id': session_id,
        'user_a': str(u_min),
        'user_b': str(u_max),
        'created_at': now,
    })
    r.expire(SESSION_KEY.format(session_id), TTL)
    r.sadd(ACTIVE_SESSIONS_KEY, session_id)

    # User A state
    r.hset(USER_KEY.format(uid), mapping={
        'status': 'matched',
        'partner_id': str(partner_id),
        'session_id': session_id,
        'last_seen': now,
    })
    r.expire(USER_KEY.format(uid), PRESENCE_TTL)

    # User B state
    r.hset(USER_KEY.format(partner_id), mapping={
        'status': 'matched',
        'partner_id': str(uid),
        'session_id': session_id,
        'last_seen': now,
    })
    r.expire(USER_KEY.format(partner_id), PRESENCE_TTL)

    # Broadcast match payload to Firebase RTDB for sub-50ms instant pairing
    broadcast_roulette_match(int(uid), int(partner_id), session_id)

    return int(partner_id), session_id


def get_user_state(user_id):
    """Returns dict of user state from Redis or None."""
    data = r.hgetall(USER_KEY.format(user_id))
    return data if data else None


def get_partner(user_id):
    """Reads USER_KEY and returns (partner_id, session_id) or (None, None)."""
    state = get_user_state(user_id)
    if not state or state.get('status') != 'matched':
        return None, None
    partner_id = state.get('partner_id')
    session_id = state.get('session_id')
    return (int(partner_id) if partner_id else None), session_id


def send_message(user_id, partner_id, text):
    """Appends JSON string to MESSAGES_KEY with TTL refresh. Returns message dict or None."""
    uid = str(user_id)
    user_state = get_user_state(uid)
    if not user_state or user_state.get('status') != 'matched':
        return None

    session_id = user_state.get('session_id')
    if not session_id or user_state.get('partner_id') != str(partner_id):
        return None

    m_key = MESSAGES_KEY.format(session_id)
    msg_id = r.llen(m_key) + 1
    now = time.time()
    msg_obj = {
        'id': msg_id,
        'sender_id': int(user_id),
        'text': text,
        'created_at': now,
        'time_str': datetime.now().strftime('%H:%M'),
    }

    r.rpush(m_key, json.dumps(msg_obj))
    r.expire(m_key, TTL)
    r.expire(SESSION_KEY.format(session_id), TTL)
    r.expire(USER_KEY.format(uid), PRESENCE_TTL)
    r.expire(USER_KEY.format(partner_id), PRESENCE_TTL)

    # Push to Firebase RTDB room messages for real-time delivery
    try:
        import requests
        base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
        requests.put(f"{base_url}/roulette/rooms/{session_id}/messages/{msg_id}.json", json=msg_obj, timeout=2)
    except Exception:
        pass

    return msg_obj


def fetch_messages(session_id, since_id=0):
    """Returns (list of messages, next_since_id)."""
    m_key = MESSAGES_KEY.format(session_id)
    try:
        start_idx = int(since_id)
    except (ValueError, TypeError):
        start_idx = 0

    items = r.lrange(m_key, start_idx, -1)
    msgs = [json.loads(x) for x in items] if items else []
    total = r.llen(m_key)
    return msgs, total


def leave_session(user_id):
    """Removes user from USER_KEY and queue, sets partner status to 'left'."""
    uid = str(user_id)
    u_key = USER_KEY.format(uid)
    user_state = r.hgetall(u_key)

    r.srem(QUEUE_KEY, uid)
    r.delete(u_key)

    partner_id = None
    session_id = None

    if user_state:
        partner_id = user_state.get('partner_id')
        session_id = user_state.get('session_id')

        if partner_id:
            set_cooldown(uid, partner_id)
            p_key = USER_KEY.format(partner_id)
            p_state = r.hgetall(p_key)
            if p_state and p_state.get('session_id') == session_id:
                r.hset(p_key, mapping={
                    'status': 'left',
                    'partner_id': '',
                    'session_id': '',
                })
                r.expire(p_key, 60)

        if session_id:
            r.srem(ACTIVE_SESSIONS_KEY, session_id)
            r.expire(SESSION_KEY.format(session_id), 60)
            r.expire(MESSAGES_KEY.format(session_id), 60)

    # Sync leave to Firebase RTDB
    try:
        import requests
        base_url = os.environ.get('FIREBASE_CHAT_DB_URL', 'https://xapyx-chat-default-rtdb.firebaseio.com').rstrip('/')
        requests.delete(f"{base_url}/roulette/matches/{uid}.json", timeout=2)
        requests.delete(f"{base_url}/roulette/queue/{uid}.json", timeout=2)
        if session_id:
            requests.put(f"{base_url}/roulette/rooms/{session_id}/status.json", json='left', timeout=2)
        if partner_id:
            requests.delete(f"{base_url}/roulette/matches/{partner_id}.json", timeout=2)
    except Exception:
        pass

    return True


def heartbeat(user_id):
    """Refreshes presence TTL on user and session keys."""
    uid = str(user_id)
    u_key = USER_KEY.format(uid)
    if r.exists(u_key):
        r.hset(u_key, 'last_seen', str(time.time()))
        r.expire(u_key, PRESENCE_TTL)
        session_id = r.hget(u_key, 'session_id')
        if session_id:
            r.expire(SESSION_KEY.format(session_id), TTL)
            r.expire(MESSAGES_KEY.format(session_id), TTL)
        return True
    return False


def next_partner(user_id):
    """Cleanly leaves current session, joins queue, and attempts immediate match."""
    uid = str(user_id)
    leave_session(uid)
    join_queue(uid)
    return try_match(uid)


def get_active_counts():
    """Returns waiting, chatting, total active users count, and average wait time."""
    purge_stale_queue()
    waiting_members = r.smembers(QUEUE_KEY)
    valid_waiting = 0
    now = time.time()
    current_wait_times = []

    if waiting_members:
        for uid in list(waiting_members):
            u_key = USER_KEY.format(uid)
            if r.exists(u_key):
                valid_waiting += 1
                joined = r.hget(u_key, 'joined_at')
                if joined:
                    try:
                        current_wait_times.append(now - float(joined))
                    except (ValueError, TypeError):
                        pass
            else:
                r.srem(QUEUE_KEY, uid)

    active_sessions = r.smembers(ACTIVE_SESSIONS_KEY)
    valid_sessions = 0
    if active_sessions:
        for sid in list(active_sessions):
            if r.exists(SESSION_KEY.format(sid)):
                valid_sessions += 1
            else:
                r.srem(ACTIVE_SESSIONS_KEY, sid)
    chatting_count = valid_sessions * 2

    # Compute average wait time from past matches or current queue
    past_match_times = []
    raw_past = r.lrange('roulette:match_times', 0, 19)
    if raw_past:
        for val in raw_past:
            try:
                past_match_times.append(int(val))
            except (ValueError, TypeError):
                pass

    if past_match_times:
        avg_wait = int(sum(past_match_times) / len(past_match_times))
    elif current_wait_times:
        avg_wait = int(sum(current_wait_times) / len(current_wait_times))
    else:
        avg_wait = 12

    avg_wait = max(3, min(avg_wait, 60))

    return {
        'waiting': valid_waiting,
        'chatting': chatting_count,
        'total': valid_waiting + chatting_count,
        'avg_wait': avg_wait,
        'avg_wait_str': f"{avg_wait}s",
    }
