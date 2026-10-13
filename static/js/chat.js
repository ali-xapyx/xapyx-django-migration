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
    const chatOnlineDot = document.getElementById('chatOnlineDot');
    const chatName = document.getElementById('chatName');
    const chatStatus = document.getElementById('chatStatus');
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
        if (!messagesContainer) return;
        requestAnimationFrame(() => {
            messagesContainer.scrollTo({
                top: messagesContainer.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
        });
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
        } catch (e) {
            console.error('[chat.js] Firebase init error:', e);
        }
    }

    function detachFirebaseListeners() {
        if (fbMessagesRef) { fbMessagesRef.off(); fbMessagesRef = null; }
        if (fbTypingRef) { fbTypingRef.off(); fbTypingRef = null; }
        if (fbReadRef) { fbReadRef.off(); fbReadRef = null; }
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

            if (knownMessageIds.has(msgId)) return;
            knownMessageIds.add(msgId);

            const isMe = Number(data.sender_id) === Number(config.currentUserId);
            const timeStr = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

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
                sender_name: data.sender_name || (isMe ? 'You' : (activeFriend ? activeFriend.name : 'User')),
                sender_picture: isMe ? (window.XPY_CONFIG && window.XPY_CONFIG.userPicture) : (activeFriend ? activeFriend.picture : ''),
                reactions: []
            });

            if (isMe || wasAtBottom) {
                scrollToBottom(true);
            }
            updateConvSnippet(activeFriendId, data.content || '');

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

        if (readAtTs >= msgTs) {
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
            const isActive = activeFriendId && Number(activeFriendId) === Number(c.friend_id);
            const thumb = getAvatarThumb(c.picture);
            const unreadBadge = c.unread_count > 0 ? `<span class="page-inbox-conv-badge">${c.unread_count}</span>` : '';
            const onlineDot = c.online ? '<span class="chat-online-indicator"></span>' : '';

            return `
                <div class="page-inbox-conv-item ${isActive ? 'active' : ''}" data-friend-id="${c.friend_id}" onclick="window.__selectChat(${c.friend_id})">
                    <div class="page-inbox-conv-avatar-wrap">
                        <img src="${thumb}" onerror="this.onerror=null;this.src='${escapeHtml(c.picture)}'" data-full-src="${escapeHtml(c.picture || '/static/images/avatars/default.png')}" class="page-inbox-conv-avatar" alt="${escapeHtml(c.name)}">
                        ${onlineDot}
                    </div>
                    <div class="page-inbox-conv-info">
                        <div class="page-inbox-conv-top">
                            <span class="page-inbox-conv-name">${escapeHtml(c.name)}</span>
                            <span class="page-inbox-conv-time">${escapeHtml(c.time_ago)}</span>
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
        openConversation(friendId);
        if (window.innerWidth < 768) {
            closeChatSidebar();
        }
    };

    async function openConversation(friendId) {
        if (!friendId) return;
        activeFriendId = Number(friendId);
        knownMessageIds.clear();

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

            // Update Header
            if (chatHeader) chatHeader.style.display = 'flex';
            if (inputArea) inputArea.style.display = 'block';
            if (chatName) chatName.textContent = activeFriend.name;
            if (chatAvatar) {
                chatAvatar.src = getAvatarThumb(activeFriend.picture);
                chatAvatar.dataset.fullSrc = activeFriend.picture || '';
                chatAvatar.onerror = function () { this.onerror = null; this.src = activeFriend.picture; };
            }
            if (chatOnlineDot) {
                chatOnlineDot.classList.toggle('d-none', !activeFriend.online);
            }
            if (chatStatus) {
                chatStatus.textContent = activeFriend.online ? 'Online' : 'Offline';
            }
            if (chatProfileLink) {
                chatProfileLink.href = `/user/${encodeURIComponent(activeFriend.username || activeFriend.id)}/`;
            }

            // Clear unread badge in sidebar
            const convEl = conversationsList.querySelector(`[data-friend-id="${friendId}"]`);
            if (convEl) {
                const b = convEl.querySelector('.page-inbox-conv-badge');
                if (b) b.remove();
            }

            // Render Messages
            messagesContainer.innerHTML = '';
            const msgs = data.messages || [];
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
                scrollToBottom(false);
            }

            // Attach Firebase listeners
            attachFirebaseListeners(activeChatId);

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

        const createdTs = msg.created_at ? Math.floor(new Date(msg.created_at).getTime() / 1000) : 0;
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

        const editedHtml = msg.edited ? ' <span class="chat-edited-tag">(edited)</span>' : '';
        const timeHtml = `<div class="page-inbox-msg-time">${escapeHtml(msg.time || '')}${editedHtml}</div>`;

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
        messagesContainer.appendChild(row);

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
                    updateConvSnippet(activeFriendId, sendData.message.message);
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
                    updateConvSnippet(activeFriendId, '🎤 Voice message');
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

                if (!knownMessageIds.has(String(msg.id))) {
                    knownMessageIds.add(String(msg.id));
                    const emptyChat = messagesContainer.querySelector('.page-inbox-empty-chat');
                    if (emptyChat) emptyChat.remove();

                    renderMessageRow(msg);
                    scrollToBottom(true);
                }
                updateConvSnippet(activeFriendId, text);
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
        try {
            const formData = new FormData();
            formData.append('friend_id', friendId);
            await fetch('/api/chat/read/', {
                method: 'POST',
                headers: { 'X-CSRFToken': getCsrfToken() },
                body: formData
            });
        } catch (e) {
            console.warn('markConversationRead error:', e);
        }
    }

    function updateConvSnippet(friendId, text) {
        const item = conversationsList ? conversationsList.querySelector(`[data-friend-id="${friendId}"]`) : null;
        if (!item) return;
        const msgEl = item.querySelector('.page-inbox-conv-last-msg');
        if (msgEl) {
            msgEl.textContent = text.length > 40 ? text.slice(0, 40) + '...' : text;
        }
        const timeEl = item.querySelector('.page-inbox-conv-time');
        if (timeEl) {
            timeEl.textContent = 'Just now';
        }
        // Move to top of conversations list
        if (conversationsList && item !== conversationsList.firstElementChild) {
            conversationsList.prepend(item);
        }
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
