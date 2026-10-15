/**
 * XAPYX Admin Portal -- Phase 2 Support Center Controller
 * Matches PHP /admin/model/support.php + Firebase RTDB sync
 */

(function () {
    'use strict';

    const ADMSUP_FIREBASE_CONFIG = {
        apiKey: "AIzaSyBfCPN45VXRAh8DWapGC99pN0ZW30XVr0c",
        authDomain: "xapyx-2.firebaseapp.com",
        databaseURL: "https://xapyx-2-default-rtdb.firebaseio.com",
        projectId: "xapyx-2",
        storageBucket: "xapyx-2.firebasestorage.app",
        messagingSenderId: "299679702522",
        appId: "1:299679702522:web:7ecba6517bc25545f25843"
    };

    function getCsrfToken() {
        if (window.ADMSUP_CSRF_TOKEN) return window.ADMSUP_CSRF_TOKEN;
        const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    class AdminSupportSystem {
        constructor() {
            this.admin = window.ADMSUP_ADMIN_USER || { id: 1, name: 'Support Team' };
            this.db = null;
            this.currentTicketId = null;
            this.currentTicketData = null;
            this.currentUserData = null;
            this.currentFirebaseTicketId = null;
            this.firebaseListeners = {};
            this.pendingMedia = [];
            this.activeStatusFilter = 'all';
            this.activePriorityFilter = 'all';
            this.searchTimer = null;

            this.initFirebase();
            this.bindEvents();
        }

        initFirebase() {
            try {
                if (typeof firebase !== 'undefined') {
                    let app;
                    if (!firebase.apps.length) {
                        app = firebase.initializeApp(ADMSUP_FIREBASE_CONFIG);
                    } else {
                        app = firebase.app();
                    }
                    this.db = firebase.database(app);
                }
            } catch (err) {
                console.warn('[AdminSupport] Firebase init warning:', err);
            }
        }

        bindEvents() {
            // Ticket click delegation
            const listEl = document.getElementById('admsupTicketsList');
            listEl?.addEventListener('click', (e) => {
                const item = e.target.closest('.admsup-ticket-item');
                if (item) {
                    const ticketId = parseInt(item.getAttribute('data-ticket-id'), 10);
                    if (ticketId) this.selectTicket(ticketId);
                }
            });

            // Filter dropdowns
            const statusFilter = document.getElementById('admsupStatusFilter');
            statusFilter?.addEventListener('change', (e) => {
                this.activeStatusFilter = e.target.value;
                this.syncFilterTabsUI(this.activeStatusFilter);
                this.loadTickets();
            });

            const priorityFilter = document.getElementById('admsupPriorityFilter');
            priorityFilter?.addEventListener('change', (e) => {
                this.activePriorityFilter = e.target.value;
                this.loadTickets();
            });

            // Filter pills
            const filterTabs = document.getElementById('admsupFilterTabs');
            filterTabs?.addEventListener('click', (e) => {
                const btn = e.target.closest('.admsup-filter-tab');
                if (!btn) return;
                const status = btn.getAttribute('data-status') || 'all';
                this.activeStatusFilter = status;
                if (statusFilter) statusFilter.value = status;
                this.syncFilterTabsUI(status);
                this.loadTickets();
            });

            // Top stat cards click-to-filter
            document.querySelectorAll('.admsup-stat-card-left[data-filter-status]').forEach(card => {
                card.addEventListener('click', () => {
                    const status = card.getAttribute('data-filter-status') || 'all';
                    this.activeStatusFilter = status;
                    if (statusFilter) statusFilter.value = status;
                    this.syncFilterTabsUI(status);
                    this.loadTickets();
                });
            });

            // Search box
            const searchInput = document.getElementById('admsupTicketSearch');
            searchInput?.addEventListener('input', () => {
                clearTimeout(this.searchTimer);
                this.searchTimer = setTimeout(() => this.loadTickets(), 250);
            });

            // Refresh button
            document.getElementById('admsupRefreshBtn')?.addEventListener('click', () => {
                this.loadTickets();
                if (this.currentTicketId) {
                    this.loadTicketMessages(this.currentTicketId);
                }
            });

            // Priority and Status change on active ticket
            const urgencySelect = document.getElementById('admsupTicketUrgency');
            urgencySelect?.addEventListener('change', (e) => {
                this.updateTicketUrgency(e.target.value);
            });

            const statusSelect = document.getElementById('admsupTicketStatus');
            statusSelect?.addEventListener('change', (e) => {
                this.updateTicketStatus(e.target.value);
            });

            // Send button & Enter key
            const sendBtn = document.getElementById('admsupSendMessageBtn');
            sendBtn?.addEventListener('click', () => this.sendMessage());

            const msgInput = document.getElementById('admsupMessageInput');
            msgInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            msgInput?.addEventListener('input', () => {
                msgInput.style.height = 'auto';
                msgInput.style.height = Math.min(msgInput.scrollHeight, 130) + 'px';
            });

            // Media attachment
            document.getElementById('admsupAttachBtn')?.addEventListener('click', () => {
                if (!this.currentTicketId) return;
                document.getElementById('admsupFileInput')?.click();
            });

            document.getElementById('admsupFileInput')?.addEventListener('change', (e) => {
                this.handleFileSelection(e.target.files);
                e.target.value = '';
            });

            document.getElementById('admsupClearMediaBtn')?.addEventListener('click', () => {
                this.clearMedia();
            });

            // Scroll button
            const msgContainer = document.getElementById('admsupMessagesContainer');
            msgContainer?.addEventListener('scroll', () => this.updateScrollButton());
            document.getElementById('admsupScrollBottom')?.addEventListener('click', () => this.scrollToBottom());

            // Mobile back button
            document.getElementById('admsupBackToListBtn')?.addEventListener('click', () => {
                document.getElementById('admsupSidebar')?.classList.remove('mobile-hidden');
                document.getElementById('admsupChatArea')?.classList.add('mobile-hidden');
            });

            // Poll ticket list every 20 seconds
            setInterval(() => this.loadTickets(true), 20000);
        }

        syncFilterTabsUI(status) {
            document.querySelectorAll('.admsup-filter-tab').forEach(tab => {
                tab.classList.toggle('active', tab.getAttribute('data-status') === status);
            });
        }

        escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        formatStatusLabel(status) {
            if (!status) return 'Open';
            if (status === 'in_progress') return 'In Progress';
            return status.charAt(0).toUpperCase() + status.slice(1);
        }

        updateMetricsCounters(m) {
            if (!m) return;
            const setTxt = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val || 0;
            };
            setTxt('admsupOpenTickets', m.tickets_open);
            setTxt('admsupInProgressTickets', m.tickets_in_progress);
            setTxt('admsupPendingTickets', m.tickets_pending);
            setTxt('admsupResolvedTickets', m.tickets_resolved);
        }

        async apiPost(paramsObj) {
            const formData = new FormData();
            Object.entries(paramsObj).forEach(([k, v]) => {
                if (v !== undefined && v !== null) formData.append(k, v);
            });

            const res = await fetch('/portal-admin/api/support/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData
            });

            if (res.status === 401) {
                window.location.href = '/portal-admin/login/';
                throw new Error('Unauthorized');
            }
            return await res.json();
        }

        async loadTickets(silent = false) {
            const searchVal = document.getElementById('admsupTicketSearch')?.value.trim() || '';
            try {
                const data = await this.apiPost({
                    action: 'get_all_tickets',
                    status: this.activeStatusFilter,
                    priority: this.activePriorityFilter,
                    search: searchVal
                });

                if (data.success) {
                    this.updateMetricsCounters(data.metrics);
                    this.renderTicketsList(data.tickets || []);
                }
            } catch (err) {
                if (!silent) console.error('[AdminSupport] Error loading tickets:', err);
            }
        }

        renderTicketsList(tickets) {
            const listEl = document.getElementById('admsupTicketsList');
            if (!listEl) return;

            if (!tickets.length) {
                listEl.innerHTML = `
                    <div class="text-center py-5" style="color: var(--admsup-text-muted);">
                        <i class="bi bi-inbox fs-1 d-block mb-2 opacity-50"></i>
                        <p class="mb-0 small">No tickets match your filter</p>
                    </div>
                `;
                return;
            }

            listEl.innerHTML = tickets.map(t => {
                const isActive = Number(t.id) === Number(this.currentTicketId) ? 'active' : '';
                const statusLabel = this.formatStatusLabel(t.status);
                const urgency = t.urgency || 'medium';
                const unreadHtml = t.unread_count > 0
                    ? `<span class="admsup-unread-badge ms-1">${t.unread_count}</span>`
                    : '';

                return `
                    <div class="admsup-ticket-item ${isActive}"
                         data-ticket-id="${t.id}"
                         data-user-id="${t.user_id || ''}"
                         data-firebase-id="${this.escapeHtml(t.firebase_id || ('ticket_' + t.id))}">
                        <div class="flex-grow-1 pe-2" style="min-width: 0;">
                            <div class="d-flex justify-content-between align-items-start mb-1 gap-2">
                                <strong class="admsup-ticket-subject text-truncate" title="#${t.id} ${this.escapeHtml(t.subject)}">
                                    <span style="color: var(--admsup-text-muted); font-weight: 700;">#${t.id}</span> ${this.escapeHtml(t.subject)}
                                </strong>
                                <small class="flex-shrink-0" style="color: var(--admsup-text-muted); font-size: 0.72rem;">${this.escapeHtml(t.time_ago || '')}</small>
                            </div>
                            <div class="small mb-2 text-truncate" style="color: var(--admsup-text-muted);">
                                <i class="bi bi-person-circle me-1"></i>${this.escapeHtml(t.user_name || 'Unknown User')}
                                ${t.user_email ? `<span class="opacity-75">(${this.escapeHtml(t.user_email)})</span>` : ''}
                            </div>
                            <div class="d-flex align-items-center flex-wrap gap-2">
                                <span class="admsup-status-badge admsup-status-${this.escapeHtml(t.status || 'open')}">
                                    ${this.escapeHtml(statusLabel)}
                                </span>
                                <span class="admsup-urgency-dot urgency-${this.escapeHtml(urgency)}">${this.escapeHtml(this.formatStatusLabel(urgency))}</span>
                                <span class="small" style="color: var(--admsup-text-muted); font-size: 0.72rem;">${this.escapeHtml(this.formatStatusLabel(t.type || 'query'))}</span>
                            </div>
                        </div>
                        ${unreadHtml}
                    </div>
                `;
            }).join('');
        }

        async selectTicket(ticketId) {
            this.currentTicketId = ticketId;

            // Highlight in sidebar & clear unread badge
            document.querySelectorAll('.admsup-ticket-item').forEach(el => {
                const isSelected = Number(el.getAttribute('data-ticket-id')) === Number(ticketId);
                el.classList.toggle('active', isSelected);
                if (isSelected) {
                    const badge = el.querySelector('.admsup-unread-badge');
                    if (badge) badge.remove();
                }
            });

            // Mobile view switch
            if (window.innerWidth < 768) {
                document.getElementById('admsupSidebar')?.classList.add('mobile-hidden');
                document.getElementById('admsupChatArea')?.classList.remove('mobile-hidden');
            } else {
                document.getElementById('admsupChatArea')?.classList.remove('mobile-hidden');
            }

            document.getElementById('admsupWelcomeScreen').style.display = 'none';
            const chatInterface = document.getElementById('admsupChatInterface');
            chatInterface.style.display = 'flex';

            document.getElementById('admsupMessageInput').disabled = false;
            document.getElementById('admsupSendMessageBtn').disabled = false;

            try {
                const detailsRes = await this.apiPost({
                    action: 'get_ticket_details',
                    ticket_id: ticketId
                });

                if (detailsRes.success && detailsRes.ticket) {
                    const t = detailsRes.ticket;
                    this.currentTicketData = t;
                    this.currentUserData = {
                        id: t.user_id,
                        name: t.user_name,
                        email: t.user_email,
                        username: t.user_username
                    };
                    this.currentFirebaseTicketId = t.firebase_id || ('ticket_' + t.id);

                    document.getElementById('admsupTicketSubject').textContent = `#${t.id} — ${t.subject}`;
                    document.getElementById('admsupTicketMeta').innerHTML = `
                        <span class="admsup-status-badge admsup-status-${this.escapeHtml(t.status)} me-2">${this.escapeHtml(this.formatStatusLabel(t.status))}</span>
                        <span class="admsup-urgency-dot urgency-${this.escapeHtml(t.urgency)} me-2">${this.escapeHtml(this.formatStatusLabel(t.urgency))} Priority</span>
                        <span>Created: ${this.escapeHtml(t.created_at)}</span>
                    `;
                    document.getElementById('admsupUserInfo').innerHTML = `
                        <span><i class="bi bi-person me-1 text-primary"></i><strong>${this.escapeHtml(t.user_name)}</strong> ${t.user_username ? '(@' + this.escapeHtml(t.user_username) + ')' : ''}</span>
                        ${t.user_email ? `<span><i class="bi bi-envelope me-1 text-primary"></i>${this.escapeHtml(t.user_email)}</span>` : ''}
                        <span><i class="bi bi-tag me-1 text-primary"></i>Type: ${this.escapeHtml(this.formatStatusLabel(t.type))}</span>
                    `;

                    const statusSelect = document.getElementById('admsupTicketStatus');
                    if (statusSelect) statusSelect.value = t.status || 'open';

                    const urgencySelect = document.getElementById('admsupTicketUrgency');
                    if (urgencySelect) urgencySelect.value = (t.urgency || 'medium').toLowerCase();
                }

                await this.loadTicketMessages(ticketId);
                this.setupFirebaseListener();
            } catch (err) {
                console.error('[AdminSupport] Error selecting ticket:', err);
            }
        }

        async loadTicketMessages(ticketId) {
            const container = document.getElementById('admsupMessagesContainer');
            if (!container) return;

            container.innerHTML = `
                <div class="text-center py-5" style="color: var(--admsup-text-muted);">
                    <div class="spinner-border spinner-border-sm text-primary me-2"></div>
                    Loading conversation...
                </div>
            `;

            try {
                const res = await this.apiPost({
                    action: 'get_ticket_messages',
                    ticket_id: ticketId
                });

                if (res.success) {
                    this.renderMessages(res.messages || []);
                }
            } catch (err) {
                console.error('[AdminSupport] Error loading messages:', err);
            }
        }

        renderMessages(messages) {
            const container = document.getElementById('admsupMessagesContainer');
            if (!container) return;

            if (!messages.length) {
                container.innerHTML = `
                    <div class="text-center py-5" style="color: var(--admsup-text-muted);">
                        <i class="bi bi-chat-dots fs-2 d-block mb-2 opacity-50"></i>
                        No messages in this ticket yet.
                    </div>
                `;
                return;
            }

            container.innerHTML = messages.map(m => this.buildMessageHtml(m)).join('');
            this.scrollToBottom();
        }

        buildMessageHtml(m) {
            const isAdmin = m.sender_type === 'admin';
            const wrapperClass = isAdmin ? 'admsup-admin-message-wrapper' : 'admsup-user-message-wrapper';
            const bubbleClass = isAdmin ? 'admsup-admin-message' : 'admsup-user-message';
            const senderLabel = isAdmin ? (m.sender_name || 'Support Team') : (m.sender_name || 'User');
            const timeStr = (m.created_at || '').split(' ')[1]?.slice(0, 5) || m.created_at || 'Just now';

            let mediaHtml = '';
            const mediaUrl = m.media_url || m.s3_url || '';
            if (mediaUrl) {
                if (m.message_type === 'image') {
                    mediaHtml = `
                        <div class="mb-2">
                            <img src="${this.escapeHtml(mediaUrl)}" alt="Attachment"
                                 onclick="window.open('${this.escapeHtml(mediaUrl)}', '_blank')"
                                 style="max-width: 100%; max-height: 240px; border-radius: 10px; cursor: pointer;">
                        </div>
                    `;
                } else if (m.message_type === 'video') {
                    mediaHtml = `
                        <div class="mb-2">
                            <video controls style="max-width: 100%; max-height: 240px; border-radius: 10px;">
                                <source src="${this.escapeHtml(mediaUrl)}">
                            </video>
                        </div>
                    `;
                } else {
                    mediaHtml = `
                        <div class="admsup-message-file mb-2">
                            <i class="bi bi-file-earmark-arrow-down fs-4"></i>
                            <div class="flex-grow-1 text-truncate">
                                <div class="small fw-semibold text-truncate">${this.escapeHtml(m.file_name || 'Attachment')}</div>
                            </div>
                            <a href="${this.escapeHtml(mediaUrl)}" target="_blank" download class="btn btn-sm btn-light">
                                <i class="bi bi-download"></i>
                            </a>
                        </div>
                    `;
                }
            }

            const textHtml = m.message
                ? `<div>${this.escapeHtml(m.message).replace(/\n/g, '<br>')}</div>`
                : '';

            return `
                <div class="admsup-message-wrapper ${wrapperClass}" data-msg-id="${m.id || ''}">
                    <div class="admsup-message-sender">${this.escapeHtml(senderLabel)}</div>
                    <div class="admsup-message-bubble ${bubbleClass}">
                        <div class="admsup-message-content">
                            ${mediaHtml}
                            ${textHtml}
                            <div class="admsup-message-time">${this.escapeHtml(timeStr)}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        setupFirebaseListener() {
            if (!this.db || !this.currentUserData?.id || !this.currentTicketData) return;

            const userId = this.currentUserData.id;
            const mysqlId = this.currentTicketData.id;
            const userTicketsRef = this.db.ref(`users/${userId}/tickets`);

            userTicketsRef.once('value').then(snapshot => {
                let fbTicketKey = `ticket_${mysqlId}`;
                if (snapshot.exists()) {
                    snapshot.forEach(child => {
                        const val = child.val();
                        if (val && (val.mysql_id == mysqlId || val.id == mysqlId)) {
                            fbTicketKey = child.key;
                        }
                    });
                }
                this.currentFirebaseTicketId = fbTicketKey;

                const messagesRef = this.db.ref(`users/${userId}/tickets/${fbTicketKey}/messages`);
                if (this.firebaseListeners[mysqlId]) {
                    this.firebaseListeners[mysqlId]();
                    delete this.firebaseListeners[mysqlId];
                }

                const onChildAdded = messagesRef.orderByChild('timestamp').limitToLast(1).on('child_added', (msgSnap) => {
                    const newMsg = msgSnap.val();
                    if (newMsg && newMsg.sender_type === 'user') {
                        const msgText = newMsg.content || newMsg.message || '';
                        const existing = Array.from(document.querySelectorAll('#admsupMessagesContainer .admsup-message-content'))
                            .some(el => msgText && el.textContent.includes(msgText));
                        if (!existing) {
                            this.loadTicketMessages(mysqlId);
                        }
                    }
                });

                this.firebaseListeners[mysqlId] = () => messagesRef.off('child_added', onChildAdded);
            }).catch(err => console.warn('[AdminSupport] Firebase listener warn:', err));
        }

        async sendMessage() {
            const input = document.getElementById('admsupMessageInput');
            const sendBtn = document.getElementById('admsupSendMessageBtn');
            const message = input?.value.trim() || '';

            if (!this.currentTicketId) return;

            if (this.pendingMedia.length > 0) {
                await this.sendMediaWithMessage(message);
                return;
            }

            if (!message) return;

            const origBtnHtml = sendBtn.innerHTML;
            sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            sendBtn.disabled = true;

            try {
                const res = await this.apiPost({
                    action: 'send_admin_message',
                    ticket_id: this.currentTicketId,
                    message: message
                });

                if (res.success) {
                    input.value = '';
                    input.style.height = 'auto';

                    // Push to Firebase for real-time user view
                    if (this.db && this.currentUserData?.id && this.currentFirebaseTicketId) {
                        const fbPath = `users/${this.currentUserData.id}/tickets/${this.currentFirebaseTicketId}`;
                        await this.db.ref(`${fbPath}/messages`).push().set({
                            content: message,
                            message: message,
                            sender_id: 'admin_' + this.admin.id,
                            sender_name: this.admin.name,
                            sender_type: 'admin',
                            timestamp: Date.now(),
                            read: false,
                            message_type: 'text'
                        });
                        await this.db.ref(fbPath).update({
                            last_updated: Date.now(),
                            last_message: message.substring(0, 100),
                            status: res.new_status || 'in_progress'
                        });
                    }

                    // Append to UI immediately
                    const container = document.getElementById('admsupMessagesContainer');
                    const nowTime = new Date().toTimeString().slice(0, 5);
                    container.insertAdjacentHTML('beforeend', this.buildMessageHtml({
                        id: res.message_id,
                        sender_type: 'admin',
                        sender_name: this.admin.name,
                        message: message,
                        message_type: 'text',
                        created_at: 'Today ' + nowTime
                    }));
                    this.scrollToBottom();

                    if (res.new_status) {
                        const statusSelect = document.getElementById('admsupTicketStatus');
                        if (statusSelect) statusSelect.value = res.new_status;
                    }
                    this.updateMetricsCounters(res.metrics);
                    this.loadTickets(true);
                }
            } catch (err) {
                console.error('[AdminSupport] Send error:', err);
            } finally {
                sendBtn.innerHTML = origBtnHtml;
                sendBtn.disabled = false;
                input?.focus();
            }
        }

        handleFileSelection(fileList) {
            if (!fileList || !fileList.length) return;
            Array.from(fileList).forEach(file => {
                const isImg = file.type.startsWith('image/');
                const isVid = file.type.startsWith('video/');
                this.pendingMedia.push({
                    file,
                    type: isImg ? 'image' : (isVid ? 'video' : 'file'),
                    previewUrl: isImg ? URL.createObjectURL(file) : null
                });
            });
            this.renderMediaPreview();
        }

        renderMediaPreview() {
            const previewBar = document.getElementById('admsupMediaPreview');
            const grid = document.getElementById('admsupMediaGrid');
            const countEl = document.getElementById('admsupMediaCount');

            if (!this.pendingMedia.length) {
                previewBar?.classList.remove('show');
                if (grid) grid.innerHTML = '';
                return;
            }

            previewBar?.classList.add('show');
            if (countEl) countEl.textContent = `${this.pendingMedia.length} file(s) ready`;

            grid.innerHTML = this.pendingMedia.map((item, idx) => `
                <div class="admsup-media-thumb" title="${this.escapeHtml(item.file.name)}">
                    ${item.previewUrl
                        ? `<img src="${item.previewUrl}" alt="Preview">`
                        : `<i class="bi bi-file-earmark-text fs-4 text-primary"></i>`
                    }
                    <button type="button" class="admsup-media-remove" data-idx="${idx}">&times;</button>
                </div>
            `).join('');

            grid.querySelectorAll('.admsup-media-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-idx'), 10);
                    this.pendingMedia.splice(idx, 1);
                    this.renderMediaPreview();
                });
            });
        }

        clearMedia() {
            this.pendingMedia = [];
            this.renderMediaPreview();
        }

        async sendMediaWithMessage(caption = '') {
            if (!this.currentTicketId || !this.pendingMedia.length) return;
            const sendBtn = document.getElementById('admsupSendMessageBtn');
            const origBtnHtml = sendBtn.innerHTML;
            sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            sendBtn.disabled = true;

            try {
                for (const item of this.pendingMedia) {
                    const formData = new FormData();
                    formData.append('action', 'upload_admin_media');
                    formData.append('ticket_id', this.currentTicketId);
                    formData.append('message', caption);
                    formData.append('file', item.file);

                    const res = await fetch('/portal-admin/api/support/', {
                        method: 'POST',
                        headers: {
                            'X-CSRFToken': getCsrfToken(),
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: formData
                    });
                    const result = await res.json();

                    if (result.success) {
                        if (this.db && this.currentUserData?.id && this.currentFirebaseTicketId) {
                            const fbPath = `users/${this.currentUserData.id}/tickets/${this.currentFirebaseTicketId}`;
                            await this.db.ref(`${fbPath}/messages`).push().set({
                                content: caption || '',
                                message: caption || '',
                                sender_id: 'admin_' + this.admin.id,
                                sender_name: this.admin.name,
                                sender_type: 'admin',
                                timestamp: Date.now(),
                                read: false,
                                message_type: result.type,
                                media_url: result.public_url,
                                file_name: result.original_name,
                                file_size: result.size
                            });
                        }
                    }
                }

                this.clearMedia();
                const input = document.getElementById('admsupMessageInput');
                if (input) {
                    input.value = '';
                    input.style.height = 'auto';
                }
                await this.loadTicketMessages(this.currentTicketId);
                this.loadTickets(true);
            } catch (err) {
                console.error('[AdminSupport] Media upload error:', err);
            } finally {
                sendBtn.innerHTML = origBtnHtml;
                sendBtn.disabled = false;
            }
        }

        async updateTicketStatus(newStatus) {
            if (!this.currentTicketId) return;
            try {
                const res = await this.apiPost({
                    action: 'update_ticket_status',
                    ticket_id: this.currentTicketId,
                    status: newStatus
                });

                if (res.success) {
                    if (this.db && this.currentUserData?.id && this.currentFirebaseTicketId) {
                        await this.db.ref(`users/${this.currentUserData.id}/tickets/${this.currentFirebaseTicketId}`).update({
                            status: newStatus,
                            last_updated: Date.now()
                        });
                    }
                    this.updateMetricsCounters(res.metrics);
                    this.loadTickets(true);
                }
            } catch (err) {
                console.error('[AdminSupport] Status update error:', err);
            }
        }

        async updateTicketUrgency(newUrgency) {
            if (!this.currentTicketId) return;
            const selectEl = document.getElementById('admsupTicketUrgency');
            const prevUrgency = this.currentTicketData?.urgency || 'medium';
            try {
                const res = await this.apiPost({
                    action: 'update_ticket_urgency',
                    ticket_id: this.currentTicketId,
                    urgency: newUrgency,
                    priority: newUrgency
                });

                if (res && res.success) {
                    const finalUrgency = res.new_urgency || newUrgency;
                    if (this.currentTicketData) {
                        this.currentTicketData.urgency = finalUrgency;
                    }
                    if (selectEl) {
                        selectEl.value = finalUrgency;
                    }
                    try {
                        if (this.db && this.currentUserData?.id && this.currentFirebaseTicketId) {
                            await this.db.ref(`users/${this.currentUserData.id}/tickets/${this.currentFirebaseTicketId}`).update({
                                urgency: finalUrgency,
                                last_updated: Date.now()
                            });
                        }
                    } catch (fbErr) {
                        console.warn('[AdminSupport] Firebase urgency update warning:', fbErr);
                    }
                    const metaEl = document.getElementById('admsupTicketMeta');
                    if (metaEl && this.currentTicketData) {
                        metaEl.innerHTML = `
                            <span class="admsup-status-badge admsup-status-${this.escapeHtml(this.currentTicketData.status)} me-2">${this.escapeHtml(this.formatStatusLabel(this.currentTicketData.status))}</span>
                            <span class="admsup-urgency-dot urgency-${this.escapeHtml(finalUrgency)} me-2">${this.escapeHtml(this.formatStatusLabel(finalUrgency))} Priority</span>
                            <span>Created: ${this.escapeHtml(this.currentTicketData.created_at)}</span>
                        `;
                    }
                    // Update urgency dot on active item in sidebar immediately
                    const activeItem = document.querySelector(`.admsup-ticket-item[data-ticket-id="${this.currentTicketId}"]`);
                    if (activeItem) {
                        const dot = activeItem.querySelector('.admsup-urgency-dot');
                        if (dot) {
                            dot.className = `admsup-urgency-dot urgency-${this.escapeHtml(finalUrgency)}`;
                            dot.textContent = this.formatStatusLabel(finalUrgency);
                        }
                    }
                    if (res.metrics) {
                        this.updateMetricsCounters(res.metrics);
                    }
                    this.loadTickets(true);
                } else {
                    console.error('[AdminSupport] Priority update rejected:', res ? res.error : 'Unknown error');
                    if (selectEl) selectEl.value = prevUrgency;
                }
            } catch (err) {
                console.error('[AdminSupport] Priority update error:', err);
                if (selectEl) selectEl.value = prevUrgency;
            }
        }

        scrollToBottom() {
            const c = document.getElementById('admsupMessagesContainer');
            if (c) c.scrollTop = c.scrollHeight;
        }

        updateScrollButton() {
            const c = document.getElementById('admsupMessagesContainer');
            const btn = document.getElementById('admsupScrollBottom');
            if (!c || !btn) return;
            const isNearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
            btn.classList.toggle('show', !isNearBottom);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.admsupSystem = new AdminSupportSystem();
    });
})();
