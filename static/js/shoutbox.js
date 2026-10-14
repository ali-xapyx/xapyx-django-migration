/* ============================================================
   SHOUTBOX — real-time via Firebase (already inited in base)
   ============================================================ */

(function () {
  'use strict';

  const CFG = window.SHOUTBOX_CONFIG || {};
  const CURRENT_USER = CFG.currentUser || {};
  let allUsers = CFG.friends || [];
  const BASE_PATH = '/';

    // Debug: verify config arrived
  console.log('[shoutbox] currentUser:', CFG.currentUser);
  console.log('[shoutbox] friends from server:', allUsers.length);

  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  // ---- DOM ----
  const shoutList = document.getElementById('shoutList');
  const shoutForm = document.getElementById('shoutForm');
  const shoutInput = document.getElementById('shoutInput');
  const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
  const charCountInside = document.getElementById('charCountInside');
  const typingIndicator = document.getElementById('typingIndicator');
  const typingText = document.getElementById('typingText');

  if (!shoutList || !shoutForm) return;

  // ---- State ----
  let firebaseApp = null, database = null, messagesRef = null,
      typingRef = null, onlineRef = null;
  let isAtBottom = true, isTyping = false, typingTimeout = null,
      lastSentMessageId = null, lastMessageTimestamp = 0;
  let messageIds = new Set();
  let isMentioning = false, currentMentionStart = -1, mentionSearch = '';

  const isMobile = window.matchMedia('(max-width: 767px)').matches;

  // ---- Utilities ----
  function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return 'Now';
    try {
      const d = new Date(ts);
      const diffMin = Math.floor((Date.now() - d) / 60000);
      if (diffMin < 1) return 'Now';
      if (diffMin < 60) return diffMin + 'm';
      if (diffMin < 1440) return Math.floor(diffMin / 60) + 'h';
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    } catch { return 'Now'; }
  }

  function updateCharCount() {
    const remaining = 140 - shoutInput.value.length;
    charCountInside.textContent = remaining;
    charCountInside.classList.remove('warning', 'danger');
    if (remaining < 20) charCountInside.classList.add('danger');
    else if (remaining < 50) charCountInside.classList.add('warning');
  }

  function checkScrollPosition() {
    const scrollBottom = shoutList.scrollHeight - shoutList.scrollTop - shoutList.clientHeight;
    isAtBottom = scrollBottom < 50;
    scrollToBottomBtn.style.display = isAtBottom ? 'none' : 'flex';
  }

  function scrollToBottom() {
    shoutList.scrollTop = shoutList.scrollHeight;
    isAtBottom = true;
    scrollToBottomBtn.style.display = 'none';
  }
  
  function toast(msg, type) {
    type = type || 'info';
    document.querySelectorAll('.custom-alert').forEach(a => a.remove());
    const t = document.createElement('div');
    t.className = 'custom-alert ' + type;
    const icon = type === 'success' ? 'bi-check-circle-fill'
              : type === 'error'   ? 'bi-x-circle-fill'
              : type === 'warning' ? 'bi-exclamation-triangle-fill'
              :                      'bi-info-circle-fill';
    t.innerHTML =
      '<div class="d-flex align-items-center justify-content-between">' +
        '<div class="d-flex align-items-center">' +
          '<i class="bi ' + icon + ' alert-icon"></i>' +
          '<div>' + msg + '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentElement) t.remove(); }, 3000);
  }
  
  // ---- Mention autocomplete ----
  function setupMentionHandlers() {
    shoutInput.addEventListener('input', e => {
      handleMentionInput(e);
      updateCharCount();
      handleTyping();
    });
    shoutInput.addEventListener('keydown', handleMentionKeydown);
    document.addEventListener('click', e => {
      const popup = document.getElementById('mentionSuggestions');
      if (popup && !popup.contains(e.target) && e.target !== shoutInput) {
        popup.classList.remove('show');
        isMentioning = false;
      }
    });
  }

  function handleMentionInput(e) {
    const input = e.target;
    const value = input.value;
    const pos = input.selectionStart;
    let start = -1;
    for (let i = pos - 1; i >= 0; i--) {
      if (value[i] === '@' && (i === 0 || /[\s\n\t]/.test(value[i - 1]))) { start = i; break; }
    }
    if (start !== -1 && (pos === start + 1 || value[start + 1] !== ' ')) {
      isMentioning = true;
      currentMentionStart = start;
      mentionSearch = value.substring(start + 1, pos).toLowerCase();
      showMentionPopup(mentionSearch, input);
    } else {
      isMentioning = false;
      document.getElementById('mentionSuggestions').classList.remove('show');
    }
  }

  function handleMentionKeydown(e) {
    if (!isMentioning) return;
    const popup = document.getElementById('mentionSuggestions');
    if (!popup || !popup.classList.contains('show')) return;
    const items = popup.querySelectorAll('.sbx-mention-item');
    if (!items.length) return;
    let active = -1;
    items.forEach((it, i) => { if (it.classList.contains('active')) active = i; });
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active < items.length - 1) {
        if (active !== -1) items[active].classList.remove('active');
        items[active + 1].classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active > 0) {
        items[active].classList.remove('active');
        items[active - 1].classList.add('active');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active !== -1) selectMention(items[active]);
    } else if (e.key === 'Escape') {
      popup.classList.remove('show');
      isMentioning = false;
    }
  }

  function showMentionPopup(search, inputElement) {
    const popup = document.getElementById('mentionSuggestions');
    const filtered = allUsers.filter(u =>
      u.id !== CURRENT_USER.id &&
      (u.name.toLowerCase().includes(search) || u.username.toLowerCase().includes(search))
    ).slice(0, 5);

    if (!filtered.length) {
      popup.innerHTML = '<div class="sbx-no-friends-found"><i class="fas fa-user-friends"></i><div><div>No friends found</div><div style="font-size:0.75rem;opacity:0.7;">You can only mention friends</div></div></div>';
    } else {
      popup.innerHTML = filtered.map((u, i) => {
        var av = u.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
          avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `
        <div class="sbx-mention-item ${i === 0 ? 'active' : ''}"
             data-user-id="${u.id}" data-username="${u.username}" data-name="${u.name}">
          <img src="${avThumb}" width="40" height="40" onerror="this.onerror=null;this.src='${av}'" class="sbx-mention-avatar" alt="">
          <div class="sbx-mention-info">
            <div class="sbx-mention-name">${escapeHtml(u.name)}</div>
            <div class="sbx-mention-username">@${escapeHtml(u.username)}</div>
          </div>
        </div>`;
      }).join('');
      popup.querySelectorAll('.sbx-mention-item').forEach(el => {
        el.addEventListener('click', () => selectMention(el));
      });
    }
    popup.classList.add('show');
  }

  function selectMention(item) {
    const username = item.dataset.username;
    const value = shoutInput.value;
    shoutInput.value = value.substring(0, currentMentionStart) + '@' + username + ' ' + value.substring(shoutInput.selectionStart);
    const newPos = currentMentionStart + username.length + 2;
    shoutInput.setSelectionRange(newPos, newPos);
    updateCharCount();
    document.getElementById('mentionSuggestions').classList.remove('show');
    isMentioning = false;
    shoutInput.focus();
  }

  // ---- Rendering ----
   function renderMessage(data, isMyMessage) {
    if (!data || !data.id) return null;
    const idStr = String(data.id);
    if (messageIds.has(idStr)) return null;
    messageIds.add(idStr);

    const div = document.createElement('div');
    div.className = 'message-item' + (isMyMessage ? ' my-message' : '');
    div.dataset.messageId = idStr;
    div.dataset.timestamp = data.timestamp || Date.now();
    div.dataset.userId = data.userId || data.user_id;

    const text = data.message || '';
    if (mentionsMe(text)) div.classList.add('sbx-mentioned');

    const user = data.user || {};
    const av = data.avatar || user.picture || '/static/images/avatars/default.png';
    let avThumb = av;
    if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
      avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
    }
    const avatar = avThumb;
    const name = data.userName || user.name || 'User';
    const username = user.username || data.username || '';
    const uid = data.userId || user.id || data.user_id || data.uid;
    const time = formatTime(data.timestamp);

    let content = escapeHtml(text);
    // ... rest unchanged
    content = content.replace(/@(\w+)/g, (match, uname) => {
      const u = allUsers.find(x => x.username.toLowerCase() === uname.toLowerCase());
      if (!u) return match;
      const isSelf = u.id === CURRENT_USER.id;
      const cls = isSelf ? 'sbx-mention-self' : 'sbx-mention-other';
      return `<span class="sbx-mention ${cls}" data-username="${u.username}">@${escapeHtml(uname)}</span>`;
    });

    var profileUrl = '#';
    if (username) {
        profileUrl = '/user/' + encodeURIComponent(username) + '/';
    } else if (uid) {
        profileUrl = '/user/' + encodeURIComponent(uid) + '/';
    }

    div.innerHTML =
      '<div class="sbx-mention-indicator"></div>' +
      '<div class="message-avatar" onclick="window.location.href=\'' + profileUrl + '\'">' +
        '<img src="' + avatar + '" width="40" height="40" onerror="this.onerror=null;this.src=\'' + av + '\'" alt="" class="avatar" loading="lazy">' +
      '</div>' +
      '<div class="message-content">' +
        '<div class="message-header">' +
          '<span class="message-user" onclick="window.location.href=\'' + profileUrl + '\'">' + escapeHtml(name) + '</span>' +
          '<span class="message-time">' + time + '</span>' +
        '</div>' +
        '<div class="message-text">' + content + '</div>' +
      '</div>';

    div.querySelectorAll('.sbx-mention').forEach(m => {
      m.addEventListener('click', function (e) {
        e.stopPropagation();
        const un = this.getAttribute('data-username');
        if (un) window.location.href = '/user/' + un + '/';
      });
    });

    // Own-message trash button (mobile-first, always visible)
    if (isMyMessage || Boolean(window.XPY_CONFIG && window.XPY_CONFIG.isStaff)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'message-delete-btn';
      btn.setAttribute('aria-label', 'Delete shout');
      btn.innerHTML = '<i class="bi bi-trash"></i>';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDeleteShout(idStr, div);
      });
      div.appendChild(btn);
    }

    return div;
  }

  function mentionsMe(text) {
    if (!CURRENT_USER.username || !text) return false;
    const re = /@(\w+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1].toLowerCase() === CURRENT_USER.username.toLowerCase()) return true;
    }
    return false;
  }

  // ---- Data loading ----
  async function loadInitialMessages() {
    shoutList.innerHTML = '<div class="sbx-loading-text"><div class="sbx-loading-dots"><span></span><span></span><span></span></div><p>Loading messages...</p></div>';
    messageIds.clear();

    try {
      const r = await fetch('/api/shouts/list/?limit=50');
      const d = await r.json();
      if (!d.success) throw new Error('Failed');
      shoutList.innerHTML = '';
      if (!d.shouts.length) {
        shoutList.innerHTML = '<div class="sbx-empty-state"><i class="fas fa-comments"></i><h5>No shouts yet</h5><p>Be the first to say something!</p></div>';
        return;
      }
      d.shouts.forEach(s => {
        const msg = {
          id: s.id,
          message: s.message,
          timestamp: s.timestamp,
          userId: s.user_id,
          user: s.user,
          is_mine: s.is_mine,
        };
        const el = renderMessage(msg, s.is_mine);
        if (el) shoutList.appendChild(el);
        lastMessageTimestamp = Math.max(lastMessageTimestamp, s.timestamp || 0);
      });
      setTimeout(() => {
        shoutList.scrollTop = shoutList.scrollHeight;
        isAtBottom = true;
      }, 100);
    } catch (e) {
      shoutList.innerHTML = '<div class="sbx-error-text"><i class="fas fa-exclamation-triangle"></i><p>Failed to load messages</p><button class="sbx-btn-retry" onclick="location.reload()"><i class="fas fa-redo"></i> Retry</button></div>';
    }
  }

  // ---- Firebase ----
  function initFirebase() {
    try {
      if (typeof firebase === 'undefined') {
        console.warn('[shoutbox] Firebase SDK not loaded');
        return;
      }
      // Get the named app — created in base_dashboard.html
      let app;
      try {
        app = firebase.app('shoutbox');
      } catch (e) {
        console.warn('[shoutbox] named app "shoutbox" not found');
        return;
      }
      database = app.database();
      messagesRef = database.ref('shoutbox/messages');
      typingRef = database.ref('shoutbox/typing');
      onlineRef = database.ref('shoutbox/online/' + CURRENT_USER.id);

      database.ref('.info/connected').on('value', snap => {
        if (snap.val() === true) {
          onlineRef.set({
            name: CURRENT_USER.name,
            user_id: CURRENT_USER.id,
            picture: CURRENT_USER.picture,
            timestamp: firebase.database.ServerValue.TIMESTAMP
          });
          onlineRef.onDisconnect().remove();
          setupFirebaseListeners();
          setupTypingListener();
          console.log('[shoutbox] Firebase connected');
        }
      });
    } catch (e) {
      console.warn('[shoutbox] Firebase init failed:', e);
    }
  }
  function setupFirebaseListeners() {
    if (!messagesRef) return;
    messagesRef.orderByChild('timestamp')
      .startAt(lastMessageTimestamp + 1)
      .on('child_added', snapshot => {
        const data = snapshot.val();
        if (!data || !data.message) return;
        if (data.uid === CURRENT_USER.id && lastSentMessageId === data.id) {
          lastSentMessageId = null;
          return;
        }
        if (messageIds.has(String(data.id))) return;
        const isMine = data.uid === CURRENT_USER.id;
        const el = renderMessage(data, isMine);
        if (el) {
          shoutList.appendChild(el);
          lastMessageTimestamp = Math.max(lastMessageTimestamp, data.timestamp || 0);
          if (isAtBottom) setTimeout(() => { shoutList.scrollTop = shoutList.scrollHeight; }, 50);
        }
      });

        // Live-remove bubbles when another browser deletes a shout
    messagesRef.on('child_removed', snapshot => {
      const removedId = snapshot.key;
      if (!removedId) return;
      const el = shoutList.querySelector('.message-item[data-message-id="' + removedId + '"]');
      if (el) {
        el.style.transition = 'opacity 0.2s ease';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
      }
      messageIds.delete(String(removedId));
    });
  }

  function setupTypingListener() {
    if (!typingRef) return;
    typingRef.on('value', snap => updateTypingIndicator(snap.val()));
  }

  function updateTypingIndicator(data) {
    if (!data) { typingIndicator.classList.remove('active'); return; }
    const others = Object.entries(data)
      .filter(([uid, d]) => uid != CURRENT_USER.id && (Date.now() - (d.timestamp || 0)) < 2000)
      .map(([, d]) => d.name);
    if (!others.length) { typingIndicator.classList.remove('active'); return; }
    let text;
    if (others.length === 1) text = others[0] + ' is typing...';
    else if (others.length === 2) text = others[0] + ' and ' + others[1] + ' are typing...';
    else text = others[0] + ' and ' + (others.length - 1) + ' others are typing...';
    typingText.textContent = text;
    typingIndicator.classList.add('active');
  }

  function sendTypingStatus(nowTyping) {
    if (!typingRef) return;
    if (!nowTyping) typingRef.child(CURRENT_USER.id).remove();
    else typingRef.child(CURRENT_USER.id).set({ name: CURRENT_USER.name, timestamp: Date.now() });
  }

  function handleTyping() {
    if (shoutInput.value.trim().length === 0) {
      if (isTyping) { isTyping = false; sendTypingStatus(false); clearTimeout(typingTimeout); }
      return;
    }
    if (!isTyping) { isTyping = true; sendTypingStatus(true); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { isTyping = false; sendTypingStatus(false); }, 1500);
  }

  // ---- Send ----
  async function handleSubmit(e) {
    e.preventDefault();
    const message = shoutInput.value.trim();
    if (!message) return;
    if (message.length > 140) { toast('Message exceeds 140 characters', 'error'); return; }

    shoutInput.value = '';
    updateCharCount();
    document.getElementById('mentionSuggestions').classList.remove('show');

    const fd = new FormData();
    fd.append('message', message);

    try {
      const r = await fetch('/api/shouts/create/', {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() },
        body: fd
      });
      const d = await r.json();
      if (!d.success) { toast(d.error || 'Failed to send', 'error'); return; }

      // Clear the empty state if present
      const empty = shoutList.querySelector('.sbx-empty-state');
      if (empty) empty.remove();

      const real = {
        id: d.message_id,
        uid: CURRENT_USER.id,
        userName: CURRENT_USER.name,
        avatar: CURRENT_USER.picture,
        message: message,
        timestamp: d.timestamp,
        user: CURRENT_USER,
      };
      const el = renderMessage(real, true);
      if (el) shoutList.appendChild(el);
      if (isAtBottom) shoutList.scrollTop = shoutList.scrollHeight;

      // Mirror to Firebase
      if (messagesRef) {
        lastSentMessageId = d.message_id;
        await messagesRef.child(String(d.message_id)).set(real);
      }
    } catch (err) {
      console.error(err);
      toast('Failed to send message', 'error');
    }

    sendTypingStatus(false);
    isTyping = false;
    clearTimeout(typingTimeout);
  }

    // ---- Delete shout ----
  function confirmDeleteShout(shoutId, messageEl) {
    const overlay = document.getElementById('customConfirmOverlay');
    const box = document.getElementById('customConfirmBox');
    const title = document.getElementById('confirmTitle');
    const msg = document.getElementById('confirmMessage');
    const cancel = document.getElementById('confirmCancel');
    const ok = document.getElementById('confirmOk');
    if (!overlay || !box) return;

    title.textContent = 'Delete Shout';
    msg.textContent = 'Delete this shout? This cannot be undone.';
    overlay.classList.add('show');
    box.classList.add('show');

    const cleanup = () => {
      overlay.classList.remove('show');
      box.classList.remove('show');
      cancel.onclick = null;
      ok.onclick = null;
      overlay.onclick = null;
    };

    cancel.onclick = cleanup;
    overlay.onclick = cleanup;
    ok.onclick = async () => {
      cleanup();
      await deleteShout(shoutId, messageEl);
    };
  }

  async function deleteShout(shoutId, messageEl) {
    const fd = new FormData();
    fd.append('shout_id', shoutId);

    try {
      const r = await fetch('/api/shouts/delete/', {
        method: 'POST',
        headers: { 'X-CSRFToken': getCsrfToken() },
        body: fd
      });
      const d = await r.json();
      if (!d.success) {
        toast(d.error || 'Failed to delete', 'error');
        return;
      }

      // Optimistic remove
      if (messageEl && messageEl.parentElement) {
        messageEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'translateY(-6px)';
        setTimeout(() => messageEl.remove(), 200);
      }

      // Mirror delete to Firebase so other browsers drop it
      if (messagesRef) {
        try { await messagesRef.child(String(shoutId)).remove(); }
        catch (e) { console.warn('[shoutbox] firebase delete failed:', e); }
      }

      toast('Shout deleted', 'success');
    } catch (e) {
      console.error(e);
      toast('Failed to delete shout', 'error');
    }
  }
  
  // ---- Init ----
  function init() {
    setupMentionHandlers();
    loadInitialMessages().then(() => {
      initFirebase();
      shoutForm.addEventListener('submit', handleSubmit);
      shoutInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (shoutInput.value.trim()) handleSubmit(e);
        }
      });
      shoutList.addEventListener('scroll', checkScrollPosition);
      scrollToBottomBtn.addEventListener('click', scrollToBottom);
      updateCharCount();

      fetch('/api/shouts/friends/')
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            allUsers = d.users;
            console.log('[shoutbox] friends refreshed:', allUsers.length);
          }
        })
        .catch(e => console.warn('[shoutbox] friends fetch failed:', e));
    });   // ← closes the loadInitialMessages().then() callback
  }       // ← closes init()

  window.addEventListener('beforeunload', () => {
    if (onlineRef) onlineRef.remove();
    if (typingRef) typingRef.child(CURRENT_USER.id).remove();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();