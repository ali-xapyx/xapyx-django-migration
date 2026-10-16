/**
 * chat.js — 1-on-1 Direct Messages (Task 18 Phase 1 & 2)
 * Features:
 * - Real-time sync with Firebase RTDB
 * - Media attachments (images, videos, audio, files) with direct S3 upload
 * - Voice notes (Web Audio MediaRecorder)
 * - Emoji reactions with real-time sync
 * - Typing indicators with 3s debounce
 * - Read receipts ("Seen")
 * - Reply-to quotes & message threading
 * - Edit & Soft-delete
 */
(function () {
    'use strict';

    // ---- DOM Elements ----
    const chatSidebar = document.getElementById('chatSidebar');
    const chatBackdrop = document.getElementById('chatBackdrop');
    const conversationsList = document.getElementById('conversationsList');
    const convCount = document.getElementById('convCount');
    const chatSearchInput = document.getElementById('chatSearchInput');
    const chatHeader = document.getElementById('chatHeader');
    const chatAvatar = document.getElementById('chatAvatar');
    const chatOnlineDot = document.getElementById('chatHeaderDot') || document.getElementById('chatOnlineDot');
    const chatName = document.getElementById('chatHeaderName') || document.getElementById('chatName');
    const chatStatus = document.getElementById('chatHeaderStatus') || document.getElementById('chatStatus');
    const chatProfileLink = document.getElementById('chatProfileLink');
    const messagesContainer = document.getElementById('messagesContainer');
    const emptyStatePlaceholder = document.getElementById('emptyStatePlaceholder');
    const inputArea = document.getElementById('inputArea');
    const messageForm = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');

    // Phase 2 Elements
    const chatAttachBtn = document.getElementById('chatAttachBtn');
    const chatFileInput = document.getElementById('chatFileInput');
    const chatVoiceBtn = document.getElementById('chatVoiceBtn');
    const chatVoiceRecordingBar = document.getElementById('chatVoiceRecordingBar');
    const chatVoiceTimer = document.getElementById('chatVoiceTimer');
    const chatVoiceCancelBtn = document.getElementById('chatVoiceCancelBtn');
    const chatVoiceSendBtn = document.getElementById('chatVoiceSendBtn');
    const chatReplyPreview = document.getElementById('chatReplyPreview');
    const chatReplyUser = document.getElementById('chatReplyUser');
    const chatReplyText = document.getElementById('chatReplyText');
    const chatReplyCancelBtn = document.getElementById('chatReplyCancelBtn');
    const chatEditBar = document.getElementById('chatEditBar');
    const chatEditText = document.getElementById('chatEditText');
    const chatEditCancelBtn = document.getElementById('chatEditCancelBtn');
    const chatTypingIndicator = document.getElementById('chatTypingIndicator');
    const chatTypingText = document.getElementById('chatTypingText');
    const chatUploadProgress = document.getElementById('chatUploadProgress');
    const chatUploadProgressText = document.getElementById('chatUploadProgressText');

    // ---- Config & State ----
    let config = {
        selectedFriendId: 0,
        currentUserId: 0,
        firebaseDbUrl: 'https://xapyx-chat-default-rtdb.firebaseio.com'
    };

    const cfgEl = document.getElementById('chatConfig');
    if (cfgEl) {
        try {
            config = Object.assign(config, JSON.parse(cfgEl.textContent));
        } catch (e) {
            console.error('Failed to parse chatConfig:', e);
        }
    }

    let conversations = [];
    let activeFriendId = null;
    let activeChatId = null;
    let activeFriend = null;
    let knownMessageIds = new Set();
    let currentLastReadTimestamp = 0;

    // Phase 2 State
    let activeReply = null; // { id, name, text }
    let activeEdit = null;  // { id, originalText }
    let isTyping = false;
    let typingDebounceTimer = null;

    // Voice Recorder State
    let mediaRecorder = null;
    let audioStream = null;
    let audioChunks = [];
    let voiceRecordingTimerInterval = null;
    let voiceRecordingSeconds = 0;

    // Firebase Refs
    let firebaseDb = null;
    let fbMessagesRef = null;
    let fbTypingRef = null;
    let fbReadRef = null;
    let fbFriendPresenceRef = null;

    // ---- Mobile Drawer & Full-Screen Swap Helpers (FIX 1) ----
    function closeMobileThread(useHistory = true) {
        const wrap = document.querySelector('.chat-wrap') || document.querySelector('.page-inbox-wrap');
        if (wrap) {
            wrap.classList.remove('mobile-thread-open');
        }
        document.querySelectorAll('.page-inbox-conv-item').forEach(el => el.classList.remove('active'));
        activeFriendId = null;
        activeChatId = null;
        activeFriend = null;

        if (typeof syncPollingTimer !== 'undefined' && syncPollingTimer) {
            clearInterval(syncPollingTimer);
            syncPollingTimer = null;
        }

        if (useHistory && history.state && history.state.chatThreadOpen) {
            history.back();
        }
    }
    window.closeMobileThread = closeMobileThread;

    window.addEventListener('popstate', function () {
        const wrap = document.querySelector('.chat-wrap') || document.querySelector('.page-inbox-wrap');
        if (wrap && wrap.classList.contains('mobile-thread-open')) {
            closeMobileThread(false);
        }
    });

    window.openChatSidebar = function () {
        if (chatSidebar) chatSidebar.classList.add('open');
        if (chatBackdrop) chatBackdrop.classList.add('show');
    };

    window.closeChatSidebar = function () {
        if (chatSidebar) chatSidebar.classList.remove('open');
        if (chatBackdrop) chatBackdrop.classList.remove('show');
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

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatDuration(sec) {
        if (!sec || isNaN(sec)) return '0:00';
        sec = Math.floor(sec);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
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
        const chatContainer = document.getElementById('chatMessagesContainer') ||
                              document.querySelector('.chat-messages-scroll-area') ||
                              messagesContainer ||
                              document.getElementById('messagesContainer') ||
                              document.querySelector('.page-inbox-messages-container');
        if (!chatContainer) return;

        chatContainer.scrollTop = chatContainer.scrollHeight;
        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
        setTimeout(() => {
            if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 60);
    }

    function getMsgTimestamp(msg) {
        if (!msg) return 0;
        if (msg.created_at) {
            let str = String(msg.created_at).trim().replace(' ', 'T');
            if (!str.endsWith('Z') && !str.includes('+') && !/-\d{2}:\d{2}$/.test(str)) {
                str += 'Z';
            }
            const parsed = new Date(str).getTime();
            if (!isNaN(parsed)) return Math.floor(parsed / 1000);
        }
        if (msg.timestamp) {
            const ts = Number(msg.timestamp);
            if (!isNaN(ts) && ts > 0) {
                return ts > 10000000000 ? Math.floor(ts / 1000) : ts;
            }
        }
        return 0;
    }

    function formatMessageTime(msg) {
        if (!msg) return '';
        let d = null;
        if (typeof msg === 'number') {
            const ts = msg > 10000000000 ? msg : msg * 1000;
            d = new Date(ts);
        } else if (msg instanceof Date) {
            d = msg;
        } else if (typeof msg === 'object') {
            if (msg.created_at) {
                let str = String(msg.created_at).trim().replace(' ', 'T');
                if (!str.endsWith('Z') && !str.includes('+') && !/-\d{2}:\d{2}$/.test(str)) {
                    str += 'Z';
                }
                const parsed = new Date(str);
                if (!isNaN(parsed.getTime())) {
                    d = parsed;
                }
            }
            if (!d && msg.timestamp) {
                const num = Number(msg.timestamp);
                if (!isNaN(num) && num > 0) {
                    const ts = num > 10000000000 ? num : num * 1000;
                    d = new Date(ts);
                }
            }
        }
        if (d && !isNaN(d.getTime())) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (msg && typeof msg.time === 'string' && msg.time.trim()) {
            return msg.time;
        }
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatRelativeTime(input) {
        if (!input) return 'Just now';
        let ms = 0;
        if (typeof input === 'number') {
            ms = input > 10000000000 ? input : input * 1000;
        } else if (input instanceof Date) {
            ms = input.getTime();
        } else if (typeof input === 'string') {
            let str = input.trim();
            if (/^\d+$/.test(str)) {
                const num = Number(str);
                ms = num > 10000000000 ? num : num * 1000;
            } else {
                str = str.replace(' ', 'T');
                if (!str.endsWith('Z') && !str.includes('+') && !/-\d{2}:\d{2}$/.test(str)) {
                    str += 'Z';
                }
                const parsed = new Date(str).getTime();
                ms = isNaN(parsed) ? 0 : parsed;
            }
        }
        if (!ms || isNaN(ms)) return 'Just now';

        const now = Date.now();
        const diffSec = Math.max(0, Math.floor((now - ms) / 1000));

        if (diffSec < 60) {
            return 'Just now';
        }
        if (diffSec < 3600) {
            return `${Math.floor(diffSec / 60)}m ago`;
        }
        if (diffSec < 86400) {
            return `${Math.floor(diffSec / 3600)}h ago`;
        }
        if (diffSec < 604800) {
            return `${Math.floor(diffSec / 86400)}d ago`;
        }
        if (diffSec < 2592000) {
            return `${Math.floor(diffSec / 604800)}w ago`;
        }
        return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function insertMessageInOrder(container, row, curTs, curId) {
        if (curId && container.querySelector(`[data-msg-id="${curId}"]`)) {
            return;
        }
        const existingRows = container.querySelectorAll('.page-inbox-msg-row');
        if (!existingRows.length) {
            container.appendChild(row);
            return;
        }
        for (let i = existingRows.length - 1; i >= 0; i--) {
            const exRow = existingRows[i];
            const exId = Number(exRow.dataset.msgId) || 0;
            const exTs = Number(exRow.dataset.timestamp) || 0;
            if (curId && exId) {
                if (exId <= curId) {
                    exRow.after(row);
                    return;
                }
            } else {
                if (exTs <= curTs) {
                    exRow.after(row);
                    return;
                }
            }
        }
        container.prepend(row);
    }

    function showUploadProgress(text) {
        if (chatUploadProgress) {
            if (chatUploadProgressText) chatUploadProgressText.textContent = text || 'Uploading...';
            chatUploadProgress.style.display = 'flex';
        }
    }

    function hideUploadProgress() {
        if (chatUploadProgress) {
            chatUploadProgress.style.display = 'none';
        }
    }

    // ---- Firebase RTDB ----
    let fbUserInboxRef = null;

    function attachUserInboxListener() {
        if (!firebaseDb || !config.currentUserId) return;
        if (fbUserInboxRef) return;

        fbUserInboxRef = firebaseDb.ref('user_chats/' + config.currentUserId);

        let initialChildrenLoaded = false;
        fbUserInboxRef.once('value').then(() => {
            initialChildrenLoaded = true;
        }).catch(() => {
            initialChildrenLoaded = true;
        });

        const handleInboxMessage = (snapshot, isNewChange = false) => {
            const data = snapshot.val();
            if (!data) return;

            const senderId = Number(data.sender_id);
            const receiverId = Number(data.receiver_id);
            const friendId = senderId === Number(config.currentUserId) ? receiverId : senderId;
            if (!friendId) return;

            const isIncoming = senderId !== Number(config.currentUserId);
            const content = data.content || data.last_message || '';

            // Update snippet in conversation list and move to top
            updateConvSnippet(friendId, content, data.timestamp || data.created_at);

            // If this friend's conversation is currently open
            if (activeFriendId && Number(activeFriendId) === friendId) {
                const msgId = String(data.msg_id || data.id || '');
                if (msgId && !knownMessageIds.has(msgId) && !messagesContainer.querySelector(`[data-msg-id="${msgId}"]`)) {
                    knownMessageIds.add(msgId);
                    const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
                    if (emptyChat) emptyChat.remove();

                    const isMe = senderId === Number(config.currentUserId);
                    const timeStr = formatMessageTime(data);

                    renderMessageRow({
                        id: msgId,
                        sender_id: senderId,
                        message: content,
                        message_type: data.message_type || 'text',
                        media_url: data.media_url || data.s3_url || '',
                        s3_url: data.s3_url || '',
                        duration: data.duration || 0,
                        reply_to: data.reply_to || null,
                        reply_snippet: null,
                        is_read: false,
                        time: timeStr,
                        timestamp: data.timestamp,
                        created_at: data.created_at,
                        sender_name: data.sender_name || (isMe ? 'You' : (activeFriend ? activeFriend.name : 'User')),
                        sender_picture: isMe ? (window.XPY_CONFIG && window.XPY_CONFIG.userPicture) : (activeFriend ? activeFriend.picture : ''),
                        reactions: []
                    });
                    scrollToBottom(true);
                    if (isIncoming) {
                        markConversationRead(activeFriendId);
                    }
                }
            } else if (isIncoming && isNewChange && initialChildrenLoaded) {
                // Only increment for genuine incoming unread messages received while connected
                if (!data.is_read && data.unread !== 0) {
                    incrementUnreadBadge(friendId);
                }
            }
        };

        fbUserInboxRef.on('child_added', (snap) => handleInboxMessage(snap, false));
        fbUserInboxRef.on('child_changed', (snap) => handleInboxMessage(snap, true));
    }


    // ---- Live Presence Indicator Management ----
    window.updateUserPresence = function(userId, isOnline) {
        if (!userId) return;
        const onlineState = Boolean(isOnline);
        
        // Update all matching list elements
        document.querySelectorAll(`.status-dot[data-user-id="${userId}"]`).forEach(dot => {
            dot.classList.toggle('online', onlineState);
            dot.classList.toggle('offline', !onlineState);
        });

        // Update header if the active conversation matches this user
        if (typeof activeFriendId !== 'undefined' && Number(activeFriendId) === Number(userId)) {
            if (typeof activeFriend !== 'undefined' && activeFriend) {
                activeFriend.online = onlineState;
                activeFriend.is_online = onlineState;
            }
            const chatStatusEl = document.getElementById('chatHeaderStatus') || document.getElementById('chatStatus');
            const chatOnlineDotEl = document.getElementById('chatHeaderDot') || document.getElementById('chatOnlineDot');
            if (chatStatusEl) {
                chatStatusEl.textContent = onlineState ? 'Online' : 'Offline';
            }
            if (chatOnlineDotEl) {
                chatOnlineDotEl.dataset.userId = userId;
                chatOnlineDotEl.classList.toggle('online', onlineState);
                chatOnlineDotEl.classList.toggle('offline', !onlineState);
            }
        }
    };

    function attachFriendPresenceListener(friendId) {
        if (fbFriendPresenceRef) {
            fbFriendPresenceRef.off();
            fbFriendPresenceRef = null;
        }
        if (!firebaseDb || !friendId) return;

        fbFriendPresenceRef = firebaseDb.ref('presence/' + friendId);
        fbFriendPresenceRef.on('value', (snapshot) => {
            const val = snapshot.val();
            let isOnline = false;
            if (val !== null && val !== undefined) {
                isOnline = (typeof val === 'object' && val !== null) ? Boolean(val.online) : Boolean(val);
            }
            if (typeof window.updateUserPresence === 'function') {
                window.updateUserPresence(friendId, isOnline);
            }
        });
    }

    function setupFirebasePresence() {
        if (!firebaseDb || !config.currentUserId) return;
        try {
            const userPresenceRef = firebaseDb.ref('presence/' + config.currentUserId);
            const connectedRef = firebaseDb.ref('.info/connected');

            connectedRef.on('value', (snap) => {
                if (snap.val() === true) {
                    userPresenceRef.set({
                        online: true,
                        last_changed: firebase.database.ServerValue.TIMESTAMP
                    });
                    userPresenceRef.onDisconnect().set({
                        online: false,
                        last_changed: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            });

            // Listen to global presence updates from peers
            const allPresenceRef = firebaseDb.ref('presence');
            allPresenceRef.on('child_added', (snap) => {
                const uid = snap.key;
                if (!uid || Number(uid) === Number(config.currentUserId)) return;
                const val = snap.val();
                const isOnline = (typeof val === 'object' && val !== null) ? Boolean(val.online) : Boolean(val);
                window.updateUserPresence(uid, isOnline);
            });
            allPresenceRef.on('child_changed', (snap) => {
                const uid = snap.key;
                if (!uid || Number(uid) === Number(config.currentUserId)) return;
                const val = snap.val();
                const isOnline = (typeof val === 'object' && val !== null) ? Boolean(val.online) : Boolean(val);
                window.updateUserPresence(uid, isOnline);
            });
        } catch (err) {
            console.warn('[chat.js] setupFirebasePresence error:', err);
        }
    }

    function initFirebase() {
        try {
            if (typeof firebase === 'undefined') {
                console.warn('[chat.js] Firebase SDK not loaded');
                return;
            }
            const fbConfig = { databaseURL: config.firebaseDbUrl };
            let app;
            try {
                app = firebase.app('xapyx-chat-app');
            } catch (err) {
                app = firebase.initializeApp(fbConfig, 'xapyx-chat-app');
            }
            firebaseDb = firebase.database(app);
            console.log('[chat.js] Firebase RTDB initialized');
            attachUserInboxListener();
            setupFirebasePresence();
            if (activeFriendId) {
                attachFriendPresenceListener(activeFriendId);
            }
        } catch (e) {
            console.error('[chat.js] Firebase init error:', e);
        }
    }

    function detachFirebaseListeners() {
        if (fbMessagesRef) { fbMessagesRef.off(); fbMessagesRef = null; }
        if (fbTypingRef) { fbTypingRef.off(); fbTypingRef = null; }
        if (fbReadRef) { fbReadRef.off(); fbReadRef = null; }
        if (fbFriendPresenceRef) { fbFriendPresenceRef.off(); fbFriendPresenceRef = null; }
    }

    function attachFirebaseListeners(chatId) {
        detachFirebaseListeners();
        if (!firebaseDb || !chatId) return;

        // 1. Messages Stream (New, Edited, Deleted, Reactions)
        fbMessagesRef = firebaseDb.ref('chats/' + chatId + '/messages');

        // New incoming message
        fbMessagesRef.limitToLast(30).on('child_added', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.id) return;
            const msgId = String(data.id);

            if (knownMessageIds.has(msgId) || messagesContainer.querySelector(`[data-msg-id="${msgId}"]`)) return;
            knownMessageIds.add(msgId);

            const isMe = Number(data.sender_id) === Number(config.currentUserId);
            const timeStr = formatMessageTime(data);

            // Remove empty placeholder
            const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
            if (emptyChat) emptyChat.remove();

            const threshold = 150;
            const wasAtBottom = (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight) <= threshold;

            renderMessageRow({
                id: msgId,
                sender_id: data.sender_id,
                message: data.content || '',
                message_type: data.message_type || 'text',
                media_url: data.media_url || data.s3_url || '',
                s3_url: data.s3_url || '',
                duration: data.duration || 0,
                reply_to: data.reply_to || null,
                reply_snippet: null,
                is_read: false,
                time: timeStr,
                timestamp: data.timestamp,
                created_at: data.created_at,
                sender_name: data.sender_name || (isMe ? 'You' : (activeFriend ? activeFriend.name : 'User')),
                sender_picture: isMe ? (window.XPY_CONFIG && window.XPY_CONFIG.userPicture) : (activeFriend ? activeFriend.picture : ''),
                reactions: []
            });

            if (isMe || wasAtBottom) {
                scrollToBottom(true);
            }
            updateConvSnippet(activeFriendId, data.content || '', data.timestamp || data.created_at);

            if (!isMe) {
                markConversationRead(activeFriendId);
            }
        });

        // Message changed (e.g. edited, reactions updated)
        fbMessagesRef.on('child_changed', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.id) return;
            const msgId = String(data.id);
            const row = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
            if (!row) return;

            // Update content if edited
            if (data.edited) {
                const textEl = row.querySelector('.page-inbox-msg-text');
                if (textEl && textEl.textContent !== data.content) {
                    textEl.textContent = data.content;
                    if (!row.querySelector('.chat-edited-tag')) {
                        const timeEl = row.querySelector('.page-inbox-msg-time');
                        if (timeEl) {
                            timeEl.insertAdjacentHTML('beforeend', ' <span class="chat-edited-tag">(edited)</span>');
                        }
                    }
                }
            }

            // Update reactions if present
            if (data.reactions) {
                const reactionsList = [];
                Object.keys(data.reactions).forEach(uid => {
                    const item = data.reactions[uid];
                    if (item && item.reaction) {
                        reactionsList.push({
                            user_id: Number(uid),
                            reaction: item.reaction,
                            name: item.name || 'User'
                        });
                    }
                });
                renderReactionsInRow(row, reactionsList, msgId);
            }
        });

        // Message deleted
        fbMessagesRef.on('child_removed', (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.id) return;
            const msgId = String(data.id);
            const row = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
            if (row) {
                row.remove();
            }
        });

        // 2. Typing Indicator Listener
        fbTypingRef = firebaseDb.ref('chats/' + chatId + '/typing/' + activeFriendId);
        fbTypingRef.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val && val.typing) {
                const friendName = activeFriend ? activeFriend.name : 'Friend';
                if (chatTypingText) chatTypingText.textContent = `${friendName} is typing...`;
                if (chatTypingIndicator) chatTypingIndicator.style.display = 'flex';
            } else {
                if (chatTypingIndicator) chatTypingIndicator.style.display = 'none';
            }
        });

        // 3. Read Receipts Listener
        fbReadRef = firebaseDb.ref('chats/' + chatId + '/read_at/' + activeFriendId);
        fbReadRef.on('value', (snapshot) => {
            const readAtTs = Number(snapshot.val() || 0);
            if (readAtTs > 0) {
                currentLastReadTimestamp = readAtTs;
                updateReadReceipts(readAtTs);
            }
        });
    }

    function updateReadReceipts(readAtTs) {
        // Remove existing "Seen" labels
        messagesContainer.querySelectorAll('.chat-seen-receipt').forEach(el => el.remove());

        // Find last sent message
        const sentRows = Array.from(messagesContainer.querySelectorAll('.page-inbox-msg-row.sent'));
        if (sentRows.length === 0) return;

        const lastSentRow = sentRows[sentRows.length - 1];
        const msgTs = Number(lastSentRow.dataset.timestamp || 0);

        // Strict accuracy: only show Seen if readAtTs and msgTs are valid and recipient read timestamp is >= message timestamp
        if (readAtTs > 0 && msgTs > 0 && readAtTs >= msgTs) {
            const seenEl = document.createElement('div');
            seenEl.className = 'chat-seen-receipt';
            seenEl.innerHTML = '<i class="fas fa-check-double me-1"></i> Seen';
            lastSentRow.after(seenEl);
        }
    }

    // ---- API Requests ----
    async function loadConversations() {
        try {
            const res = await fetch('/api/chat/conversations/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();
            if (!data.success) {
                conversationsList.innerHTML = '<div class="p-3 text-center text-muted">Failed to load chats</div>';
                return;
            }
            conversations = data.conversations || [];
            renderConversations(conversations);

            const totalUnread = conversations.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
            if (typeof window.updateSidebarBadge === 'function') {
                window.updateSidebarBadge('chat', totalUnread);
            }
            if (typeof window.updateSidebarChatBadge === 'function') {
                window.updateSidebarChatBadge(totalUnread);
            }

            if (config.selectedFriendId && config.selectedFriendId > 0) {
                openConversation(config.selectedFriendId);
            }
        } catch (e) {
            console.error('loadConversations error:', e);
            conversationsList.innerHTML = '<div class="p-3 text-center text-muted">Error loading chats</div>';
        }
    }

    function renderConversations(list) {
        if (!conversationsList) return;
        if (!list || list.length === 0) {
            conversationsList.innerHTML = `
                <div class="p-4 text-center text-muted">
                    <i class="fas fa-user-friends fa-2x mb-2 opacity-50"></i>
                    <p class="mb-0">No chats found.</p>
                </div>
            `;
            if (convCount) convCount.textContent = '0 chats';
            return;
        }

        if (convCount) convCount.textContent = `${list.length} chat${list.length > 1 ? 's' : ''}`;

        conversationsList.innerHTML = list.map(c => {
            const userId = c.user_id || c.friend_id;
            const isActive = activeFriendId && Number(activeFriendId) === Number(userId);
            const thumb = getAvatarThumb(c.picture || c.avatar);
            const effectiveUnread = (activeFriendId && Number(activeFriendId) === Number(userId)) ? 0 : (Number(c.unread_count) || 0);
            const unreadBadge = effectiveUnread > 0 ? `<span class="page-inbox-conv-badge">${effectiveUnread}</span>` : '';
            const isOnline = Boolean(c.is_online !== undefined ? c.is_online : c.online);
            const onlineClass = isOnline ? 'online' : 'offline';

            let convTs = 0;
            if (c.last_time) {
                let lt = String(c.last_time).trim().replace(' ', 'T');
                if (!lt.endsWith('Z') && !lt.includes('+') && !/-\d{2}:\d{2}$/.test(lt)) lt += 'Z';
                const p = new Date(lt).getTime();
                if (!isNaN(p)) convTs = p;
            }
            if (!convTs && c.timestamp) {
                const n = Number(c.timestamp);
                convTs = n > 10000000000 ? n : n * 1000;
            }
            const timeDisplay = convTs ? formatRelativeTime(convTs) : (c.time_ago || '');

            return `
                <div class="page-inbox-conv-item ${isActive ? 'active' : ''}" data-friend-id="${userId}" data-timestamp="${convTs || ''}" onclick="window.__selectChat(${userId})">
                    <div class="user-avatar-wrapper page-inbox-conv-avatar-wrap" style="position: relative; display: inline-block;">
                        <img src="${thumb}" onerror="this.onerror=null;this.src='${escapeHtml(c.picture || c.avatar)}'" data-full-src="${escapeHtml(c.picture || c.avatar || '/static/images/avatars/default.png')}" class="chat-user-avatar page-inbox-conv-avatar" alt="${escapeHtml(c.name)}">
                        <span class="status-dot ${onlineClass}" data-user-id="${userId}"></span>
                    </div>
                    <div class="page-inbox-conv-info">
                        <div class="page-inbox-conv-top">
                            <span class="page-inbox-conv-name">${escapeHtml(c.name)}</span>
                            <span class="page-inbox-conv-time">${escapeHtml(timeDisplay)}</span>
                        </div>
                        <div class="page-inbox-conv-bottom">
                            <span class="page-inbox-conv-last-msg">${escapeHtml(c.last_message || 'No messages')}</span>
                            ${unreadBadge}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    window.__selectChat = function (friendId) {
        // Instant optimistic clearing of conversation unread badge on click
        const convEl = conversationsList ? conversationsList.querySelector(`[data-friend-id="${friendId}"]`) : null;
        if (convEl) {
            const b = convEl.querySelector('.page-inbox-conv-badge, .unread-badge');
            if (b) {
                const badgeCount = parseInt(b.textContent, 10) || 1;
                b.remove();
                if (typeof window.updateBellBadge === 'function') {
                    const curBell = window.notificationSystem ? window.notificationSystem.unreadCount : (parseInt(document.querySelector('.notification-badge, #notifHeaderBadge')?.textContent, 10) || 0);
                    window.updateBellBadge(Math.max(0, curBell - badgeCount));
                }
            }
            convEl.classList.remove('has-unread');
        }
        openConversation(friendId);
        const chatContainer = document.getElementById('chatMessagesContainer') ||
                              document.querySelector('.chat-messages-scroll-area') ||
                              messagesContainer ||
                              document.getElementById('messagesContainer') ||
                              document.querySelector('.page-inbox-messages-container');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        if (window.innerWidth < 768) {
            closeChatSidebar();
        }
    };

    async function openConversation(friendId) {
        if (!friendId) return;
        activeFriendId = Number(friendId);
        knownMessageIds.clear();

        // Attach/update Firebase RTDB presence listener for active friend
        attachFriendPresenceListener(activeFriendId);

        // Instantly remove unread badge for this conversation in UI (instant feedback)
        const convEl = conversationsList ? conversationsList.querySelector(`[data-friend-id="${friendId}"]`) : null;
        let clearedBadgeCount = 0;
        if (convEl) {
            const b = convEl.querySelector('.page-inbox-conv-badge, .unread-badge');
            if (b) {
                clearedBadgeCount = parseInt(b.textContent, 10) || 1;
                b.remove();
            }
            convEl.classList.remove('has-unread');
        }

        // Optimistically decrement top bell badge immediately
        if (clearedBadgeCount > 0 && typeof window.updateBellBadge === 'function') {
            const curBell = window.notificationSystem ? window.notificationSystem.unreadCount : (parseInt(document.querySelector('.notification-badge, #notifHeaderBadge')?.textContent, 10) || 0);
            window.updateBellBadge(Math.max(0, curBell - clearedBadgeCount));
        }

        // Synchronously clear sidebar chat badge
        if (typeof window.updateSidebarBadge === 'function') {
            window.updateSidebarBadge('chat', 0);
        }
        if (typeof window.updateSidebarChatBadge === 'function') {
            window.updateSidebarChatBadge(0);
        }
        window.dispatchEvent(new CustomEvent('chatMessagesRead', { detail: { friendId: friendId } }));

        // Trigger immediate background mark read
        markConversationRead(friendId);

        // FIX 1: Open mobile thread view
        const wrap = document.querySelector('.chat-wrap') || document.querySelector('.page-inbox-wrap');
        if (wrap) {
            wrap.classList.add('mobile-thread-open');
        }
        if (window.innerWidth <= 767) {
            if (!history.state || !history.state.chatThreadOpen) {
                history.pushState({ chatThreadOpen: true, friendId: Number(friendId) }, '');
            }
        }

        // Reset Reply & Edit states
        cancelReply();
        cancelEdit();

        // Highlight active item
        document.querySelectorAll('.page-inbox-conv-item').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.friendId) === Number(friendId));
        });

        // Show loading in messages area
        if (emptyStatePlaceholder) emptyStatePlaceholder.style.display = 'none';
        messagesContainer.innerHTML = `
            <div class="p-5 text-center text-muted">
                <i class="fas fa-spinner fa-spin fa-2x mb-2"></i>
                <p>Loading messages...</p>
            </div>
        `;

        try {
            const res = await fetch(`/api/chat/messages/?friend_id=${friendId}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();
            if (!data.success) {
                messagesContainer.innerHTML = `<div class="p-4 text-center text-danger">${escapeHtml(data.error || 'Failed to load thread')}</div>`;
                return;
            }

            activeFriend = data.friend;
            activeChatId = data.chat_id;

            // Sync authoritative unread counts from response
            if (data.unread_count !== undefined && typeof window.updateBellBadge === 'function') {
                window.updateBellBadge(data.unread_count);
            }
            if (data.chat_unread !== undefined && typeof window.updateSidebarBadge === 'function') {
                window.updateSidebarBadge('chat', data.chat_unread);
            }
            if (typeof window.refreshNotifications === 'function') {
                window.refreshNotifications();
            }
            if (typeof window.refreshSidebarBadges === 'function') {
                window.refreshSidebarBadges();
            }

            // Update Header
            if (chatHeader) chatHeader.style.display = 'flex';
            if (inputArea) inputArea.style.display = 'block';
            const headerNameEl = document.getElementById('chatHeaderName') || chatName;
            if (headerNameEl) headerNameEl.textContent = activeFriend.name;
            if (chatAvatar) {
                chatAvatar.src = getAvatarThumb(activeFriend.picture);
                chatAvatar.dataset.fullSrc = activeFriend.picture || '';
                chatAvatar.onerror = function () { this.onerror = null; this.src = activeFriend.picture; };
            }
            const isOnline = Boolean(activeFriend.is_online !== undefined ? activeFriend.is_online : activeFriend.online);
            const headerDotEl = document.getElementById('chatHeaderDot') || chatOnlineDot;
            if (headerDotEl) {
                headerDotEl.dataset.userId = activeFriend.id;
                headerDotEl.classList.toggle('online', isOnline);
                headerDotEl.classList.toggle('offline', !isOnline);
                headerDotEl.classList.remove('d-none');
            }
            const headerStatusEl = document.getElementById('chatHeaderStatus') || chatStatus;
            if (headerStatusEl) {
                headerStatusEl.textContent = isOnline ? 'Online' : 'Offline';
            }
            attachFriendPresenceListener(friendId);
            if (chatProfileLink) {
                chatProfileLink.href = `/user/${encodeURIComponent(activeFriend.username || activeFriend.id)}/`;
            }

            // Clear unread badge in sidebar & mark conversation as read on server and Firebase
            const convEl = conversationsList.querySelector(`[data-friend-id="${friendId}"]`);
            if (convEl) {
                const b = convEl.querySelector('.page-inbox-conv-badge');
                if (b) b.remove();
            }
            markConversationRead(friendId);

            // Render Messages
            messagesContainer.innerHTML = '';
            const msgs = (data.messages || []).slice().sort((a, b) => {
                const idA = Number(a.id) || 0;
                const idB = Number(b.id) || 0;
                if (idA && idB) return idA - idB;
                const timeA = getMsgTimestamp(a);
                const timeB = getMsgTimestamp(b);
                return timeA - timeB;
            });
            if (msgs.length === 0) {
                messagesContainer.innerHTML = `
                    <div class="page-inbox-empty-chat">
                        <div class="page-inbox-empty-icon"><i class="fas fa-hand-sparkles"></i></div>
                        <h4>Say Hello!</h4>
                        <p>No messages yet. Send a message to start chatting with ${escapeHtml(activeFriend.name)}.</p>
                    </div>
                `;
            } else {
                msgs.forEach(m => {
                    knownMessageIds.add(String(m.id));
                    renderMessageRow(m);
                });

                const chatContainer = document.getElementById('chatMessagesContainer') ||
                                      document.querySelector('.chat-messages-scroll-area') ||
                                      messagesContainer ||
                                      document.getElementById('messagesContainer') ||
                                      document.querySelector('.page-inbox-messages-container');
                if (chatContainer) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                scrollToBottom(false);

                // Initial seen state check from database messages
                const sentMsgs = msgs.filter(m => Number(m.sender_id) === Number(config.currentUserId));
                if (sentMsgs.length > 0) {
                    const lastSent = sentMsgs[sentMsgs.length - 1];
                    if (lastSent.is_read) {
                        const lastSentTs = getMsgTimestamp(lastSent);
                        updateReadReceipts(Math.max(Number(currentLastReadTimestamp || 0), lastSentTs));
                    }
                }
            }

            // Attach Firebase listeners & polling fallback
            attachFirebaseListeners(activeChatId);
            startSyncPolling();

            if (messageInput) messageInput.focus();

        } catch (e) {
            console.error('openConversation error:', e);
            messagesContainer.innerHTML = '<div class="p-4 text-center text-danger">Error connecting to conversation</div>';
        }
    }

    // ---- Message Row Rendering ----
    function renderMessageRow(msg) {
        const isSent = Number(msg.sender_id) === Number(config.currentUserId);
        const row = document.createElement('div');
        row.className = `page-inbox-msg-row ${isSent ? 'sent' : 'received'}`;
        row.dataset.msgId = msg.id;

        const createdTs = getMsgTimestamp(msg);
        row.dataset.timestamp = createdTs;

        // FIX 4 (Option A): Remove avatar on sent bubbles entirely (Insta/FB style)
        let avatarHtml = '';
        if (!isSent) {
            const friendPic = (activeFriend && activeFriend.picture) || msg.sender_picture || '';
            const avatarThumb = getAvatarThumb(msg.sender_picture || friendPic);
            avatarHtml = `
                <div class="page-inbox-msg-avatar-wrap">
                    <img src="${avatarThumb}" onerror="this.onerror=null;this.src='${escapeHtml(friendPic || '/static/images/avatars/default.png')}'" data-full-src="${escapeHtml(msg.sender_picture || friendPic || '/static/images/avatars/default.png')}" class="page-inbox-msg-avatar" alt="">
                </div>
            `;
        }

        // Quoted Reply Preview
        let replyQuoteHtml = '';
        if (msg.reply_snippet && msg.reply_snippet.message) {
            replyQuoteHtml = `
                <div class="chat-reply-quote" onclick="window.__scrollToMessage('${msg.reply_to}')">
                    <div class="chat-reply-quote-sender">${escapeHtml(msg.reply_snippet.sender_name)}</div>
                    <div class="chat-reply-quote-text">${escapeHtml(msg.reply_snippet.message)}</div>
                </div>
            `;
        }

        // Media / Content rendering
        let mediaHtml = '';
        const msgType = msg.message_type || 'text';
        const fileUrl = msg.s3_url || msg.media_url || '';

        if (msgType === 'image' && fileUrl) {
            mediaHtml = `
                <div class="chat-media-wrap">
                    <img src="${fileUrl}" class="chat-media-img" alt="Attachment" onclick="window.open('${fileUrl}', '_blank')">
                </div>
            `;
        } else if (msgType === 'video' && fileUrl) {
            mediaHtml = `
                <div class="chat-media-wrap">
                    <video src="${fileUrl}" class="chat-media-video" controls playsinline preload="metadata"></video>
                </div>
            `;
        } else if (msgType === 'voice' && fileUrl) {
            mediaHtml = `
                <div class="chat-voice-player" data-src="${fileUrl}">
                    <button type="button" class="chat-voice-play-btn" onclick="window.__toggleVoicePlay(this)">
                        <i class="fas fa-play"></i>
                    </button>
                    <div class="chat-voice-progress-wrap">
                        <div class="chat-voice-track" onclick="window.__seekVoice(event, this)">
                            <div class="chat-voice-fill"></div>
                        </div>
                        <span class="chat-voice-time">${formatDuration(msg.duration || 0)}</span>
                    </div>
                </div>
            `;
        } else if (msgType === 'audio' && fileUrl) {
            mediaHtml = `
                <div class="chat-media-wrap">
                    <audio src="${fileUrl}" controls class="w-100"></audio>
                </div>
            `;
        } else if (msgType === 'file' && fileUrl) {
            const fileName = msg.file_name || 'Document';
            const fileSizeStr = msg.file_size ? formatBytes(msg.file_size) : '';
            mediaHtml = `
                <a href="${fileUrl}" target="_blank" download class="chat-file-card">
                    <i class="fas fa-file-alt chat-file-icon"></i>
                    <div class="chat-file-meta">
                        <div class="chat-file-name">${escapeHtml(fileName)}</div>
                        <div class="chat-file-size">${escapeHtml(fileSizeStr)}</div>
                    </div>
                </a>
            `;
        }

        // Text Content
        let textContentHtml = '';
        if (msg.message && (msgType === 'text' || !fileUrl)) {
            textContentHtml = `<div class="page-inbox-msg-text">${escapeHtml(msg.message)}</div>`;
        } else if (msg.message && msgType !== 'voice' && msgType !== 'text') {
            // Optional text caption along with media
            textContentHtml = `<div class="page-inbox-msg-text mt-1">${escapeHtml(msg.message)}</div>`;
        }

        const formattedTime = formatMessageTime(msg);
        const editedHtml = msg.edited ? ' <span class="chat-edited-tag">(edited)</span>' : '';
        const timeHtml = `<div class="page-inbox-msg-time">${escapeHtml(formattedTime)}${editedHtml}</div>`;

        // Action Toolbar (Hover: React, Reply, Edit, Delete)
        const canEdit = isSent && msgType === 'text';
        const actionsHtml = `
            <div class="chat-msg-actions">
                <button type="button" class="chat-action-icon-btn" title="React" onclick="window.__toggleReactionPicker(this, '${msg.id}')">
                    <i class="far fa-smile"></i>
                </button>
                <button type="button" class="chat-action-icon-btn" title="Reply" onclick="window.__triggerReply('${msg.id}')">
                    <i class="fas fa-reply"></i>
                </button>
                ${canEdit ? `
                <button type="button" class="chat-action-icon-btn" title="Edit" onclick="window.__triggerEdit('${msg.id}')">
                    <i class="fas fa-pencil-alt"></i>
                </button>` : ''}
                ${isSent ? `
                <button type="button" class="chat-action-icon-btn danger" title="Delete" onclick="window.__triggerDelete('${msg.id}')">
                    <i class="fas fa-trash-alt"></i>
                </button>` : ''}
            </div>
        `;

        // FIX 3: Bubble assembly inside .chat-bubble-wrap
        const hasReactions = msg.reactions && msg.reactions.length > 0;
        const bubbleWrapHtml = `
            <div class="chat-bubble-wrap ${isSent ? 'sent' : 'received'}${hasReactions ? ' has-reactions' : ''}">
                <div class="page-inbox-bubble ${isSent ? 'sent' : 'received'}">
                    ${replyQuoteHtml}
                    ${mediaHtml}
                    ${textContentHtml}
                    ${timeHtml}
                </div>
                <div class="chat-reactions-display" style="${hasReactions ? 'display: inline-flex;' : 'display: none;'}"></div>
                ${actionsHtml}
            </div>
        `;

        row.innerHTML = isSent ? bubbleWrapHtml : (avatarHtml + bubbleWrapHtml);
        insertMessageInOrder(messagesContainer, row, createdTs, Number(msg.id) || 0);

        // Render Reactions if any
        if (hasReactions) {
            renderReactionsInRow(row, msg.reactions, msg.id);
        }
    }

    // Scroll to referenced message on reply quote click
    window.__scrollToMessage = function (msgId) {
        if (!msgId) return;
        const target = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('bg-highlight');
            setTimeout(() => target.classList.remove('bg-highlight'), 1500);
        }
    };

    // ---- Voice Notes Playback ----
    let activeAudioPlayer = null;
    let activePlayBtn = null;

    window.__toggleVoicePlay = function (btn) {
        const wrap = btn.closest('.chat-voice-player');
        if (!wrap) return;
        const src = wrap.dataset.src;
        if (!src) return;

        if (activeAudioPlayer && activeAudioPlayer.src === src) {
            if (activeAudioPlayer.paused) {
                activeAudioPlayer.play();
                btn.innerHTML = '<i class="fas fa-pause"></i>';
            } else {
                activeAudioPlayer.pause();
                btn.innerHTML = '<i class="fas fa-play"></i>';
            }
            return;
        }

        // Stop current playing
        if (activeAudioPlayer) {
            activeAudioPlayer.pause();
            if (activePlayBtn) activePlayBtn.innerHTML = '<i class="fas fa-play"></i>';
        }

        const audio = new Audio(src);
        activeAudioPlayer = audio;
        activePlayBtn = btn;
        btn.innerHTML = '<i class="fas fa-pause"></i>';

        const fill = wrap.querySelector('.chat-voice-fill');
        const timeEl = wrap.querySelector('.chat-voice-time');

        audio.addEventListener('timeupdate', () => {
            if (!audio.duration) return;
            const pct = (audio.currentTime / audio.duration) * 100;
            if (fill) fill.style.width = pct + '%';
            if (timeEl) timeEl.textContent = formatDuration(audio.currentTime);
        });

        audio.addEventListener('ended', () => {
            btn.innerHTML = '<i class="fas fa-play"></i>';
            if (fill) fill.style.width = '0%';
            if (timeEl) timeEl.textContent = formatDuration(audio.duration || 0);
            activeAudioPlayer = null;
            activePlayBtn = null;
        });

        audio.play().catch(e => {
            console.error('Audio play failed:', e);
            btn.innerHTML = '<i class="fas fa-play"></i>';
        });
    };

    window.__seekVoice = function (evt, track) {
        if (!activeAudioPlayer || !activeAudioPlayer.duration) return;
        const rect = track.getBoundingClientRect();
        const clickX = evt.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        activeAudioPlayer.currentTime = pct * activeAudioPlayer.duration;
    };

    // ---- Reactions System ----
    const POPULAR_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

    window.__toggleReactionPicker = function (btn, msgId) {
        // Close any open pickers
        document.querySelectorAll('.chat-reaction-picker').forEach(el => el.remove());

        const picker = document.createElement('div');
        picker.className = 'chat-reaction-picker';
        picker.innerHTML = POPULAR_REACTIONS.map(emoji => `
            <span onclick="window.__submitReaction('${msgId}', '${emoji}')">${emoji}</span>
        `).join('');

        btn.parentElement.appendChild(picker);

        // Click outside listener
        const closePicker = (e) => {
            if (!picker.contains(e.target) && e.target !== btn) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        };
        setTimeout(() => document.addEventListener('click', closePicker), 50);
    };

    window.__submitReaction = async function (msgId, emoji) {
        document.querySelectorAll('.chat-reaction-picker').forEach(el => el.remove());
        try {
            const formData = new FormData();
            formData.append('message_id', msgId);
            formData.append('reaction', emoji);

            const res = await fetch('/api/chat/react/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                const row = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
                if (row) {
                    renderReactionsInRow(row, data.reactions, msgId);
                }
            }
        } catch (e) {
            console.error('submitReaction error:', e);
        }
    };

    function renderReactionsInRow(row, reactionsList, msgId) {
        const container = row.querySelector('.chat-reactions-display');
        const bubbleWrap = row.querySelector('.chat-bubble-wrap');
        if (!container) return;

        if (!reactionsList || reactionsList.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            if (bubbleWrap) bubbleWrap.classList.remove('has-reactions');
            return;
        }

        container.style.display = 'inline-flex';
        if (bubbleWrap) bubbleWrap.classList.add('has-reactions');

        // Group by emoji
        const grouped = {};
        reactionsList.forEach(r => {
            if (!grouped[r.reaction]) {
                grouped[r.reaction] = { count: 0, meReacted: false };
            }
            grouped[r.reaction].count += 1;
            if (Number(r.user_id) === Number(config.currentUserId)) {
                grouped[r.reaction].meReacted = true;
            }
        });

        container.innerHTML = Object.keys(grouped).map(emoji => {
            const g = grouped[emoji];
            const cls = g.meReacted ? 'chat-reaction-pill me-reacted' : 'chat-reaction-pill';
            // Clicking toggles off if I already reacted
            const action = g.meReacted ? `window.__submitReaction('${msgId}', '')` : `window.__submitReaction('${msgId}', '${emoji}')`;
            return `
                <span class="${cls}" onclick="${action}" title="${g.count} reactions">
                    ${emoji} <span class="ms-1">${g.count}</span>
                </span>
            `;
        }).join('');
    }

    // ---- Reply System ----
    window.__triggerReply = function (msgId) {
        const row = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
        if (!row) return;

        cancelEdit(); // Cancel edit if active

        const textEl = row.querySelector('.page-inbox-msg-text') || row.querySelector('.chat-file-name');
        const text = textEl ? textEl.textContent.trim() : 'Media attachment';
        const isSent = row.classList.contains('sent');
        const senderName = isSent ? 'You' : (activeFriend ? activeFriend.name : 'Friend');

        activeReply = { id: msgId, name: senderName, text: text };

        if (chatReplyUser) chatReplyUser.textContent = senderName;
        if (chatReplyText) chatReplyText.textContent = text;
        if (chatReplyPreview) chatReplyPreview.style.display = 'flex';

        if (messageInput) messageInput.focus();
    };

    function cancelReply() {
        activeReply = null;
        if (chatReplyPreview) chatReplyPreview.style.display = 'none';
    }

    if (chatReplyCancelBtn) {
        chatReplyCancelBtn.addEventListener('click', cancelReply);
    }

    // ---- Edit System ----
    window.__triggerEdit = function (msgId) {
        const row = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
        if (!row) return;

        cancelReply(); // Cancel reply if active

        const textEl = row.querySelector('.page-inbox-msg-text');
        if (!textEl) return;
        const text = textEl.textContent.trim();

        activeEdit = { id: msgId, originalText: text };

        if (chatEditText) chatEditText.textContent = text;
        if (chatEditBar) chatEditBar.style.display = 'flex';

        if (messageInput) {
            messageInput.value = text;
            messageInput.focus();
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        }
    };

    function cancelEdit() {
        if (activeEdit && messageInput && messageInput.value === activeEdit.originalText) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }
        activeEdit = null;
        if (chatEditBar) chatEditBar.style.display = 'none';
    }

    if (chatEditCancelBtn) {
        chatEditCancelBtn.addEventListener('click', cancelEdit);
    }

    // ---- Delete System ----
    window.__triggerDelete = async function (msgId) {
        if (!confirm('Are you sure you want to delete this message?')) return;
        try {
            const formData = new FormData();
            formData.append('message_id', msgId);

            const res = await fetch('/api/chat/delete/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                const row = messagesContainer.querySelector(`[data-msg-id="${msgId}"]`);
                if (row) row.remove();
            } else {
                alert(data.error || 'Failed to delete message');
            }
        } catch (e) {
            console.error('Delete message error:', e);
            alert('Error deleting message');
        }
    };

    // ---- Media Upload System ----
    if (chatAttachBtn && chatFileInput) {
        chatAttachBtn.addEventListener('click', () => {
            chatFileInput.value = '';
            chatFileInput.click();
        });

        chatFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !activeFriendId) return;

            if (file.size > 50 * 1024 * 1024) {
                alert('File size exceeds 50MB limit');
                return;
            }

            showUploadProgress(`Uploading ${file.name}...`);

            try {
                // 1. Request presigned PUT URL
                const presignRes = await fetch('/api/chat/upload/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        filename: file.name,
                        content_type: file.type || 'application/octet-stream'
                    })
                });
                const presignData = await presignRes.json();
                if (!presignData.success) {
                    throw new Error(presignData.error || 'Failed to obtain upload URL');
                }

                // 2. Direct PUT to S3
                const s3Put = await fetch(presignData.upload_url, {
                    method: 'PUT',
                    headers: { 'Content-Type': file.type || 'application/octet-stream' },
                    body: file
                });

                if (!s3Put.ok) {
                    throw new Error(`S3 upload error (${s3Put.status})`);
                }

                // 3. Determine message_type
                let msgType = 'file';
                if (file.type.startsWith('image/')) msgType = 'image';
                else if (file.type.startsWith('video/')) msgType = 'video';
                else if (file.type.startsWith('audio/')) msgType = 'audio';

                // 4. Send message to backend
                const formData = new FormData();
                formData.append('friend_id', activeFriendId);
                formData.append('message_type', msgType);
                formData.append('s3_key', presignData.key);
                formData.append('file_name', file.name);
                formData.append('file_size', file.size);
                if (activeReply) {
                    formData.append('reply_to', activeReply.id);
                }

                const sendRes = await fetch('/api/chat/send/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const sendData = await sendRes.json();
                if (sendData.success && sendData.message) {
                    cancelReply();
                    if (!knownMessageIds.has(String(sendData.message.id))) {
                        knownMessageIds.add(String(sendData.message.id));
                        const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
                        if (emptyChat) emptyChat.remove();
                        renderMessageRow(sendData.message);
                        scrollToBottom(true);
                    }
                    updateConvSnippet(activeFriendId, sendData.message.message || (sendData.message.message_type === 'image' ? '📷 Photo' : sendData.message.message_type === 'video' ? '🎥 Video' : '📁 File'), sendData.message.timestamp || sendData.message.created_at);
                } else {
                    alert(sendData.error || 'Failed to send file');
                }
            } catch (err) {
                console.error('File upload failed:', err);
                alert('Upload failed: ' + err.message);
            } finally {
                hideUploadProgress();
                chatFileInput.value = '';
            }
        });
    }

    // ---- Voice Recording System ----
    if (chatVoiceBtn) {
        chatVoiceBtn.addEventListener('click', async () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                return;
            }

            try {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioChunks = [];
                mediaRecorder = new MediaRecorder(audioStream);

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) {
                        audioChunks.push(e.data);
                    }
                };

                mediaRecorder.start();
                voiceRecordingSeconds = 0;
                if (chatVoiceTimer) chatVoiceTimer.textContent = '00:00';
                if (chatVoiceRecordingBar) chatVoiceRecordingBar.style.display = 'flex';

                voiceRecordingTimerInterval = setInterval(() => {
                    voiceRecordingSeconds += 1;
                    if (chatVoiceTimer) chatVoiceTimer.textContent = formatDuration(voiceRecordingSeconds);
                    if (voiceRecordingSeconds >= 300) { // Max 5 mins
                        stopAndSendVoiceNote();
                    }
                }, 1000);

            } catch (err) {
                console.error('Microphone access denied:', err);
                alert('Microphone access is required to record voice notes.');
            }
        });
    }

    function cleanupVoiceRecording() {
        if (voiceRecordingTimerInterval) {
            clearInterval(voiceRecordingTimerInterval);
            voiceRecordingTimerInterval = null;
        }
        if (audioStream) {
            audioStream.getTracks().forEach(t => t.stop());
            audioStream = null;
        }
        if (chatVoiceRecordingBar) chatVoiceRecordingBar.style.display = 'none';
        mediaRecorder = null;
        audioChunks = [];
    }

    if (chatVoiceCancelBtn) {
        chatVoiceCancelBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            cleanupVoiceRecording();
        });
    }

    async function stopAndSendVoiceNote() {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

        const duration = voiceRecordingSeconds;
        showUploadProgress('Saving voice note...');

        mediaRecorder.onstop = async () => {
            try {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                cleanupVoiceRecording();

                // 1. Presign upload
                const presignRes = await fetch('/api/chat/upload/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        filename: 'voice_note.webm',
                        content_type: 'audio/webm'
                    })
                });
                const presignData = await presignRes.json();
                if (!presignData.success) throw new Error(presignData.error || 'Failed to obtain voice upload URL');

                // 2. PUT directly to S3
                const s3Put = await fetch(presignData.upload_url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'audio/webm' },
                    body: blob
                });
                if (!s3Put.ok) throw new Error(`S3 voice upload failed (${s3Put.status})`);

                // 3. Send message
                const formData = new FormData();
                formData.append('friend_id', activeFriendId);
                formData.append('message_type', 'voice');
                formData.append('s3_key', presignData.key);
                formData.append('file_name', 'voice_note.webm');
                formData.append('duration', duration);
                if (activeReply) formData.append('reply_to', activeReply.id);

                const sendRes = await fetch('/api/chat/send/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const sendData = await sendRes.json();
                if (sendData.success && sendData.message) {
                    cancelReply();
                    if (!knownMessageIds.has(String(sendData.message.id))) {
                        knownMessageIds.add(String(sendData.message.id));
                        const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
                        if (emptyChat) emptyChat.remove();
                        renderMessageRow(sendData.message);
                        scrollToBottom(true);
                    }
                    updateConvSnippet(activeFriendId, '🎤 Voice message', sendData.message.timestamp || sendData.message.created_at);
                } else {
                    alert(sendData.error || 'Failed to send voice note');
                }
            } catch (err) {
                console.error('Voice send error:', err);
                alert('Voice note error: ' + err.message);
            } finally {
                hideUploadProgress();
            }
        };

        mediaRecorder.stop();
    }

    if (chatVoiceSendBtn) {
        chatVoiceSendBtn.addEventListener('click', stopAndSendVoiceNote);
    }

    // ---- Typing Indicator Dispatcher ----
    function notifyTyping(isTypingState) {
        if (!activeFriendId) return;
        const formData = new FormData();
        formData.append('friend_id', activeFriendId);
        formData.append('typing', isTypingState ? 'true' : 'false');
        fetch('/api/chat/typing/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: formData
        }).catch(() => {});
    }

    function handleUserInput() {
        if (!isTyping) {
            isTyping = true;
            notifyTyping(true);
        }
        if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
        typingDebounceTimer = setTimeout(() => {
            isTyping = false;
            notifyTyping(false);
        }, 3000);
    }

    // ---- Send / Edit Message Submit ----
    async function sendMessage() {
        if (!activeFriendId || !messageInput) return;
        const text = messageInput.value.trim();
        if (!text) return;

        // If editing active message
        if (activeEdit) {
            const editId = activeEdit.id;
            try {
                const formData = new FormData();
                formData.append('message_id', editId);
                formData.append('new_content', text);

                const res = await fetch('/api/chat/edit/', {
                    method: 'POST',
                    headers: { 'X-CSRFToken': getCsrfToken() },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    const row = messagesContainer.querySelector(`[data-msg-id="${editId}"]`);
                    if (row) {
                        const textEl = row.querySelector('.page-inbox-msg-text');
                        if (textEl) textEl.textContent = text;
                        if (!row.querySelector('.chat-edited-tag')) {
                            const timeEl = row.querySelector('.page-inbox-msg-time');
                            if (timeEl) timeEl.insertAdjacentHTML('beforeend', ' <span class="chat-edited-tag">(edited)</span>');
                        }
                    }
                    cancelEdit();
                } else {
                    alert(data.error || 'Failed to edit message');
                }
            } catch (e) {
                console.error('Edit message error:', e);
            }
            return;
        }

        // Standard Send
        messageInput.value = '';
        messageInput.style.height = 'auto';
        if (sendBtn) sendBtn.disabled = true;

        // Stop typing immediately
        if (isTyping) {
            isTyping = false;
            if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
            notifyTyping(false);
        }

        try {
            const formData = new FormData();
            formData.append('friend_id', activeFriendId);
            formData.append('message', text);
            formData.append('message_type', 'text');
            if (activeReply) {
                formData.append('reply_to', activeReply.id);
            }

            const res = await fetch('/api/chat/send/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });

            const data = await res.json();
            if (data.success && data.message) {
                const msg = data.message;
                cancelReply();

                // Clear any existing Seen indicators so newly dispatched message is never shown as seen prematurely
                messagesContainer.querySelectorAll('.chat-seen-receipt').forEach(el => el.remove());

                if (!knownMessageIds.has(String(msg.id))) {
                    knownMessageIds.add(String(msg.id));
                    const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
                    if (emptyChat) emptyChat.remove();

                    renderMessageRow(msg);
                    scrollToBottom(true);
                }
                updateConvSnippet(activeFriendId, text, msg.timestamp || msg.created_at);
            } else {
                alert(data.error || 'Failed to send message');
                messageInput.value = text;
            }
        } catch (e) {
            console.error('sendMessage error:', e);
            alert('Error sending message. Please try again.');
            messageInput.value = text;
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    async function markConversationRead(friendId) {
        if (!friendId) return;

        // Instantly strip badge from list item
        const convItem = conversationsList ? conversationsList.querySelector(`[data-friend-id="${friendId}"]`) : null;
        if (convItem) {
            const b = convItem.querySelector('.page-inbox-conv-badge, .unread-badge');
            if (b) b.remove();
            convItem.classList.remove('has-unread');
        }

        // Synchronously clear sidebar chat badge
        if (typeof window.updateSidebarBadge === 'function') {
            window.updateSidebarBadge('chat', 0);
        }
        if (typeof window.updateSidebarChatBadge === 'function') {
            window.updateSidebarChatBadge(0);
        }
        window.dispatchEvent(new CustomEvent('chatMessagesRead', { detail: { friendId: friendId } }));

        // Reset Firebase RTDB user_chats unread flag
        if (firebaseDb && config.currentUserId) {
            try {
                firebaseDb.ref(`user_chats/${config.currentUserId}/${friendId}`).update({
                    is_read: true,
                    unread: 0
                });
            } catch (err) {
                console.warn('Firebase user_chats reset error:', err);
            }
        }

        try {
            const formData = new FormData();
            formData.append('friend_id', friendId);
            const res = await fetch('/api/chat/read/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });
            const data = await res.json();
            if (data && data.success) {
                if (data.unread_count !== undefined && typeof window.updateBellBadge === 'function') {
                    window.updateBellBadge(data.unread_count);
                }
                if (data.chat_unread !== undefined && typeof window.updateSidebarBadge === 'function') {
                    window.updateSidebarBadge('chat', data.chat_unread);
                }
                if (typeof window.refreshNotifications === 'function') {
                    window.refreshNotifications();
                }
                if (typeof window.refreshSidebarBadges === 'function') {
                    window.refreshSidebarBadges();
                }
            }
        } catch (e) {
            console.warn('markConversationRead error:', e);
        }
    }

    function incrementUnreadBadge(friendId) {
        if (!conversationsList) return;
        if (activeFriendId && Number(activeFriendId) === Number(friendId)) {
            // Thread is actively open and focused, mark read immediately
            markConversationRead(friendId);
            return;
        }
        const item = conversationsList.querySelector(`[data-friend-id="${friendId}"]`);
        if (!item) {
            loadConversations();
            return;
        }
        const bottom = item.querySelector('.page-inbox-conv-bottom');
        if (!bottom) return;
        let badge = bottom.querySelector('.page-inbox-conv-badge');
        if (badge) {
            const count = (parseInt(badge.textContent, 10) || 0) + 1;
            badge.textContent = count;
        } else {
            badge = document.createElement('span');
            badge.className = 'page-inbox-conv-badge';
            badge.textContent = '1';
            bottom.appendChild(badge);
        }
    }

    function updateConvSnippet(friendId, text, timestamp) {
        let item = conversationsList ? conversationsList.querySelector(`[data-friend-id="${friendId}"]`) : null;
        if (!item) {
            loadConversations();
            return;
        }
        const msgEl = item.querySelector('.page-inbox-conv-last-msg');
        if (msgEl) {
            msgEl.textContent = text && text.length > 40 ? text.slice(0, 40) + '...' : (text || '');
        }

        let convTs = Date.now();
        if (timestamp) {
            if (typeof timestamp === 'number') {
                convTs = timestamp > 10000000000 ? timestamp : timestamp * 1000;
            } else if (typeof timestamp === 'string') {
                let s = timestamp.trim().replace(' ', 'T');
                if (/^\d+$/.test(s)) {
                    const n = Number(s);
                    convTs = n > 10000000000 ? n : n * 1000;
                } else {
                    if (!s.endsWith('Z') && !s.includes('+') && !/-\d{2}:\d{2}$/.test(s)) s += 'Z';
                    const p = new Date(s).getTime();
                    if (!isNaN(p)) convTs = p;
                }
            } else if (timestamp instanceof Date) {
                convTs = timestamp.getTime();
            }
        }
        item.dataset.timestamp = String(convTs);

        const timeEl = item.querySelector('.page-inbox-conv-time');
        if (timeEl) {
            timeEl.textContent = formatRelativeTime(convTs);
        }
        // Current user sent the latest message, so clear any unread badge on this thread
        const badge = item.querySelector('.page-inbox-conv-badge, .unread-badge');
        if (badge) badge.remove();
        item.classList.remove('has-unread');

        // Move to top of conversations list
        if (conversationsList && item !== conversationsList.firstElementChild) {
            conversationsList.prepend(item);
        }
    }

    function updateAllConvRelativeTimes() {
        if (!conversationsList) return;
        conversationsList.querySelectorAll('.page-inbox-conv-item').forEach(item => {
            const ts = Number(item.dataset.timestamp);
            if (ts && !isNaN(ts)) {
                const timeEl = item.querySelector('.page-inbox-conv-time');
                if (timeEl) {
                    timeEl.textContent = formatRelativeTime(ts);
                }
            }
        });
    }

    let relativeTimeTicker = setInterval(updateAllConvRelativeTimes, 30000);

    let syncPollingTimer = null;
    function startSyncPolling() {
        if (syncPollingTimer) clearInterval(syncPollingTimer);
        syncPollingTimer = setInterval(async () => {
            if (!activeFriendId || document.hidden) return;
            try {
                const res = await fetch(`/api/chat/messages/?friend_id=${activeFriendId}`, {
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                if (!res.ok) return;
                const data = await res.json();
                if (data.success && Array.isArray(data.messages)) {
                    let hasNew = false;
                    data.messages.forEach(m => {
                        const mId = String(m.id);
                        if (!knownMessageIds.has(mId) && !messagesContainer.querySelector(`[data-msg-id="${mId}"]`)) {
                            knownMessageIds.add(mId);
                            const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
                            if (emptyChat) emptyChat.remove();
                            renderMessageRow(m);
                            hasNew = true;
                        }
                    });
                    if (hasNew) {
                        scrollToBottom(true);
                    }
                }
            } catch (e) {
                // Fail silently on polling error
            }
        }, 4000);
    }

    // ---- Event Listeners ----
    if (messageForm) {
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendMessage();
        });
    }

    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        messageInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            handleUserInput();
        });

        messageInput.addEventListener('blur', () => {
            if (isTyping) {
                isTyping = false;
                if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
                notifyTyping(false);
            }
        });
    }

    if (chatSearchInput) {
        chatSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) {
                renderConversations(conversations);
                return;
            }
            const filtered = conversations.filter(c =>
                (c.name && c.name.toLowerCase().includes(q)) ||
                (c.username && c.username.toLowerCase().includes(q))
            );
            renderConversations(filtered);
        });
    }

    const chatBackBtn = document.getElementById('chatBackBtn');
    if (chatBackBtn) {
        chatBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeMobileThread(true);
        });
    }

    // ---- Init ----
    document.addEventListener('DOMContentLoaded', () => {
        initFirebase();
        loadConversations();
    });

})();
