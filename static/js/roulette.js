/**
 * Chat Roulette Client Module (Task 19 Phase 1)
 * Redis-backed ephemeral matchmaking & chat.
 */
(function () {
    'use strict';

    // ---- DOM Elements ----
    const idleState = document.getElementById('rouletteIdleState');
    const waitingState = document.getElementById('rouletteWaitingState');
    const matchedState = document.getElementById('rouletteMatchedState');

    const startSearchBtn = document.getElementById('startSearchBtn');
    const stopSearchBtn = document.getElementById('stopSearchBtn');
    const leaveChatBtn = document.getElementById('leaveChatBtn');
    const nextChatBtn = document.getElementById('nextChatBtn');

    const onlineStatsEl = document.getElementById('rouletteOnlineStats');
    const dotsEl = document.getElementById('rouletteDots');

    const partnerAvatar = document.getElementById('roulettePartnerAvatar');
    const partnerName = document.getElementById('roulettePartnerName');
    const partnerUsername = document.getElementById('roulettePartnerUsername');

    const messagesContainer = document.getElementById('rouletteMessagesContainer');
    const scrollBtn = document.getElementById('rouletteScrollBtn');
    const sendForm = document.getElementById('rouletteSendForm');
    const msgInput = document.getElementById('rouletteMsgInput');
    const sendBtn = document.getElementById('rouletteSendBtn');

    // ---- State ----
    let currentStatus = 'idle'; // 'idle' | 'waiting' | 'matched'
    let activePartner = null;
    let activeSessionId = null;
    let sinceId = 0;
    const knownMsgIds = new Set();

    let pollTimer = null;
    let statsTimer = null;
    let dotTimer = null;
    let heartbeatTimer = null;
    let currentUserId = 0;

    // Read current user ID if available
    try {
        const xpyConfigEl = document.getElementById('xpy-config');
        if (xpyConfigEl) {
            const conf = JSON.parse(xpyConfigEl.textContent);
            currentUserId = Number(conf.userId || 0);
        }
    } catch (e) {
        currentUserId = 0;
    }

    // ---- Utilities ----
    function getCsrfToken() {
        const inp = document.querySelector('[name=csrfmiddlewaretoken]');
        if (inp && inp.value) return inp.value;
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function getAvatarThumb(av) {
        if (!av || typeof av !== 'string') return '/static/images/avatars/default.png';
        if (av.indexOf('/static/images/avatars/default.png') !== -1) return av;
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(av) && av.indexOf('_avatar.webp') === -1) {
            return av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return av;
    }

    function notify(message, type) {
        if (window.showAlert && typeof window.showAlert === 'function') {
            window.showAlert(message, type || 'info');
        } else {
            console.log(`[Roulette ${type || 'info'}]: ${message}`);
        }
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

    // ---- View Transitions ----
    function showState(state) {
        currentStatus = state;
        if (idleState) idleState.classList.toggle('d-none', state !== 'idle');
        if (waitingState) waitingState.classList.toggle('d-none', state !== 'waiting');
        if (matchedState) matchedState.classList.toggle('d-none', state !== 'matched');

        if (state === 'waiting') {
            startDotAnimation();
        } else {
            stopDotAnimation();
        }

        if (state === 'idle') {
            stopPolling();
            startStatsPolling();
            updateStats();
        } else if (state === 'waiting') {
            stopStatsPolling();
            startPolling(1500);
        } else if (state === 'matched') {
            stopStatsPolling();
            startPolling(1200);
            if (msgInput) msgInput.focus();
        }
    }

    function startDotAnimation() {
        if (dotTimer) clearInterval(dotTimer);
        let dots = 0;
        dotTimer = setInterval(() => {
            dots = (dots + 1) % 4;
            if (dotsEl) dotsEl.textContent = '.'.repeat(dots);
        }, 400);
    }

    function stopDotAnimation() {
        if (dotTimer) {
            clearInterval(dotTimer);
            dotTimer = null;
        }
        if (dotsEl) dotsEl.textContent = '';
    }

    // ---- Stats Polling ----
    async function updateStats() {
        try {
            const res = await fetch('/api/roulette/active/');
            const data = await res.json();
            if (data.success && data.counts && onlineStatsEl) {
                const c = data.counts;
                const waitStr = c.avg_wait_str || (c.avg_wait ? `${c.avg_wait}s` : '12s');
                onlineStatsEl.innerHTML = `<strong>${c.total}</strong> active (${c.waiting} waiting, ${c.chatting} chatting) &bull; Average wait: ${waitStr}`;
            }
        } catch (e) {
            // Silently ignore stats fetch failure
        }
    }

    function startStatsPolling() {
        if (statsTimer) clearInterval(statsTimer);
        statsTimer = setInterval(updateStats, 3000);
    }

    function stopStatsPolling() {
        if (statsTimer) {
            clearInterval(statsTimer);
            statsTimer = null;
        }
    }

    // ---- Main Matchmaking Flow ----
    async function startSearching() {
        showState('waiting');
        try {
            const formData = new FormData();
            const res = await fetch('/api/roulette/join/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });

            const data = await res.json();
            if (data.status === 'matched') {
                setupMatch(data.partner, data.session_id);
            }
        } catch (err) {
            console.error('join error:', err);
            notify('Failed to connect to matchmaking queue', 'error');
            showState('idle');
        }
    }

    async function stopSearching() {
        try {
            const formData = new FormData();
            await fetch('/api/roulette/leave/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });
        } catch (err) {
            console.error('leave queue error:', err);
        } finally {
            showState('idle');
        }
    }

    async function leaveChat() {
        try {
            const formData = new FormData();
            await fetch('/api/roulette/leave/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });
        } catch (err) {
            console.error('leave chat error:', err);
        } finally {
            resetChat();
            showState('idle');
            notify('You left the chat', 'info');
        }
    }

    function setupMatch(partner, sessionId) {
        activePartner = partner;
        activeSessionId = sessionId;
        sinceId = 0;
        knownMsgIds.clear();

        if (partnerAvatar) partnerAvatar.src = getAvatarThumb(partner.picture);
        if (partnerName) partnerName.textContent = partner.name || 'Anonymous User';
        if (partnerUsername) partnerUsername.textContent = '@' + (partner.username || 'user');

        if (messagesContainer) {
            messagesContainer.innerHTML = '';
            // Insert subtle notification banner
            const notice = document.createElement('div');
            notice.className = 'roulette-match-notice text-center my-3';
            notice.innerHTML = `<span class="badge bg-secondary-subtle text-muted px-3 py-2">Connected with <strong>${partner.name || 'Anonymous'}</strong>. Say hello!</span>`;
            messagesContainer.appendChild(notice);
        }

        showState('matched');
        notify('Connected with a partner!', 'success');
        scrollToBottom(false);
    }

    function resetChat() {
        activePartner = null;
        activeSessionId = null;
        sinceId = 0;
        knownMsgIds.clear();
        if (messagesContainer) messagesContainer.innerHTML = '';
    }

    function handlePartnerLeft() {
        resetChat();
        notify('Partner has left the chat. Re-searching...', 'warning');
        // Graceful automatic re-queueing
        startSearching();
    }

    // ---- Polling Loop ----
    function startPolling(intervalMs) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollStep, intervalMs);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function pollStep() {
        if (currentStatus === 'idle') return;

        try {
            const url = `/api/roulette/poll/?since_id=${sinceId}&_=${Date.now()}`;
            const res = await fetch(url, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            if (!res.ok) return;
            const data = await res.json();

            if (currentStatus === 'waiting') {
                if (data.status === 'matched') {
                    setupMatch(data.partner, data.session_id);
                }
            } else if (currentStatus === 'matched') {
                if (data.status === 'left') {
                    handlePartnerLeft();
                } else if (data.status === 'idle') {
                    resetChat();
                    showState('idle');
                    notify('Session ended', 'info');
                } else if (data.status === 'matched') {
                    if (data.messages && data.messages.length) {
                        const threshold = 150;
                        const wasAtBottom = (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight) <= threshold;

                        data.messages.forEach(m => {
                            if (!knownMsgIds.has(String(m.id))) {
                                knownMsgIds.add(String(m.id));
                                renderMessageRow(m);
                            }
                        });

                        sinceId = data.since_id || sinceId;

                        if (wasAtBottom) {
                            scrollToBottom(true);
                        }
                    }
                }
            }
        } catch (err) {
            // Transient network glitch, keep polling
        }
    }

    // ---- Messaging ----
    async function sendMessage() {
        if (currentStatus !== 'matched' || !msgInput) return;
        const text = msgInput.value.trim();
        if (!text) return;

        msgInput.value = '';

        if (sendBtn) sendBtn.disabled = true;

        try {
            const formData = new FormData();
            formData.append('text', text);

            const res = await fetch('/api/roulette/send/', {
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
                if (!knownMsgIds.has(String(msg.id))) {
                    knownMsgIds.add(String(msg.id));
                    renderMessageRow(msg);
                    scrollToBottom(true);
                }
            } else {
                notify(data.error || 'Failed to send message', 'error');
                msgInput.value = text;
            }
        } catch (e) {
            notify('Network error sending message', 'error');
            msgInput.value = text;
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            if (msgInput) msgInput.focus();
        }
    }

    function renderMessageRow(msg) {
        if (!messagesContainer) return;

        const isMe = currentUserId ? (Number(msg.sender_id) === Number(currentUserId)) : false;
        const row = document.createElement('div');
        row.className = `page-inbox-msg-row ${isMe ? 'sent' : 'received'}`;
        row.dataset.msgId = msg.id;

        const bubble = document.createElement('div');
        bubble.className = `chatroom-bubble ${isMe ? 'sent' : 'received'}`;

        const textDiv = document.createElement('div');
        textDiv.className = 'chatroom-msg-text';
        textDiv.textContent = msg.text;
        bubble.appendChild(textDiv);

        const timeSpan = document.createElement('div');
        timeSpan.className = 'chatroom-msg-time text-end mt-1';
        timeSpan.style.fontSize = '0.7rem';
        timeSpan.style.opacity = '0.7';
        timeSpan.textContent = msg.time_str || '';
        bubble.appendChild(timeSpan);

        row.appendChild(bubble);
        messagesContainer.appendChild(row);
    }

    // ---- Scroll Helper ----
    if (messagesContainer) {
        messagesContainer.addEventListener('scroll', () => {
            if (!scrollBtn) return;
            const distFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
            if (distFromBottom > 150) {
                scrollBtn.classList.remove('d-none');
            } else {
                scrollBtn.classList.add('d-none');
            }
        });
    }

    if (scrollBtn) {
        scrollBtn.addEventListener('click', () => {
            scrollToBottom(true);
        });
    }

    // ---- Next Partner & Heartbeat (Phase 2) ----
    async function nextChat() {
        if (nextChatBtn) nextChatBtn.disabled = true;
        resetChat();
        showState('waiting');
        try {
            const formData = new FormData();
            const res = await fetch('/api/roulette/next/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });
            const data = await res.json();
            if (data.status === 'matched') {
                setupMatch(data.partner, data.session_id);
            }
        } catch (err) {
            console.error('next error:', err);
            notify('Error switching partner', 'error');
            startSearching();
        } finally {
            if (nextChatBtn) nextChatBtn.disabled = false;
        }
    }

    async function sendHeartbeat() {
        try {
            const formData = new FormData();
            const res = await fetch('/api/roulette/heartbeat/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                if (currentStatus === 'matched' && (data.status === 'left' || data.partner_expired)) {
                    handlePartnerLeft();
                } else if (data.status === 'idle' && currentStatus !== 'idle') {
                    resetChat();
                    showState('idle');
                }
            }
        } catch (e) {
            // Transient network glitch
        }
    }

    function startHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        sendHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, 15000);
    }

    // ---- Auto-Recovery on Page Load ----
    async function checkInitialState() {
        try {
            const url = `/api/roulette/poll/?since_id=0&_=${Date.now()}`;
            const res = await fetch(url, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!res.ok) {
                showState('idle');
                return;
            }
            const data = await res.json();
            if (data.status === 'matched') {
                setupMatch(data.partner, data.session_id);
                if (data.messages && data.messages.length) {
                    data.messages.forEach(m => {
                        if (!knownMsgIds.has(String(m.id))) {
                            knownMsgIds.add(String(m.id));
                            renderMessageRow(m);
                        }
                    });
                    sinceId = data.since_id || sinceId;
                    scrollToBottom(false);
                }
            } else if (data.status === 'waiting') {
                showState('waiting');
            } else {
                showState('idle');
            }
        } catch (err) {
            showState('idle');
        }
    }

    // ---- Event Listeners ----
    if (startSearchBtn) startSearchBtn.addEventListener('click', startSearching);
    if (stopSearchBtn) stopSearchBtn.addEventListener('click', stopSearching);
    if (leaveChatBtn) leaveChatBtn.addEventListener('click', leaveChat);
    if (nextChatBtn) nextChatBtn.addEventListener('click', nextChat);

    if (sendForm) {
        sendForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendMessage();
        });
    }

    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Ensure session is cleared if user navigates away or closes tab
    window.addEventListener('beforeunload', () => {
        if (currentStatus !== 'idle') {
            try {
                const formData = new FormData();
                formData.append('csrfmiddlewaretoken', getCsrfToken());
                navigator.sendBeacon('/api/roulette/leave/', formData);
            } catch (e) {
                // Ignore
            }
        }
    });

    // ---- Initialization ----
    startHeartbeat();
    checkInitialState();
})();
