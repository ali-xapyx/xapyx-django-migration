/**
 * Chat Roulette Client Module
 * Redis-backed atomic matchmaking with Firebase RTDB instant synchronization & WebRTC peer connection.
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
    const reportForm = document.getElementById('rouletteReportForm');
    const reportReason = document.getElementById('rouletteReportReason');
    const reportDetails = document.getElementById('rouletteReportDetails');
    const reportDetailsRequired = document.getElementById('rouletteReportDetailsRequired');
    const reportDetailsError = document.getElementById('rouletteReportDetailsError');
    const reportSubmitBtn = document.getElementById('rouletteReportSubmitBtn');

    const onlineStatsEl = document.getElementById('rouletteOnlineStats');
    const dotsEl = document.getElementById('rouletteDots');

    const partnerAvatar = document.getElementById('roulettePartnerAvatar');
    const partnerName = document.getElementById('roulettePartnerName');
    const partnerUsername = document.getElementById('roulettePartnerUsername');

    const messagesContainer = document.getElementById('rouletteMessagesContainer');
    const scrollBtn = document.getElementById('rouletteScrollBtn');
    
    // Support both ID naming conventions
    const sendForm = document.getElementById('rouletteChatForm') || document.getElementById('rouletteSendForm');
    const msgInput = document.getElementById('rouletteMessageInput') || document.getElementById('rouletteMsgInput');
    const sendBtn = document.getElementById('rouletteSendBtn');

    // ---- Config & State ----
    let config = {
        currentUserId: 0,
        currentUserName: '',
        currentUserPicture: '',
        firebaseDbUrl: 'https://xapyx-chat-default-rtdb.firebaseio.com'
    };

    const cfgEl = document.getElementById('rouletteConfig');
    if (cfgEl) {
        try {
            config = Object.assign(config, JSON.parse(cfgEl.textContent));
        } catch (e) {
            console.error('[Roulette] Failed to parse rouletteConfig:', e);
        }
    }
    if (!config.currentUserId && window.XPY_CONFIG) {
        config.currentUserId = Number(window.XPY_CONFIG.userId || 0);
    }
    const currentUserId = Number(config.currentUserId || 0);

    let currentStatus = 'idle'; // 'idle' | 'waiting' | 'matched'
    let activePartner = null;
    let activeSessionId = null;
    let isInitiator = false;
    let sinceId = 0;
    const knownMsgIds = new Set();

    let pollTimer = null;
    let statsTimer = null;
    let dotTimer = null;
    let heartbeatTimer = null;

    // Firebase References
    let firebaseDb = null;
    let fbQueueRef = null;
    let fbMatchRef = null;
    let fbRoomStatusRef = null;
    let fbRoomMessagesRef = null;
    let fbSignalsRef = null;

    // WebRTC Peer Connection
    const RTC_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };
    let peerConnection = null;
    let dataChannel = null;

    // ---- Utilities ----
    function getCsrfToken() {
        const inp = document.querySelector('[name=csrfmiddlewaretoken]');
        if (inp && inp.value) return inp.value;
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
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

    // ---- Firebase RTDB Initialization ----
    function initFirebase() {
        try {
            if (typeof firebase === 'undefined') {
                console.warn('[Roulette] Firebase SDK not loaded, using HTTP fallback');
                return;
            }
            const fbConfig = { databaseURL: config.firebaseDbUrl };
            let app;
            try {
                app = firebase.app('xapyx-roulette-app');
            } catch (err) {
                app = firebase.initializeApp(fbConfig, 'xapyx-roulette-app');
            }
            firebaseDb = firebase.database(app);
            console.log('[Roulette] Firebase RTDB initialized successfully');
        } catch (e) {
            console.warn('[Roulette] Firebase init warning:', e);
        }
    }

    function attachQueueListeners() {
        detachQueueListeners();
        if (!firebaseDb || !currentUserId) return;

        try {
            // 1. Presence in queue with onDisconnect removal
            fbQueueRef = firebaseDb.ref('roulette/queue/' + currentUserId);
            fbQueueRef.set({
                userId: currentUserId,
                joined_at: firebase.database.ServerValue.TIMESTAMP
            });
            fbQueueRef.onDisconnect().remove();

            // 2. Instant Match listener (Firebase push)
            fbMatchRef = firebaseDb.ref('roulette/matches/' + currentUserId);
            fbMatchRef.on('value', (snapshot) => {
                const match = snapshot.val();
                if (match && match.session_id && currentStatus !== 'matched') {
                    console.log('[Roulette] Instant match via Firebase listener:', match);
                    stopPolling();
                    stopDotAnimation();
                    startRouletteSession(match);
                }
            });
            fbMatchRef.onDisconnect().remove();
        } catch (err) {
            console.warn('[Roulette] attachQueueListeners error:', err);
        }
    }

    function detachQueueListeners() {
        if (fbQueueRef) {
            try {
                fbQueueRef.off();
                fbQueueRef.remove();
                fbQueueRef.onDisconnect().cancel();
            } catch (e) {}
            fbQueueRef = null;
        }
        if (fbMatchRef) {
            try {
                fbMatchRef.off();
                fbMatchRef.remove();
                fbMatchRef.onDisconnect().cancel();
            } catch (e) {}
            fbMatchRef = null;
        }
    }

    function attachRoomListeners(sessionId) {
        detachRoomListeners();
        if (!firebaseDb || !sessionId) return;

        try {
            // 1. Instant partner left / disconnected status
            fbRoomStatusRef = firebaseDb.ref('roulette/rooms/' + sessionId + '/status');
            fbRoomStatusRef.on('value', (snap) => {
                const val = snap.val();
                if ((val === 'left' || val === 'expired') && currentStatus === 'matched') {
                    console.log('[Roulette] Room status changed to', val);
                    handlePartnerLeft();
                }
            });
            fbRoomStatusRef.onDisconnect().set('left');

            // 2. Instant incoming messages
            fbRoomMessagesRef = firebaseDb.ref('roulette/rooms/' + sessionId + '/messages');
            fbRoomMessagesRef.on('child_added', (snap) => {
                const msg = snap.val();
                if (msg && msg.id) {
                    if (!knownMsgIds.has(String(msg.id))) {
                        knownMsgIds.add(String(msg.id));
                        renderMessageRow(msg);
                        scrollToBottom(true);
                    }
                }
            });
        } catch (err) {
            console.warn('[Roulette] attachRoomListeners error:', err);
        }
    }

    function detachRoomListeners() {
        if (fbRoomStatusRef) {
            try {
                fbRoomStatusRef.off();
                fbRoomStatusRef.onDisconnect().cancel();
            } catch (e) {}
            fbRoomStatusRef = null;
        }
        if (fbRoomMessagesRef) {
            try {
                fbRoomMessagesRef.off();
            } catch (e) {}
            fbRoomMessagesRef = null;
        }
    }

    // ---- WebRTC Peer Connection Handshake ----
    function initWebRtcHandshake(sessionId, partnerId, initiator) {
        closeWebRtc();
        if (typeof RTCPeerConnection === 'undefined') {
            console.warn('[Roulette] WebRTC not supported in this browser environment');
            return;
        }

        try {
            peerConnection = new RTCPeerConnection(RTC_CONFIG);

            // ICE candidate handler
            peerConnection.onicecandidate = (event) => {
                if (event.candidate && firebaseDb && sessionId) {
                    const candRef = firebaseDb.ref('roulette/rooms/' + sessionId + '/signals/' + currentUserId + '/candidates');
                    candRef.push(event.candidate.toJSON()).catch(() => {});
                }
            };

            peerConnection.onconnectionstatechange = () => {
                console.log('[Roulette WebRTC] Connection state:', peerConnection.connectionState);
            };

            if (initiator) {
                // Initiator creates data channel and offer
                try {
                    dataChannel = peerConnection.createDataChannel('roulette-data', { ordered: true });
                    setupDataChannel(dataChannel);
                } catch (e) {
                    console.warn('[Roulette] DataChannel create error:', e);
                }

                peerConnection.createOffer().then((offer) => {
                    return peerConnection.setLocalDescription(offer);
                }).then(() => {
                    if (firebaseDb && sessionId) {
                        firebaseDb.ref('roulette/rooms/' + sessionId + '/signals/' + currentUserId + '/offer').set({
                            type: peerConnection.localDescription.type,
                            sdp: peerConnection.localDescription.sdp
                        }).catch(() => {});
                    }
                }).catch((err) => {
                    console.warn('[Roulette] WebRTC offer error:', err);
                });
            } else {
                // Receiver listens for incoming datachannel
                peerConnection.ondatachannel = (event) => {
                    dataChannel = event.channel;
                    setupDataChannel(dataChannel);
                };
            }

            // Signal exchange via Firebase RTDB
            if (firebaseDb && sessionId && partnerId) {
                fbSignalsRef = firebaseDb.ref('roulette/rooms/' + sessionId + '/signals/' + partnerId);

                if (!initiator) {
                    // Receiver waits for offer, creates answer
                    fbSignalsRef.child('offer').on('value', async (snap) => {
                        const offer = snap.val();
                        if (offer && peerConnection && peerConnection.signalingState === 'stable') {
                            try {
                                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                                const answer = await peerConnection.createAnswer();
                                await peerConnection.setLocalDescription(answer);
                                firebaseDb.ref('roulette/rooms/' + sessionId + '/signals/' + currentUserId + '/answer').set({
                                    type: answer.type,
                                    sdp: answer.sdp
                                }).catch(() => {});
                            } catch (err) {
                                console.warn('[Roulette] WebRTC answer error:', err);
                            }
                        }
                    });
                } else {
                    // Initiator waits for answer
                    fbSignalsRef.child('answer').on('value', async (snap) => {
                        const answer = snap.val();
                        if (answer && peerConnection && peerConnection.signalingState === 'have-local-offer') {
                            try {
                                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                            } catch (err) {
                                console.warn('[Roulette] WebRTC remote answer error:', err);
                            }
                        }
                    });
                }

                // Remote ICE candidates
                fbSignalsRef.child('candidates').on('child_added', async (snap) => {
                    const cand = snap.val();
                    if (cand && peerConnection) {
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                        } catch (e) {
                            // Candidate addition error ignored
                        }
                    }
                });
            }
        } catch (err) {
            console.warn('[Roulette] WebRTC init error:', err);
        }
    }

    function setupDataChannel(channel) {
        if (!channel) return;
        channel.onopen = () => {
            console.log('[Roulette WebRTC] DataChannel connected');
        };
        channel.onclose = () => {
            console.log('[Roulette WebRTC] DataChannel closed');
        };
        channel.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg && msg.id && !knownMsgIds.has(String(msg.id))) {
                    knownMsgIds.add(String(msg.id));
                    renderMessageRow(msg);
                    scrollToBottom(true);
                }
            } catch (e) {}
        };
    }

    function closeWebRtc() {
        if (fbSignalsRef) {
            try { fbSignalsRef.off(); } catch (e) {}
            fbSignalsRef = null;
        }
        if (dataChannel) {
            try { dataChannel.close(); } catch (e) {}
            dataChannel = null;
        }
        if (peerConnection) {
            try { peerConnection.close(); } catch (e) {}
            peerConnection = null;
        }
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

    // ---- Session Initialization (Immediate Handshake) ----
    function startRouletteSession(matchData) {
        if (!matchData) return;

        // Immediately stop searching timers to prevent unnecessary cycles
        stopPolling();
        stopDotAnimation();

        const sessionId = matchData.session_id || matchData.sessionId || matchData.room_id;
        if (!sessionId) return;

        // Guard against duplicate connection attempts
        if (activeSessionId === sessionId && currentStatus === 'matched') {
            return;
        }

        const partner = matchData.partner || {
            id: matchData.partner_id || matchData.partnerId,
            name: matchData.partner_name || matchData.partnerName || 'Anonymous User',
            username: matchData.partner_username || matchData.partnerUsername || 'anonymous',
            picture: matchData.partner_picture || matchData.partnerPicture || '/static/images/avatars/default.png'
        };

        // Cleanly evaluate isInitiator: (Number(currentUserId) < Number(matchData.partner_id))
        const partnerId = Number(partner.id || matchData.partner_id || 0);
        let initiator = false;
        if (typeof matchData.is_initiator === 'boolean') {
            initiator = matchData.is_initiator;
        } else {
            initiator = Number(currentUserId) < partnerId;
        }

        setupMatch(partner, sessionId, initiator);
        initWebRtcHandshake(sessionId, partnerId, initiator);
    }

    function setupMatch(partner, sessionId, initiator) {
        detachQueueListeners();

        activePartner = partner;
        activeSessionId = sessionId;
        isInitiator = initiator;
        sinceId = 0;
        knownMsgIds.clear();

        if (partnerAvatar) partnerAvatar.src = getAvatarThumb(partner.picture);
        if (partnerName) partnerName.textContent = partner.name || 'Anonymous User';
        if (partnerUsername) partnerUsername.textContent = '@' + (partner.username || 'user');

        if (messagesContainer) {
            messagesContainer.innerHTML = '';
            const notice = document.createElement('div');
            notice.className = 'roulette-match-notice text-center my-3';
            notice.innerHTML = `<span class="badge bg-secondary-subtle text-muted px-3 py-2">Connected with <strong>${escapeHtml(partner.name || 'Anonymous')}</strong>. Say hello!</span>`;
            messagesContainer.appendChild(notice);
        }

        showState('matched');
        notify('Connected with a partner!', 'success');
        scrollToBottom(false);

        // Attach Firebase real-time room listeners for instant messaging and status
        attachRoomListeners(sessionId);
    }

    function resetChat() {
        closeWebRtc();
        activePartner = null;
        activeSessionId = null;
        isInitiator = false;
        sinceId = 0;
        knownMsgIds.clear();
        if (messagesContainer) messagesContainer.innerHTML = '';
    }

    function handlePartnerLeft() {
        if (currentStatus !== 'matched') return;
        detachRoomListeners();
        resetChat();
        notify('Partner has left the chat. Re-searching...', 'warning');
        startSearching();
    }

    // ---- Main Matchmaking Flow ----
    async function startSearching() {
        // Explicitly clean up old state & listeners first
        if (firebaseDb && currentUserId) {
            try {
                const mRef = firebaseDb.ref('roulette/matches/' + currentUserId);
                mRef.off();
                mRef.remove();
                const qRef = firebaseDb.ref('roulette/queue/' + currentUserId);
                qRef.off();
                qRef.remove();
            } catch (e) {}
        }
        detachRoomListeners();
        detachQueueListeners();
        resetChat();
        stopPolling();
        stopDotAnimation();
        showState('waiting');
        attachQueueListeners();

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
                stopPolling();
                stopDotAnimation();
                startRouletteSession(data);
            }
        } catch (err) {
            console.error('[Roulette] join error:', err);
            notify('Failed to connect to matchmaking queue', 'error');
            detachQueueListeners();
            showState('idle');
        }
    }

    async function stopSearching() {
        if (firebaseDb && currentUserId) {
            try {
                const mRef = firebaseDb.ref('roulette/matches/' + currentUserId);
                mRef.off();
                mRef.remove();
                const qRef = firebaseDb.ref('roulette/queue/' + currentUserId);
                qRef.off();
                qRef.remove();
            } catch (e) {}
        }
        detachQueueListeners();
        stopPolling();
        stopDotAnimation();
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
            console.error('[Roulette] leave queue error:', err);
        } finally {
            showState('idle');
        }
    }

    async function leaveChat() {
        if (firebaseDb) {
            try {
                if (activeSessionId) {
                    firebaseDb.ref('roulette/rooms/' + activeSessionId + '/status').set('left');
                }
                if (currentUserId) {
                    const mRef = firebaseDb.ref('roulette/matches/' + currentUserId);
                    mRef.off();
                    mRef.remove();
                    const qRef = firebaseDb.ref('roulette/queue/' + currentUserId);
                    qRef.off();
                    qRef.remove();
                }
            } catch (e) {}
        }
        detachRoomListeners();
        detachQueueListeners();
        stopPolling();
        stopDotAnimation();

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
            console.error('[Roulette] leave chat error:', err);
        } finally {
            resetChat();
            showState('idle');
            notify('You left the chat', 'info');
        }
    }

    // ---- Polling Loop (Fallback) ----
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
                    stopPolling();
                    stopDotAnimation();
                    startRouletteSession(data);
                }
            } else if (currentStatus === 'matched') {
                if (data.status === 'left') {
                    handlePartnerLeft();
                } else if (data.status === 'idle') {
                    detachRoomListeners();
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
                const m = data.message;
                if (!knownMsgIds.has(String(m.id))) {
                    knownMsgIds.add(String(m.id));
                    renderMessageRow(m);
                    scrollToBottom(true);
                }

                // If WebRTC dataChannel is open, also push directly to peer
                if (dataChannel && dataChannel.readyState === 'open') {
                    try {
                        dataChannel.send(JSON.stringify(m));
                    } catch (e) {}
                }
            } else if (data.error) {
                notify(data.error, 'warning');
            }
        } catch (err) {
            console.error('[Roulette] send error:', err);
            notify('Failed to send message', 'error');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
            if (msgInput) msgInput.focus();
        }
    }

    function renderMessageRow(msg) {
        if (!messagesContainer) return;

        const isMe = Number(msg.sender_id) === Number(currentUserId);
        const row = document.createElement('div');
        row.className = `roulette-msg-row ${isMe ? 'msg-outgoing' : 'msg-incoming'}`;

        const bubble = document.createElement('div');
        bubble.className = `roulette-msg-bubble ${isMe ? 'bubble-outgoing' : 'bubble-incoming'}`;

        const textDiv = document.createElement('div');
        textDiv.className = 'roulette-msg-text';
        textDiv.textContent = msg.text || '';
        bubble.appendChild(textDiv);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'roulette-msg-time';
        timeSpan.style.fontSize = '0.75rem';
        timeSpan.style.display = 'block';
        timeSpan.style.textAlign = isMe ? 'right' : 'left';
        timeSpan.style.marginTop = '2px';
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

    // ---- Next Partner & Heartbeat ----
    async function nextChat() {
        if (nextChatBtn) nextChatBtn.disabled = true;

        // 1. Explicitly clean up old Firebase room listener, room status, and queue/match listeners
        if (firebaseDb) {
            try {
                if (activeSessionId) {
                    firebaseDb.ref('roulette/rooms/' + activeSessionId + '/status').set('left');
                }
                if (currentUserId) {
                    const mRef = firebaseDb.ref('roulette/matches/' + currentUserId);
                    mRef.off();
                    mRef.remove();
                    const qRef = firebaseDb.ref('roulette/queue/' + currentUserId);
                    qRef.off();
                    qRef.remove();
                }
            } catch (e) {}
        }
        detachRoomListeners();
        detachQueueListeners();
        resetChat();
        stopPolling();
        stopDotAnimation();
        showState('waiting');
        attachQueueListeners();

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
                stopPolling();
                stopDotAnimation();
                startRouletteSession(data);
            }
        } catch (err) {
            console.error('[Roulette] next error:', err);
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
                    detachRoomListeners();
                    detachQueueListeners();
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
                startRouletteSession(data);
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
                attachQueueListeners();
            } else {
                showState('idle');
            }
        } catch (err) {
            showState('idle');
        }
    }

    // ---- Moderation & Report ----
    if (reportReason) {
        reportReason.addEventListener('change', function () {
            const isOther = this.value === 'Other';
            if (reportDetailsRequired) reportDetailsRequired.classList.toggle('d-none', !isOther);
            if (reportDetails) reportDetails.required = isOther;
            if (reportDetailsError) reportDetailsError.classList.add('d-none');
        });
    }

    if (reportForm) {
        reportForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const reason = reportReason ? reportReason.value : '';
            const details = reportDetails ? reportDetails.value.trim() : '';

            if (reason === 'Other' && !details) {
                if (reportDetailsError) reportDetailsError.classList.remove('d-none');
                if (reportDetails) reportDetails.focus();
                return;
            }

            if (reportSubmitBtn) {
                reportSubmitBtn.disabled = true;
                reportSubmitBtn.innerHTML = '<span class="btn-spinner"></span> Submitting...';
            }

            try {
                const formData = new FormData();
                formData.append('partner_id', activePartner ? activePartner.id : '');
                formData.append('reason', reason);
                formData.append('details', details);

                const res = await fetch('/api/roulette/report/', {
                    method: 'POST',
                    headers: {
                        'X-CSRFToken': getCsrfToken(),
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: formData
                });

                const data = await res.json();
                if (data.success) {
                    const modalEl = document.getElementById('rouletteReportModal');
                    if (modalEl && window.bootstrap) {
                        const modalInstance = bootstrap.Modal.getInstance(modalEl);
                        if (modalInstance) modalInstance.hide();
                    }
                    reportForm.reset();
                    if (reportDetailsRequired) reportDetailsRequired.classList.add('d-none');
                    detachRoomListeners();
                    detachQueueListeners();
                    resetChat();
                    showState('idle');
                    notify('User reported. Chat ended.', 'warning');
                } else {
                    notify(data.error || 'Failed to submit report', 'error');
                }
            } catch (err) {
                notify('Network error reporting user', 'error');
            } finally {
                if (reportSubmitBtn) {
                    reportSubmitBtn.disabled = false;
                    reportSubmitBtn.innerHTML = 'Submit Report';
                }
            }
        });
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

    // Tab close / navigation cleanup
    window.addEventListener('beforeunload', () => {
        if (currentStatus !== 'idle') {
            try {
                if (firebaseDb) {
                    if (activeSessionId) {
                        firebaseDb.ref('roulette/rooms/' + activeSessionId + '/status').set('left');
                    }
                    if (currentUserId) {
                        firebaseDb.ref('roulette/matches/' + currentUserId).remove();
                        firebaseDb.ref('roulette/queue/' + currentUserId).remove();
                    }
                }
            } catch (e) {}
            try {
                const formData = new FormData();
                formData.append('csrfmiddlewaretoken', getCsrfToken());
                navigator.sendBeacon('/api/roulette/leave/', formData);
            } catch (e) {}
        }
    });

    // ---- Initialization ----
    initFirebase();
    startHeartbeat();
    checkInitialState();
})();
