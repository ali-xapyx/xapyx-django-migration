/**
 * chatroom_chat.js — Live Chat Room Messaging & Moderation (Task 18 Phase 4)
 */
(function () {
    'use strict';

    // ---- DOM Elements ----
    const chatroomMembersSidebar = document.getElementById('chatroomMembersSidebar');
    const chatroomBackdrop = document.getElementById('chatroomBackdrop');
    const memberCountBadge = document.getElementById('memberCountBadge');
    const membersList = document.getElementById('membersList');
    const chatroomMessagesContainer = document.getElementById('chatroomMessagesContainer');
    const chatroomLoadingState = document.getElementById('chatroomLoadingState');
    const chatroomMessageForm = document.getElementById('chatroomMessageForm');
    const chatroomMessageInput = document.getElementById('chatroomMessageInput');
    const chatroomSendBtn = document.getElementById('chatroomSendBtn');
    const chatroomEditBar = document.getElementById('chatroomEditBar');
    const chatroomEditText = document.getElementById('chatroomEditText');
    const chatroomEditCancelBtn = document.getElementById('chatroomEditCancelBtn');
    const chatroomTypingIndicator = document.getElementById('chatroomTypingIndicator');
    const chatroomTypingText = document.getElementById('chatroomTypingText');
    const mentionDropdown = document.getElementById('mentionDropdown');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const leaveRoomBtn = document.getElementById('leaveRoomBtn');

    // Report modal
    const reportMessageModalEl = document.getElementById('reportMessageModal');
    const reportMessageForm = document.getElementById('reportMessageForm');
    const reportTargetMsgId = document.getElementById('reportTargetMsgId');
    const reportReasonSelect = document.getElementById('reportReasonSelect');
    const reportCustomReasonWrap = document.getElementById('reportCustomReasonWrap');
    const reportCustomReason = document.getElementById('reportCustomReason');
    const submitReportBtn = document.getElementById('submitReportBtn');
    let bsReportModal = null;

    // Config & State
    let config = {
        roomId: 0,
        currentUserId: 0,
        isAdmin: false,
        isCreator: false,
        creatorId: 0,
        firebaseDbUrl: 'https://xapyx-chatroom-chat-default-rtdb.firebaseio.com'
    };

    const cfgEl = document.getElementById('chatroomConfig');
    if (cfgEl) {
        try {
            config = Object.assign(config, JSON.parse(cfgEl.textContent));
        } catch (e) {
            console.error('Failed to parse chatroomConfig:', e);
        }
    }

    let members = [];
    let knownMessageIds = new Set();
    let activeEdit = null; // { id, originalText }
    let firebaseDb = null;
    let fbMessagesRef = null;
    let fbTypingRef = null;
    let typingDebounceTimer = null;
    let isTyping = false;

    // Mobile Drawer
    window.openMemberList = function () {
        if (chatroomMembersSidebar) chatroomMembersSidebar.classList.add('open');
        if (chatroomBackdrop) chatroomBackdrop.classList.add('show');
    };

    window.closeMemberList = function () {
        if (chatroomMembersSidebar) chatroomMembersSidebar.classList.remove('open');
        if (chatroomBackdrop) chatroomBackdrop.classList.remove('show');
    };

    // ---- Utilities ----
    function getCsrfToken() {
        const inp = document.querySelector('[name=csrfmiddlewaretoken]');
        if (inp && inp.value) return inp.value;
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function escapeHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function getAvatarThumb(av) {
        if (!av || typeof av !== 'string') return '/static/images/avatars/default.png';
        if (av.indexOf('/static/images/avatars/default.png') !== -1) return av;
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(av) && av.indexOf('_avatar.webp') === -1) {
            return av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return av;
    }

    function scrollToBottom(smooth = false) {
        if (!chatroomMessagesContainer) return;
        requestAnimationFrame(() => {
            chatroomMessagesContainer.scrollTo({
                top: chatroomMessagesContainer.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
        });
    }

    // Format text with highlighted @mentions
    function formatMessageText(text) {
        if (!text) return '';
        const escaped = escapeHtml(text);
        // Replace @username with span
        return escaped.replace(/@([a-zA-Z0-9_]+)/g, '<span class="chatroom-mention">@$1</span>');
    }

    // ---- Firebase RTDB ----
    function initFirebase() {
        try {
            if (typeof firebase === 'undefined') {
                console.warn('[chatroom_chat.js] Firebase SDK not available');
                return;
            }
            const fbConfig = { databaseURL: config.firebaseDbUrl };
            let app;
            try {
                app = firebase.app('xapyx-chatroom-app');
            } catch (err) {
                app = firebase.initializeApp(fbConfig, 'xapyx-chatroom-app');
            }
            firebaseDb = firebase.database(app);
            console.log('[chatroom_chat.js] Firebase RTDB initialized for room', config.roomId);
            attachFirebaseListeners();
        } catch (e) {
            console.error('[chatroom_chat.js] Firebase init error:', e);
        }
    }

    function attachFirebaseListeners() {
        if (!firebaseDb || !config.roomId) return;

        // 1. Messages Stream
        fbMessagesRef = firebaseDb.ref(`chatrooms/${config.roomId}/messages`);

        // Real-time incoming messages
        fbMessagesRef.limitToLast(40).on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.id) return;
            const msgId = String(data.id);

            if (knownMessageIds.has(msgId)) return;
            knownMessageIds.add(msgId);

            if (chatroomLoadingState) chatroomLoadingState.style.display = 'none';

            const isMe = Number(data.sender_id) === Number(config.currentUserId);
            const timeStr = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            // Find sender avatar from loaded members if available
            const memberObj = members.find(m => Number(m.user_id) === Number(data.sender_id));
            const senderPic = memberObj ? memberObj.picture : '/static/images/avatars/default.png';

            const threshold = 150;
            const wasAtBottom = (chatroomMessagesContainer.scrollHeight - chatroomMessagesContainer.scrollTop - chatroomMessagesContainer.clientHeight) <= threshold;

            renderMessageRow({
                id: msgId,
                chatroom_id: config.roomId,
                user_id: data.sender_id,
                message: data.message || '',
                time: timeStr,
                edited: false,
                sender_name: data.sender_name || 'User',
                sender_picture: senderPic,
                is_me: isMe
            });

            if (isMe || wasAtBottom) {
                scrollToBottom(true);
            }
        });

        // Real-time edited messages
        fbMessagesRef.on('child_changed', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.id) return;
            const msgId = String(data.id);
            const row = chatroomMessagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
            if (row) {
                const textEl = row.querySelector('.chatroom-msg-text');
                if (textEl && data.message) {
                    textEl.innerHTML = formatMessageText(data.message);
                }
                const timeEl = row.querySelector('.chatroom-msg-time');
                if (timeEl && !timeEl.querySelector('.chat-edited-tag')) {
                    timeEl.insertAdjacentHTML('beforeend', ' <span class="chat-edited-tag">(edited)</span>');
                }
            }
        });

        // Real-time deleted messages
        fbMessagesRef.on('child_removed', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.id) return;
            const msgId = String(data.id);
            const row = chatroomMessagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
            if (row) row.remove();
        });

        // 2. Typing Indicator Listener
        fbTypingRef = firebaseDb.ref(`chatrooms/${config.roomId}/typing`);
        fbTypingRef.on('value', (snapshot) => {
            const val = snapshot.val();
            if (!val) {
                if (chatroomTypingIndicator) chatroomTypingIndicator.style.display = 'none';
                return;
            }

            // Find any other typing user
            let typingUserName = '';
            Object.keys(val).forEach(uid => {
                if (Number(uid) !== Number(config.currentUserId) && val[uid]) {
                    const m = members.find(mem => Number(mem.user_id) === Number(uid));
                    typingUserName = m ? m.name : 'Someone';
                }
            });

            if (typingUserName) {
                if (chatroomTypingText) chatroomTypingText.textContent = `${typingUserName} is typing...`;
                if (chatroomTypingIndicator) chatroomTypingIndicator.style.display = 'flex';
            } else {
                if (chatroomTypingIndicator) chatroomTypingIndicator.style.display = 'none';
            }
        });
    }

    // ---- Load Members & Messages ----
    async function loadMembers() {
        try {
            const res = await fetch(`/api/chatrooms/${config.roomId}/members/`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();
            if (!data.success) {
                membersList.innerHTML = `<div class="p-3 text-center text-danger">${escapeHtml(data.error || 'Failed to load members')}</div>`;
                return;
            }

            members = data.members || [];
            renderMembers(members);

        } catch (e) {
            console.error('loadMembers error:', e);
            membersList.innerHTML = '<div class="p-3 text-center text-muted">Error loading members</div>';
        }
    }

    function renderMembers(mList) {
        if (!membersList) return;

        if (memberCountBadge) {
            memberCountBadge.textContent = `${mList.length} member${mList.length !== 1 ? 's' : ''}`;
        }

        if (mList.length === 0) {
            membersList.innerHTML = '<div class="p-3 text-center text-muted">No members found</div>';
            return;
        }

        membersList.innerHTML = mList.map(m => {
            const avatarThumb = getAvatarThumb(m.picture);
            const onlineClass = m.is_online ? 'online' : 'offline';
            const adminBadge = m.is_creator ? '<span class="chatroom-admin-crown" title="Room Creator"><i class="fas fa-crown text-warning"></i></span>' :
                               (m.is_admin ? '<span class="chatroom-admin-star" title="Admin"><i class="fas fa-star text-info"></i></span>' : '');

            // Kick action: Admin or Creator can kick non-creator members (and not themselves)
            let kickBtnHtml = '';
            if (config.isAdmin && !m.is_creator && !m.is_me) {
                kickBtnHtml = `
                    <button type="button" class="btn btn-outline-danger btn-xs chatroom-kick-btn" onclick="window.__kickMember(${m.user_id}, '${escapeHtml(m.name)}')" title="Kick member">
                        <i class="fas fa-user-minus"></i>
                    </button>
                `;
            }

            return `
                <div class="chatroom-member-item ${m.is_me ? 'me' : ''}" data-user-id="${m.user_id}">
                    <div class="chatroom-member-avatar-wrap">
                        <img src="${avatarThumb}" onerror="this.onerror=null;this.src='/static/images/avatars/default.png'" data-full-src="${escapeHtml(m.picture || '/static/images/avatars/default.png')}" class="chatroom-member-avatar" alt="">
                        <span class="chatroom-member-status-dot ${onlineClass}"></span>
                    </div>
                    <div class="chatroom-member-info">
                        <div class="chatroom-member-name-wrap">
                            <span class="chatroom-member-name">${escapeHtml(m.name)}</span>
                            ${adminBadge}
                        </div>
                        <span class="chatroom-member-uname">@${escapeHtml(m.username || 'user')}</span>
                    </div>
                    <div class="chatroom-member-actions">
                        ${kickBtnHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    async function loadMessages() {
        try {
            const res = await fetch(`/api/chatrooms/${config.roomId}/messages/`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();
            if (!data.success) {
                chatroomMessagesContainer.innerHTML = `<div class="p-4 text-center text-danger">${escapeHtml(data.error || 'Failed to load messages')}</div>`;
                return;
            }

            chatroomMessagesContainer.innerHTML = '';
            const msgs = data.messages || [];

            if (msgs.length === 0) {
                chatroomMessagesContainer.innerHTML = `
                    <div class="chatroom-empty-state text-center py-5">
                        <i class="fas fa-comments fa-3x text-muted opacity-50 mb-3"></i>
                        <h5>Welcome to the Chat Room!</h5>
                        <p class="text-muted">No messages yet. Send a message to get the discussion started.</p>
                    </div>
                `;
            } else {
                msgs.forEach(m => {
                    knownMessageIds.add(String(m.id));
                    renderMessageRow(m);
                });
                scrollToBottom(false);
            }

        } catch (e) {
            console.error('loadMessages error:', e);
            chatroomMessagesContainer.innerHTML = '<div class="p-4 text-center text-danger">Error loading messages</div>';
        }
    }

    function renderMessageRow(msg) {
        const isSent = Boolean(msg.is_me);
        const row = document.createElement('div');
        row.className = `chatroom-msg-row ${isSent ? 'sent' : 'received'}`;
        row.dataset.msgId = msg.id;

        const avatarThumb = getAvatarThumb(msg.sender_picture);
        const avatarHtml = `
            <div class="chatroom-msg-avatar-wrap">
                <img src="${avatarThumb}" onerror="this.onerror=null;this.src='/static/images/avatars/default.png'" data-full-src="${escapeHtml(msg.sender_picture || '/static/images/avatars/default.png')}" class="chatroom-msg-avatar" alt="">
            </div>
        `;

        // Action Toolbar (Hover: Edit, Delete, Report)
        let actionsHtml = '<div class="chatroom-msg-actions">';
        if (isSent) {
            actionsHtml += `
                <button type="button" class="chatroom-msg-action-btn" title="Edit" onclick="window.__triggerEditMsg('${msg.id}')">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button type="button" class="chatroom-msg-action-btn danger" title="Delete" onclick="window.__triggerDeleteMsg('${msg.id}')">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
        } else {
            if (config.isAdmin) {
                actionsHtml += `
                    <button type="button" class="chatroom-msg-action-btn danger" title="Delete (Admin)" onclick="window.__triggerDeleteMsg('${msg.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                `;
            }
            actionsHtml += `
                <button type="button" class="chatroom-msg-action-btn" title="Report" onclick="window.__triggerReportMsg('${msg.id}')">
                    <i class="fas fa-flag"></i>
                </button>
            `;
        }
        actionsHtml += '</div>';

        const senderHeader = !isSent ? `<div class="chatroom-msg-sender-name">${escapeHtml(msg.sender_name)}</div>` : '';
        const editedTag = msg.edited ? ' <span class="chat-edited-tag">(edited)</span>' : '';
        const timeHtml = `<div class="chatroom-msg-time">${escapeHtml(msg.time || '')}${editedTag}</div>`;
        const textContent = `<div class="chatroom-msg-text">${formatMessageText(msg.message)}</div>`;

        const bubbleHtml = `
            <div class="chatroom-bubble ${isSent ? 'sent' : 'received'}">
                ${senderHeader}
                ${textContent}
                ${timeHtml}
            </div>
            ${actionsHtml}
        `;

        row.innerHTML = isSent ? (bubbleHtml + avatarHtml) : (avatarHtml + bubbleHtml);
        chatroomMessagesContainer.appendChild(row);
    }

    // ---- Send & Edit Message ----
    async function sendMessage() {
        const text = chatroomMessageInput.value.trim();
        if (!text) return;

        // If editing
        if (activeEdit) {
            const editId = activeEdit.id;
            try {
                const formData = new FormData();
                formData.append('message', text);

                const res = await fetch(`/api/chatrooms/${config.roomId}/messages/${editId}/edit/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    const row = chatroomMessagesContainer.querySelector(`[data-msg-id="${editId}"]`);
                    if (row) {
                        const textEl = row.querySelector('.chatroom-msg-text');
                        if (textEl) textEl.innerHTML = formatMessageText(text);
                        const timeEl = row.querySelector('.chatroom-msg-time');
                        if (timeEl && !timeEl.querySelector('.chat-edited-tag')) {
                            timeEl.insertAdjacentHTML('beforeend', ' <span class="chat-edited-tag">(edited)</span>');
                        }
                    }
                    cancelEdit();
                } else {
                    alert(data.error || 'Failed to edit message');
                }
            } catch (e) {
                console.error('edit message error:', e);
            }
            return;
        }

        chatroomMessageInput.value = '';
        chatroomMessageInput.style.height = 'auto';
        if (chatroomSendBtn) chatroomSendBtn.disabled = true;

        // Stop typing immediately
        clearTyping();

        try {
            const formData = new FormData();
            formData.append('message', text);

            const res = await fetch(`/api/chatrooms/${config.roomId}/messages/send/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });
            const data = await res.json();
            if (data.success && data.message) {
                const msg = data.message;
                if (!knownMessageIds.has(String(msg.id))) {
                    knownMessageIds.add(String(msg.id));
                    const emptyState = chatroomMessagesContainer.querySelector('.chatroom-empty-state');
                    if (emptyState) emptyState.remove();

                    renderMessageRow(msg);
                    scrollToBottom(true);
                }
            } else {
                alert(data.error || 'Failed to send message');
                chatroomMessageInput.value = text;
            }
        } catch (e) {
            console.error('sendMessage error:', e);
            alert('Error sending message');
            chatroomMessageInput.value = text;
        } finally {
            if (chatroomSendBtn) chatroomSendBtn.disabled = false;
        }
    }

    // ---- Edit Handlers ----
    window.__triggerEditMsg = function (msgId) {
        const row = chatroomMessagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
        if (!row) return;

        const textEl = row.querySelector('.chatroom-msg-text');
        if (!textEl) return;
        const text = textEl.textContent.trim();

        activeEdit = { id: msgId, originalText: text };

        if (chatroomEditText) chatroomEditText.textContent = text.length > 50 ? text.slice(0, 50) + '...' : text;
        if (chatroomEditBar) chatroomEditBar.style.display = 'flex';

        chatroomMessageInput.value = text;
        chatroomMessageInput.focus();
        chatroomMessageInput.style.height = 'auto';
        chatroomMessageInput.style.height = Math.min(chatroomMessageInput.scrollHeight, 120) + 'px';
    };

    function cancelEdit() {
        if (activeEdit && chatroomMessageInput && chatroomMessageInput.value === activeEdit.originalText) {
            chatroomMessageInput.value = '';
            chatroomMessageInput.style.height = 'auto';
        }
        activeEdit = null;
        if (chatroomEditBar) chatroomEditBar.style.display = 'none';
    }

    if (chatroomEditCancelBtn) {
        chatroomEditCancelBtn.addEventListener('click', cancelEdit);
    }

    // ---- Delete Handler ----
    window.__triggerDeleteMsg = async function (msgId) {
        if (!confirm('Are you sure you want to delete this message?')) return;
        try {
            const res = await fetch(`/api/chatrooms/${config.roomId}/messages/${msgId}/delete/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await res.json();
            if (data.success) {
                const row = chatroomMessagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
                if (row) row.remove();
            } else {
                alert(data.error || 'Failed to delete message');
            }
        } catch (e) {
            console.error('deleteMsg error:', e);
        }
    };

    // ---- Report Handler ----
    window.__triggerReportMsg = function (msgId) {
        if (!reportMessageModalEl) return;
        reportTargetMsgId.value = msgId;
        reportReasonSelect.value = 'Spam or advertising';
        if (reportCustomReasonWrap) reportCustomReasonWrap.classList.add('d-none');
        if (reportCustomReason) reportCustomReason.value = '';
        if (bsReportModal) bsReportModal.show();
    };

    if (reportReasonSelect) {
        reportReasonSelect.addEventListener('change', () => {
            if (reportCustomReasonWrap) {
                reportCustomReasonWrap.classList.toggle('d-none', reportReasonSelect.value !== 'other');
            }
        });
    }

    if (reportMessageForm) {
        reportMessageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msgId = reportTargetMsgId.value;
            let reason = reportReasonSelect.value;
            if (reason === 'other' && reportCustomReason) {
                reason = reportCustomReason.value.trim() || 'Other violation';
            }

            if (submitReportBtn) submitReportBtn.disabled = true;

            try {
                const formData = new FormData();
                formData.append('reason', reason);

                const res = await fetch(`/api/chatrooms/${config.roomId}/messages/${msgId}/report/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    if (bsReportModal) bsReportModal.hide();
                    alert('Message has been reported to moderators. Thank you.');
                } else {
                    alert(data.error || 'Failed to report message');
                }
            } catch (err) {
                console.error('report error:', err);
            } finally {
                if (submitReportBtn) submitReportBtn.disabled = false;
            }
        });
    }

    // ---- Kick Member Handler ----
    window.__kickMember = async function (uid, uname) {
        if (!confirm(`Are you sure you want to remove ${uname} from this chat room?`)) return;
        try {
            const res = await fetch(`/api/chatrooms/${config.roomId}/members/${uid}/remove/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await res.json();
            if (data.success) {
                loadMembers();
            } else {
                alert(data.error || 'Failed to remove member');
            }
        } catch (e) {
            console.error('kick error:', e);
        }
    };

    // ---- Clear History & Leave Room ----
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to clear all message history for this room? This cannot be undone.')) return;
            try {
                const res = await fetch(`/api/chatrooms/${config.roomId}/clear/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() }
                });
                const data = await res.json();
                if (data.success) {
                    chatroomMessagesContainer.innerHTML = `
                        <div class="chatroom-empty-state text-center py-5">
                            <i class="fas fa-broom fa-3x text-muted opacity-50 mb-3"></i>
                            <h5>Message History Cleared</h5>
                            <p class="text-muted">The room creator cleared all past messages.</p>
                        </div>
                    `;
                } else {
                    alert(data.error || 'Failed to clear history');
                }
            } catch (e) {
                console.error('clear history error:', e);
            }
        });
    }

    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to leave this chat room?')) return;
            try {
                const res = await fetch(`/api/chatrooms/${config.roomId}/exit/`, {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() }
                });
                const data = await res.json();
                if (data.success) {
                    window.location.href = '/chatrooms/';
                } else {
                    alert(data.error || 'Failed to leave room');
                }
            } catch (e) {
                console.error('leave room error:', e);
            }
        });
    }

    // ---- Typing Indicator ----
    function notifyTyping() {
        if (!firebaseDb || !config.roomId) return;
        if (!isTyping) {
            isTyping = true;
            firebaseDb.ref(`chatrooms/${config.roomId}/typing/${config.currentUserId}`).set(true).catch(() => {});
        }
        if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
        typingDebounceTimer = setTimeout(clearTyping, 3000);
    }

    function clearTyping() {
        isTyping = false;
        if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
        if (firebaseDb && config.roomId) {
            firebaseDb.ref(`chatrooms/${config.roomId}/typing/${config.currentUserId}`).remove().catch(() => {});
        }
    }

    // ---- @mention Autocomplete ----
    function handleMentionAutocomplete() {
        const val = chatroomMessageInput.value;
        const pos = chatroomMessageInput.selectionStart;
        const beforeCursor = val.slice(0, pos);
        const match = beforeCursor.match(/@([a-zA-Z0-9_]*)$/);

        if (!match) {
            hideMentionDropdown();
            return;
        }

        const query = match[1].toLowerCase();
        const matchedMembers = members.filter(m =>
            m.username.toLowerCase().startsWith(query) ||
            m.name.toLowerCase().startsWith(query)
        ).slice(0, 5);

        if (matchedMembers.length === 0) {
            hideMentionDropdown();
            return;
        }

        renderMentionDropdown(matchedMembers, match.index);
    }

    function renderMentionDropdown(mList, atIndex) {
        if (!mentionDropdown) return;
        mentionDropdown.innerHTML = mList.map(m => `
            <div class="chatroom-mention-item" data-username="${escapeHtml(m.username)}" data-at-index="${atIndex}">
                <img src="${getAvatarThumb(m.picture)}" data-full-src="${escapeHtml(m.picture || '/static/images/avatars/default.png')}" class="mention-avatar" alt="">
                <div class="mention-info">
                    <span class="mention-name">${escapeHtml(m.name)}</span>
                    <span class="mention-uname">@${escapeHtml(m.username)}</span>
                </div>
            </div>
        `).join('');

        mentionDropdown.style.display = 'block';

        mentionDropdown.querySelectorAll('.chatroom-mention-item').forEach(el => {
            el.addEventListener('click', () => {
                insertMention(el.dataset.username, Number(el.dataset.atIndex));
            });
        });
    }

    function insertMention(username, atIndex) {
        const val = chatroomMessageInput.value;
        const pos = chatroomMessageInput.selectionStart;
        const beforeAt = val.slice(0, atIndex);
        const afterCursor = val.slice(pos);

        chatroomMessageInput.value = `${beforeAt}@${username} ${afterCursor}`;
        const newCursor = atIndex + username.length + 2;
        chatroomMessageInput.setSelectionRange(newCursor, newCursor);
        chatroomMessageInput.focus();
        hideMentionDropdown();
    }

    function hideMentionDropdown() {
        if (mentionDropdown) mentionDropdown.style.display = 'none';
    }

    // ---- Event Listeners ----
    if (chatroomMessageForm) {
        chatroomMessageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendMessage();
        });
    }

    if (chatroomMessageInput) {
        chatroomMessageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // If mention dropdown is open and user presses enter, pick first
                if (mentionDropdown && mentionDropdown.style.display === 'block') {
                    const first = mentionDropdown.querySelector('.chatroom-mention-item');
                    if (first) {
                        e.preventDefault();
                        insertMention(first.dataset.username, Number(first.dataset.atIndex));
                        return;
                    }
                }
                e.preventDefault();
                sendMessage();
            } else if (e.key === 'Escape') {
                hideMentionDropdown();
            }
        });

        chatroomMessageInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            notifyTyping();
            handleMentionAutocomplete();
        });

        chatroomMessageInput.addEventListener('blur', () => {
            setTimeout(hideMentionDropdown, 200);
            clearTyping();
        });
    }

    // ---- Init ----
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof bootstrap !== 'undefined' && reportMessageModalEl) {
            bsReportModal = new bootstrap.Modal(reportMessageModalEl);
        }
        initFirebase();
        loadMembers();
        loadMessages();
    });

})();
