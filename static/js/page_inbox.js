/**
 * static/js/page_inbox.js
 * Page Inbox Client: Real-time messaging, conversation list, and WebSocket/Firebase sync.
 * Matches XAPYX dashboard design system and handles Page Admin / User dual view.
 */

(function () {
    'use strict';

    // State
    const state = {
        config: {},
        conversations: [],
        activeConvId: null,
        activePageId: null,
        isPageAdmin: false,
        currentUserId: null,
        firebaseApp: null,
        firebaseDb: null,
        activeMessagesRef: null,
        renderedMsgIds: new Set()
    };

    // DOM Elements
    const elements = {};

    function cacheElements() {
        elements.sidebar = document.getElementById('pageInboxSidebar');
        elements.backdrop = document.getElementById('pageInboxBackdrop');
        elements.convList = document.getElementById('conversationsList');
        elements.convCount = document.getElementById('convCount');
        elements.pageFilter = document.getElementById('pageFilterSelect');
        elements.chatHeader = document.getElementById('chatHeader');
        elements.chatAvatar = document.getElementById('chatAvatar');
        elements.chatName = document.getElementById('chatName');
        elements.chatStatus = document.getElementById('chatStatus');
        elements.chatTypeBadge = document.getElementById('chatTypeBadge');
        elements.chatProfileLink = document.getElementById('chatProfileLink');
        elements.messagesContainer = document.getElementById('messagesContainer');
        elements.emptyState = document.getElementById('emptyStatePlaceholder');
        elements.inputArea = document.getElementById('inputArea');
        elements.messageForm = document.getElementById('messageForm');
        elements.messageInput = document.getElementById('messageInput');
        elements.sendBtn = document.getElementById('sendBtn');
        elements.attachBtn = document.getElementById('attachBtn');
        elements.mediaInput = document.getElementById('mediaInput');
    }

    // Helper: CSRF Token
    function getCsrfToken() {
        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) return input.value;
        const cookie = document.cookie.split('; ').find(row => row.startsWith('csrftoken='));
        return cookie ? cookie.split('=')[1] : '';
    }

    // Helper: Toast alert
    function showToast(msg, type) {
        if (typeof window.showAlert === 'function') {
            window.showAlert(msg, type || 'info');
        } else {
            console.log(`[Alert] ${type}: ${msg}`);
        }
    }

    // Helper: Time ago string
    function formatTimeAgo(isoString) {
        if (!isoString) return '';
        try {
            const dt = new Date(isoString);
            const now = new Date();
            const diffSec = Math.floor((now - dt) / 1000);
            if (diffSec < 0 || diffSec < 60) return 'Just now';
            if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
            if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
            if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
            return `${Math.floor(diffSec / 604800)}w ago`;
        } catch (e) {
            return '';
        }
    }

    function formatMessageTime(isoString) {
        if (!isoString) return '';
        try {
            const dt = new Date(isoString);
            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    // Helper: Avatar thumbnail with _avatar.webp and fallback
    function getAvatarThumbUrl(rawUrl) {
        if (!rawUrl) return '/static/images/avatars/default.png';
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(rawUrl) && !rawUrl.includes('_avatar.webp')) {
            return rawUrl.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return rawUrl;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Initialize Firebase
    function initFirebase() {
        const pagesFirebaseConfig = {
            apiKey: "AIzaSyBmNvcUNfp320IJ4BXLUT3cYSuYbCGchRM",
            authDomain: "xapyx-pages-messages.firebaseapp.com",
            projectId: "xapyx-pages-messages",
            storageBucket: "xapyx-pages-messages.firebasestorage.app",
            messagingSenderId: "346014712131",
            databaseURL: "https://xapyx-pages-messages-default-rtdb.firebaseio.com/"
        };

        try {
            if (typeof firebase !== 'undefined') {
                let existingApp = null;
                try {
                    existingApp = firebase.app('pageInboxApp');
                } catch (e) {
                    // App doesn't exist yet, proceed to initialize
                }

                if (!existingApp) {
                    state.firebaseApp = firebase.initializeApp(pagesFirebaseConfig, 'pageInboxApp');
                } else {
                    state.firebaseApp = existingApp;
                }
                state.firebaseDb = state.firebaseApp.database();
                window.pageInboxFirebase = {
                    app: state.firebaseApp,
                    db: state.firebaseDb
                };
                console.log('✅ Page Inbox Firebase RTDB connected');
            } else {
                console.warn('Firebase SDK not loaded on window');
            }
        } catch (err) {
            console.warn('Failed to initialize Page Inbox Firebase:', err);
        }
    }

    // Mobile Sidebar controls
    window.openPageInboxSidebar = function () {
        if (elements.sidebar) elements.sidebar.classList.add('open');
        if (elements.backdrop) elements.backdrop.classList.add('show');
    };

    window.closePageInboxSidebar = function () {
        if (elements.sidebar) elements.sidebar.classList.remove('open');
        if (elements.backdrop) elements.backdrop.classList.remove('show');
    };

    // Load Conversations
    async function loadConversations(targetPageId) {
        if (!elements.convList) return;

        let url = '/api/pages/conversations/';
        const params = new URLSearchParams();
        if (targetPageId && targetPageId !== 'all') {
            params.set('page_id', targetPageId);
        }
        if (params.toString()) {
            url += '?' + params.toString();
        }

        try {
            const resp = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (!data.success) {
                elements.convList.innerHTML = `<div class="p-3 text-center text-muted">${escapeHtml(data.error || 'Failed to load conversations')}</div>`;
                return;
            }

            state.conversations = data.conversations || [];
            state.isPageAdmin = data.is_page_admin;

            if (elements.convCount) {
                elements.convCount.textContent = `${state.conversations.length} conversation${state.conversations.length === 1 ? '' : 's'}`;
            }

            renderConversationsList();

            // Auto-open if selectedConvId provided or activeConvId matches
            if (state.activeConvId) {
                openConversation(state.activeConvId, false);
            } else if (state.conversations.length > 0 && window.innerWidth >= 768) {
                // Auto-open first conversation on desktop
                openConversation(state.conversations[0].conversation_id, false);
            }
        } catch (e) {
            console.error('Failed to load conversations:', e);
            elements.convList.innerHTML = `<div class="p-3 text-center text-danger">Error loading conversations.</div>`;
        }
    }

    function renderConversationsList() {
        if (!elements.convList) return;

        if (state.conversations.length === 0) {
            elements.convList.innerHTML = `
                <div class="page-inbox-empty-chat text-center py-4">
                    <i class="fas fa-inbox fa-2x mb-2 text-muted"></i>
                    <p class="mb-0 text-muted">No conversations found.</p>
                </div>
            `;
            return;
        }

        let html = '';
        state.conversations.forEach(conv => {
            const isActive = conv.conversation_id === state.activeConvId;
            const hasUnread = conv.unread_count > 0;
            const avatarUrl = getAvatarThumbUrl(conv.display_avatar);
            const timeAgo = conv.time_ago || formatTimeAgo(conv.last_message_time);

            html += `
                <div class="page-inbox-conv-item ${isActive ? 'active' : ''} ${hasUnread ? 'unread' : ''}"
                     data-conv-id="${conv.conversation_id}"
                     onclick="window.PageInbox.selectConversation(${conv.conversation_id})">
                    <div class="page-inbox-conv-avatar-wrap">
                        <img src="${escapeHtml(avatarUrl)}"
                             class="page-inbox-conv-avatar"
                             alt="${escapeHtml(conv.display_name)}"
                             onerror="this.onerror=null;this.src='/static/images/avatars/default.png';">
                    </div>
                    <div class="page-inbox-conv-info">
                        <div class="page-inbox-conv-top">
                            <span class="page-inbox-conv-name">${escapeHtml(conv.display_name)}</span>
                            <span class="page-inbox-conv-time">${escapeHtml(timeAgo)}</span>
                        </div>
                        <div class="page-inbox-conv-bottom">
                            <span class="page-inbox-conv-last-msg">${escapeHtml(conv.last_message || 'No messages yet')}</span>
                            ${hasUnread ? `<span class="page-inbox-conv-badge">${conv.unread_count}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        elements.convList.innerHTML = html;
    }

    // Open Conversation
    async function openConversation(convId, userTriggered = true) {
        if (!convId) return;
        state.activeConvId = convId;
        state.renderedMsgIds.clear();

        // Close mobile drawer on selection
        if (window.innerWidth < 768) {
            window.closePageInboxSidebar();
        }

        // Highlight in sidebar
        renderConversationsList();

        // Update header & show panels
        if (elements.chatHeader) elements.chatHeader.style.display = 'flex';
        if (elements.inputArea) elements.inputArea.style.display = 'block';
        if (elements.emptyState) elements.emptyState.style.display = 'none';

        const currentConv = state.conversations.find(c => c.conversation_id === convId);
        if (currentConv) {
            if (elements.chatName) elements.chatName.textContent = currentConv.display_name;
            if (elements.chatAvatar) {
                elements.chatAvatar.src = getAvatarThumbUrl(currentConv.display_avatar);
                elements.chatAvatar.onerror = function () { this.src = '/static/images/avatars/default.png'; };
            }
            if (elements.chatProfileLink) {
                elements.chatProfileLink.href = currentConv.display_link || '#';
            }
            if (elements.chatTypeBadge) {
                if (currentConv.conversation_type === 'admin') {
                    elements.chatTypeBadge.textContent = currentConv.page_title;
                    elements.chatTypeBadge.className = 'page-inbox-page-admin-badge';
                    elements.chatTypeBadge.style.display = 'inline-block';
                } else {
                    elements.chatTypeBadge.style.display = 'none';
                }
            }
        }

        // Show loading spinner in messages container
        if (elements.messagesContainer) {
            elements.messagesContainer.innerHTML = `
                <div class="text-center py-5 text-muted">
                    <i class="fas fa-spinner fa-spin fa-2x"></i>
                    <p class="mt-2">Loading messages...</p>
                </div>
            `;
        }

        try {
            const resp = await fetch(`/api/pages/messages/?conversation_id=${convId}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (!data.success) {
                elements.messagesContainer.innerHTML = `<div class="p-4 text-center text-danger">${escapeHtml(data.error || 'Failed to load messages')}</div>`;
                return;
            }

            elements.messagesContainer.innerHTML = '';
            const messages = data.messages || [];
            messages.forEach(msg => appendMessageToChat(msg, false));
            scrollToBottom();

            // Mark read on backend
            markConversationRead(convId);

            // Connect Firebase Realtime Listener
            attachFirebaseListener(convId);

            // Focus input
            if (elements.messageInput && userTriggered) {
                elements.messageInput.focus();
            }
        } catch (e) {
            console.error('Error loading messages:', e);
            if (elements.messagesContainer) {
                elements.messagesContainer.innerHTML = `<div class="p-4 text-center text-danger">Failed to load messages.</div>`;
            }
        }
    }

    // Append Message to Stream
    function appendMessageToChat(msg, animate = true) {
        if (!elements.messagesContainer || !msg) return;
        const msgId = msg.id ? String(msg.id) : null;
        if (msgId && state.renderedMsgIds.has(msgId)) {
            return; // Dedup
        }
        if (msgId) state.renderedMsgIds.add(msgId);

        const isMe = String(msg.sender_id) === String(state.currentUserId);
        const avatarUrl = getAvatarThumbUrl(msg.sender_picture);
        const timeStr = formatMessageTime(msg.created_at);

        let contentHtml = escapeHtml(msg.message || '');
        // Attachment parsing if message has [attachment:URL]
        const attachmentMatch = (msg.message || '').match(/\[attachment:(https?:\/\/[^\]]+)\]/);
        if (attachmentMatch) {
            const url = attachmentMatch[1];
            const cleanText = msg.message.replace(/\[attachment:https?:\/\/[^\]]+\]/, '').trim();
            const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
            contentHtml = `
                ${cleanText ? `<div>${escapeHtml(cleanText)}</div>` : ''}
                <div class="mt-2">
                    ${isImg
                        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" style="max-width:220px;max-height:180px;border-radius:8px;" alt="Attachment"></a>`
                        : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-light"><i class="fas fa-file-download me-1"></i> View attachment</a>`
                    }
                </div>
            `;
        }

        const row = document.createElement('div');
        row.className = `page-inbox-msg-row ${isMe ? 'sent' : 'received'}`;
        if (!animate) row.style.animation = 'none';

        row.innerHTML = `
            <div class="page-inbox-msg-avatar-wrap">
                <img src="${escapeHtml(avatarUrl)}"
                     class="page-inbox-msg-avatar"
                     alt="${escapeHtml(msg.sender_name || 'User')}"
                     onerror="this.onerror=null;this.src='/static/images/avatars/default.png';">
            </div>
            <div class="page-inbox-bubble ${isMe ? 'sent' : 'received'}">
                <div class="page-inbox-msg-sender">${escapeHtml(msg.sender_name || msg.sender_username || (isMe ? 'You' : 'User'))}</div>
                <div class="page-inbox-msg-text">${contentHtml}</div>
                <div class="page-inbox-msg-time">${escapeHtml(timeStr)}</div>
            </div>
        `;

        elements.messagesContainer.appendChild(row);
    }

    function scrollToBottom() {
        if (!elements.messagesContainer) return;
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }

    // Mark Read
    async function markConversationRead(convId) {
        try {
            await fetch('/api/pages/messages/read/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: new URLSearchParams({ conversation_id: convId })
            });

            // Clear badge in local state & sidebar
            const conv = state.conversations.find(c => c.conversation_id === convId);
            if (conv) {
                conv.unread_count = 0;
                renderConversationsList();
            }
        } catch (e) {
            console.warn('Failed to mark read:', e);
        }
    }

    // Attach Firebase Realtime Listener
    function attachFirebaseListener(convId) {
        if (!state.firebaseDb) return;

        // Detach existing listener
        if (state.activeMessagesRef) {
            state.activeMessagesRef.off();
            state.activeMessagesRef = null;
        }

        try {
            state.activeMessagesRef = state.firebaseDb.ref(`conversations/${convId}/messages`);
            state.activeMessagesRef.on('child_added', snapshot => {
                const data = snapshot.val();
                if (!data) return;

                const msgObj = {
                    id: data.id || snapshot.key,
                    conversation_id: convId,
                    sender_id: data.sender_id,
                    sender_name: data.sender_name,
                    sender_username: data.sender_username,
                    sender_picture: data.sender_picture,
                    sender_type: data.sender_type,
                    message: data.message,
                    created_at: data.created_at ? new Date(data.created_at).toISOString() : new Date().toISOString()
                };

                const wasAtBottom = elements.messagesContainer &&
                    (elements.messagesContainer.scrollHeight - elements.messagesContainer.scrollTop <= elements.messagesContainer.clientHeight + 120);

                appendMessageToChat(msgObj, true);

                if (wasAtBottom || String(msgObj.sender_id) === String(state.currentUserId)) {
                    scrollToBottom();
                }

                // Update last message in sidebar
                const conv = state.conversations.find(c => c.conversation_id === convId);
                if (conv) {
                    conv.last_message = data.message || '';
                    conv.last_message_time = new Date().toISOString();
                    conv.time_ago = 'Just now';
                    renderConversationsList();
                }
            });
            console.log(`📡 Listening for messages on conv ${convId}`);
        } catch (err) {
            console.warn('Firebase attach listener error:', err);
        }
    }

    // Send Message
    async function sendMessage() {
        if (!elements.messageInput || !state.activeConvId) return;
        const text = elements.messageInput.value.trim();
        if (!text) return;

        elements.messageInput.value = '';
        if (elements.sendBtn) elements.sendBtn.disabled = true;

        try {
            const resp = await fetch('/api/pages/messages/send/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: new URLSearchParams({
                    conversation_id: state.activeConvId,
                    message: text
                })
            });

            const data = await resp.json();
            if (!data.success) {
                showToast(data.error || 'Failed to send message', 'error');
                elements.messageInput.value = text;
                return;
            }

            // Append optimistic if Firebase didn't already
            if (data.message) {
                appendMessageToChat(data.message, true);
                scrollToBottom();
            }
        } catch (e) {
            console.error('Error sending message:', e);
            showToast('Network error sending message', 'error');
            elements.messageInput.value = text;
        } finally {
            if (elements.sendBtn) elements.sendBtn.disabled = false;
            elements.messageInput.focus();
        }
    }

    // Handle File Attachment Upload
    async function handleAttachmentUpload(e) {
        const file = e.target.files && e.target.files[0];
        if (!file || !state.activeConvId) return;

        if (typeof window.uploadFileDirect !== 'function') {
            showToast('Direct file upload is unavailable.', 'warning');
            return;
        }

        showToast('Uploading attachment...', 'info');
        try {
            const result = await window.uploadFileDirect(file, 'post');
            if (result && result.public_url) {
                const messageWithAttachment = `[attachment:${result.public_url}]`;
                const resp = await fetch('/api/pages/messages/send/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-CSRFToken': getCsrfToken(),
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: new URLSearchParams({
                        conversation_id: state.activeConvId,
                        message: messageWithAttachment
                    })
                });
                const data = await resp.json();
                if (data.success && data.message) {
                    appendMessageToChat(data.message, true);
                    scrollToBottom();
                    showToast('Attachment sent!', 'success');
                }
            } else {
                throw new Error('No public URL returned from upload');
            }
        } catch (err) {
            console.error('Attachment upload failed:', err);
            showToast('Attachment upload failed: ' + (err.message || err), 'error');
        } finally {
            if (elements.mediaInput) elements.mediaInput.value = '';
        }
    }

    // Initializer
    document.addEventListener('DOMContentLoaded', () => {
        cacheElements();

        // Read metadata config
        const configScript = document.getElementById('pageInboxConfig');
        if (configScript) {
            try {
                state.config = JSON.parse(configScript.textContent);
                state.activeConvId = state.config.selectedConvId || null;
                state.activePageId = state.config.selectedPageId || null;
                state.isPageAdmin = Boolean(state.config.isPageAdmin);
                state.currentUserId = state.config.currentUserId || null;
            } catch (e) {
                console.error('Failed to parse pageInboxConfig:', e);
            }
        }

        // Initialize Firebase
        initFirebase();

        // Wire Event Listeners
        if (elements.pageFilter) {
            elements.pageFilter.addEventListener('change', (e) => {
                loadConversations(e.target.value);
            });
        }

        if (elements.messageForm) {
            elements.messageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                sendMessage();
            });
        }

        if (elements.messageInput) {
            elements.messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }

        if (elements.attachBtn && elements.mediaInput) {
            elements.attachBtn.addEventListener('click', () => {
                elements.mediaInput.click();
            });
            elements.mediaInput.addEventListener('change', handleAttachmentUpload);
        }

        // Initial Load
        loadConversations(state.activePageId);
    });

    // Global hook for inline handlers
    window.PageInbox = {
        selectConversation: (id) => openConversation(id, true),
        sendMessage,
        openSidebar: window.openPageInboxSidebar,
        closeSidebar: window.closePageInboxSidebar
    };

})();
