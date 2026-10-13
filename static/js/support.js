/* ============================================================
   SUPPORT — Firebase + MySQL hybrid
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.SUPPORT_CONFIG || {};
  const CURRENT_USER = {
    id: CFG.userId,
    name: CFG.userName || 'User',
    picture: CFG.userPicture || '/static/images/avatars/default.png',
  };

  function getCsrfToken() {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  function escapeHtml(t) {
    if (t == null) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const units = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
  }

  function formatDateLabel(date) {
    const now = new Date();
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    if (date.toDateString() === now.toDateString()) return 'Today';
    if (date.toDateString() === yest.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function getTimeAgo(ts) {
    if (!ts) return 'Just now';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
function toast(msg, type) {
  type = type || 'info';
  document.querySelectorAll('.custom-alert').forEach(a => a.remove());
  const div = document.createElement('div');
  div.className = 'custom-alert ' + type;
  const icon = type === 'success' ? 'bi-check-circle-fill'
            : type === 'error'   ? 'bi-x-circle-fill'
            : type === 'warning' ? 'bi-exclamation-triangle-fill'
            :                      'bi-info-circle-fill';
  div.innerHTML = '<div class="d-flex align-items-center justify-content-between">'
    + '<div class="d-flex align-items-center"><i class="bi ' + icon + ' alert-icon"></i><div>' + msg + '</div></div>'
    + '<button type="button" class="btn-close" onclick="this.parentElement.parentElement.remove()"></button>'
    + '</div>';
  document.body.appendChild(div);
  setTimeout(() => { if (div.parentElement) div.remove(); }, 4000);
}
  // ============================================================
  // APP
  // ============================================================
  const SupportApp = {
    db: null,
    currentTicketId: null,     // firebase id (ticket_XXX)
    currentTicketData: null,
    currentMySQLId: null,
    tickets: [],
    messages: [],
    messagesPath: null,
    messagesCallback: null,
    pendingMedia: [],
    isMobile: window.innerWidth < 992,
    searchTimer: null,

    init: function () {
      this.initFirebase();
      this.initUI();
      this.loadTickets();

      window.addEventListener('resize', () => {
        this.isMobile = window.innerWidth < 992;
      });
    },

    initFirebase: function () {
      try {
        if (typeof firebase === 'undefined') {
          console.warn('[support] Firebase SDK not loaded');
          return;
        }
        let app;
        try { app = firebase.app('shoutbox'); }
        catch (e) { console.warn('[support] named app not found'); return; }
        this.db = app.database();
        console.log('[support] Firebase connected');
      } catch (e) {
        console.warn('[support] Firebase init failed', e);
      }
    },

    initUI: function () {
      const input = document.getElementById('messageInput');
      if (input) {
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
          }
        });
        input.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
      }

      ['imageInput', 'videoInput', 'fileInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', e => this.handleMediaSelect(e));
      });

      const search = document.getElementById('searchTicketsInput');
      if (search) {
        search.addEventListener('input', e => {
          clearTimeout(this.searchTimer);
          this.searchTimer = setTimeout(() => this.filterTickets(e.target.value), 300);
        });
      }

      const msgContainer = document.getElementById('messagesContainer');
      if (msgContainer) {
        msgContainer.addEventListener('scroll', () => this.updateScrollButton());
      }
    },

    // ---- Tickets ----
    loadTickets: async function () {
      try {
        const r = await fetch('/api/support/tickets/');
        const d = await r.json();
        if (d.success) {
          this.tickets = d.tickets || [];
          this.renderTickets(this.tickets);
          // Merge into Firebase so admin panel (still on PHP) sees them
          if (this.db) {
            for (const t of this.tickets) {
              const path = `users/${CURRENT_USER.id}/tickets/${t.firebase_id}`;
              try {
                await this.db.ref(path).update({
                  id: t.firebase_id,
                  mysql_id: t.mysql_id,
                  subject: t.subject,
                  type: t.type,
                  status: t.status,
                  last_message: t.last_message,
                  last_updated: t.last_updated,
                  user_id: CURRENT_USER.id,
                  user_name: CURRENT_USER.name,
                  unread_count: t.unread_count,
                });
              } catch (e) { /* silent */ }
            }
          }
        }
      } catch (e) {
        console.error('loadTickets failed', e);
      }
    },

    renderTickets: function (list) {
      const container = document.getElementById('ticketsList');
      if (!container) return;

      if (!list.length) {
        container.innerHTML =
          '<div class="empty-chats">'
          + '<i class="bi bi-ticket"></i>'
          + '<h5 class="empty-chats-title">No tickets yet</h5>'
          + '<p class="empty-chats-text">Create your first support ticket</p>'
          + '<button class="btn btn-primary btn-sm" onclick="supportApp.openNewTicketModal()">'
          + '<i class="bi bi-plus-circle me-1"></i> New Ticket</button>'
          + '</div>';
        return;
      }

      let html = '';
      for (const t of list) {
        const active = t.firebase_id === this.currentTicketId ? 'active' : '';
        const unread = t.unread_count > 0
          ? '<div class="unread-badge">' + (t.unread_count > 9 ? '9+' : t.unread_count) + '</div>'
          : '';
        html +=
          '<div class="chat-item ' + active + '" data-ticket-id="' + t.firebase_id + '" onclick="supportApp.selectTicket(\'' + t.firebase_id + '\')">'
          + '<div class="chat-avatar"><i class="bi bi-ticket"></i></div>'
          + '<div class="chat-info">'
          + '<h6 class="chat-subject">' + escapeHtml(t.subject) + '</h6>'
          + '<div class="chat-last-message">' + escapeHtml(t.last_message) + '</div>'
          + '</div>'
          + '<div class="chat-meta">'
          + '<div class="message-time">' + (t.time_ago || '') + '</div>'
          + unread
          + '<div class="status-indicator ' + (t.status || 'open') + '">' + (t.status || 'open') + '</div>'
          + '</div>'
          + '</div>';
      }
      container.innerHTML = html;
    },

    filterTickets: function (q) {
      q = (q || '').toLowerCase().trim();
      if (!q) { this.renderTickets(this.tickets); return; }
      const filtered = this.tickets.filter(t =>
        (t.subject || '').toLowerCase().includes(q) ||
        (t.last_message || '').toLowerCase().includes(q) ||
        (t.type || '').toLowerCase().includes(q)
      );
      this.renderTickets(filtered);
    },

    // ---- Select ticket ----
    selectTicket: async function (ticketId) {
      if (!ticketId) return;
      if (this.currentTicketId === ticketId) { this.showChatInterface(); return; }

      this.currentTicketId = ticketId;
      const found = this.tickets.find(t => t.firebase_id === ticketId);
      this.currentTicketData = found || null;
      this.currentMySQLId = found ? found.mysql_id : null;

      const subj = document.getElementById('ticketSubject');
      if (subj && found) subj.textContent = found.subject || 'No Subject';
      const stat = document.getElementById('ticketStatus');
      if (stat && found) stat.textContent = (found.type || 'query') + ' • ' + (found.status || 'open');

      this.showChatInterface();
      this.updateMessageInputState();
      this.loadMessages();
      this.markRead();
    },

    showChatInterface: function () {
      if (this.isMobile) {
        const list = document.getElementById('ticketsListContainer');
        const chat = document.getElementById('chatContainer');
        if (list) list.classList.add('hidden');
        if (chat) chat.classList.add('active');
      }
      const empty = document.getElementById('emptyChatState');
      if (empty) empty.style.display = 'none';
    },

    showTicketsList: function () {
      if (!this.isMobile) return;
      const list = document.getElementById('ticketsListContainer');
      const chat = document.getElementById('chatContainer');
      if (list) list.classList.remove('hidden');
      if (chat) chat.classList.remove('active');
      this.currentTicketId = null;
      this.currentTicketData = null;
      this.currentMySQLId = null;
      this.stopMessagesListener();
      const empty = document.getElementById('emptyChatState');
      if (empty) empty.style.display = 'flex';
    },

    updateMessageInputState: function () {
      const input = document.getElementById('messageInput');
      const send = document.getElementById('sendMessageBtn');
      const attach = document.getElementById('attachBtn');
      if (!this.currentTicketData) {
        if (input) { input.disabled = true; input.placeholder = 'Select a ticket to start chatting'; }
        if (send) send.disabled = true;
        if (attach) attach.disabled = true;
        return;
      }
      const closed = ['closed', 'resolved'].includes(this.currentTicketData.status);
      if (input) {
        input.disabled = closed;
        input.placeholder = closed
          ? 'This ticket is ' + this.currentTicketData.status + '.'
          : 'Type your message...';
      }
      if (send) send.disabled = closed;
      if (attach) attach.disabled = closed;
    },

    // ---- Messages ----
    loadMessages: async function () {
      const container = document.getElementById('messagesContainer');
      if (!container) return;
      container.innerHTML = '<div class="loading-messages"><div class="spinner-border text-primary"></div><p class="mt-2">Loading messages...</p></div>';

      const mysqlId = this.currentMySQLId;
      if (!mysqlId) return;

      try {
        const r = await fetch('/api/support/messages/?ticket_id=' + mysqlId);
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Failed');
        this.messages = d.messages || [];
        this.renderMessages();
        this.startFirebaseListener();
      } catch (e) {
        console.warn('loadMessages failed', e);
        container.innerHTML = '<div class="empty-messages"><i class="bi bi-exclamation-triangle"></i><p class="mt-2">Failed to load messages</p></div>';
      }
    },

    startFirebaseListener: function () {
      this.stopMessagesListener();
      if (!this.db || !this.currentTicketId) return;
      const path = `users/${CURRENT_USER.id}/tickets/${this.currentTicketId}/messages`;
      this.messagesPath = path;
      const ref = this.db.ref(path);
      this.messagesCallback = ref.on('value', snap => {
        const list = [];
        if (snap && snap.exists()) {
          snap.forEach(child => {
            const m = child.val();
            if (m) { m.key = child.key; list.push(m); }
          });
        }
        list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        // Merge — prefer any messages we already have from MySQL
        const seen = new Set(this.messages.map(x => x.firebase_id || x.id));
        for (const m of list) {
          const key = m.firebase_id || m.id;
          if (!seen.has(key)) { this.messages.push(m); seen.add(key); }
        }
        this.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        this.renderMessages();
        setTimeout(() => {
          const c = document.getElementById('messagesContainer');
          if (c) c.scrollTop = c.scrollHeight;
        }, 100);
      });
    },

    stopMessagesListener: function () {
      if (this.db && this.messagesPath && this.messagesCallback) {
        try {
          this.db.ref(this.messagesPath).off('value', this.messagesCallback);
        } catch (e) {}
      }
      this.messagesPath = null;
      this.messagesCallback = null;
    },

    renderMessages: function () {
      const container = document.getElementById('messagesContainer');
      if (!container) return;

      if (!this.messages.length) {
        container.innerHTML = '<div class="empty-messages"><i class="bi bi-chat-quote"></i><p class="mt-2">No messages yet. Start the conversation!</p></div>';
        return;
      }

      let html = '';
      let lastDate = null;
      for (const m of this.messages) {
        const ts = m.timestamp || (m.created_at ? new Date(m.created_at).getTime() : Date.now());
        const d = new Date(ts);
        const dstr = d.toDateString();
        if (dstr !== lastDate) {
          lastDate = dstr;
          html += '<div class="date-separator"><span>' + formatDateLabel(d) + '</span></div>';
        }
        const isUser = (m.sender_type || 'user') === 'user';
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const content = m.message || m.content || '';

        let body = '';
        if (!m.message_type || m.message_type === 'text') {
          body = '<div class="message-text">' + escapeHtml(content).replace(/\n/g, '<br>') + '</div>';
        } else if (m.message_type === 'image') {
          const url = m.s3_url || m.media_url || '';
          body = '<div class="message-media" onclick="supportApp.viewMedia(\'' + url + '\', \'image\')">'
               + '<img src="' + url + '" class="media-image" alt=""></div>'
               + (content ? '<div class="message-text small mt-1">' + escapeHtml(content) + '</div>' : '');
        } else if (m.message_type === 'video') {
          const url = m.s3_url || m.media_url || '';
          body = '<div class="message-media"><video controls class="media-video">'
               + '<source src="' + url + '" type="video/mp4"></video></div>'
               + (content ? '<div class="message-text small mt-1">' + escapeHtml(content) + '</div>' : '');
        } else if (m.message_type === 'file') {
          const url = m.s3_url || m.media_url || '';
          body = '<div class="message-file">'
               + '<i class="bi bi-file-earmark-text file-icon"></i>'
               + '<div class="file-info"><div class="file-name">' + escapeHtml(m.file_name || 'File') + '</div>'
               + '<div class="file-size">' + formatFileSize(m.file_size) + '</div></div>'
               + '<a href="' + url + '" download class="file-download"><i class="bi bi-download"></i></a>'
               + '</div>';
        }

        html += '<div class="message-wrapper ' + (isUser ? 'user' : 'admin') + '">'
              + '<div class="message-bubble">'
              + '<div class="message-sender">' + escapeHtml(isUser ? 'You' : (m.sender_name || 'Support')) + '</div>'
              + body
              + '<div class="message-meta"><span>' + time + '</span></div>'
              + '</div></div>';
      }
      container.innerHTML = html;
    },

    // ---- Send ----
    sendMessage: async function () {
      const input = document.getElementById('messageInput');
      if (!input) return;
      const text = input.value.trim();

      if (this.pendingMedia.length > 0) {
        return this.sendMediaWithMessage(text);
      }
      if (!text) { toast('Please enter a message', 'info'); return; }
      if (!this.currentTicketId) { toast('Select a ticket first', 'info'); return; }

      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const ts = Date.now();
      const payload = {
        id: msgId,
        firebase_id: msgId,
        sender_id: CURRENT_USER.id,
        sender_name: CURRENT_USER.name,
        sender_type: 'user',
        content: text,
        message: text,
        timestamp: ts,
        message_type: 'text',
      };

      // Firebase
      if (this.db) {
        try {
          await this.db.ref(`users/${CURRENT_USER.id}/tickets/${this.currentTicketId}/messages/${msgId}`).set(payload);
          await this.db.ref(`users/${CURRENT_USER.id}/tickets/${this.currentTicketId}`).update({
            last_message: text.slice(0, 100),
            last_updated: ts,
          });
        } catch (e) { console.warn('firebase write failed', e); }
      }

      // MySQL
      try {
        const fd = new URLSearchParams();
        fd.append('ticket_id', this.currentMySQLId);
        fd.append('message', text);
        fd.append('message_type', 'text');
        fd.append('firebase_id', msgId);
        await fetch('/api/support/save-message/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': getCsrfToken() },
          body: fd.toString(),
        });
      } catch (e) { console.warn('mysql save failed', e); }

      input.value = '';
      input.style.height = 'auto';

      // Optimistic render
      this.messages.push(payload);
      this.renderMessages();
      setTimeout(() => {
        const c = document.getElementById('messagesContainer');
        if (c) c.scrollTop = c.scrollHeight;
      }, 50);
    },

    sendMediaWithMessage: async function (caption) {
      if (!this.currentTicketId || this.pendingMedia.length === 0) return;
      const queue = [...this.pendingMedia];
      this.clearMedia();
      const input = document.getElementById('messageInput');
      if (input) { input.value = ''; input.style.height = 'auto'; }

      for (const media of queue) {
        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const ts = Date.now();

        // 1) Upload to S3
        let uploaded = null;
        try {
          const fd = new FormData();
          fd.append('file', media.file);
          const r = await fetch('/api/support/upload-media/', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCsrfToken() },
            body: fd,
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || 'Upload failed');
          uploaded = d;
        } catch (e) {
          toast('Upload failed: ' + media.file.name, 'error');
          continue;
        }

        const payload = {
          id: msgId,
          firebase_id: msgId,
          sender_id: CURRENT_USER.id,
          sender_name: CURRENT_USER.name,
          sender_type: 'user',
          content: caption || '',
          message: caption || '',
          timestamp: ts,
          message_type: uploaded.type,
          file_name: uploaded.original_name,
          file_size: uploaded.size,
          media_url: uploaded.s3_key,
          s3_key: uploaded.s3_key,
          s3_url: uploaded.public_url,
        };

        if (this.db) {
          try {
            await this.db.ref(`users/${CURRENT_USER.id}/tickets/${this.currentTicketId}/messages/${msgId}`).set(payload);
            await this.db.ref(`users/${CURRENT_USER.id}/tickets/${this.currentTicketId}`).update({
              last_message: caption || '📎 Sent an attachment',
              last_updated: ts,
            });
          } catch (e) {}
        }

        try {
          const fd = new URLSearchParams();
          fd.append('ticket_id', this.currentMySQLId);
          fd.append('message', caption || '');
          fd.append('message_type', uploaded.type);
          fd.append('media_url', uploaded.s3_key);
          fd.append('s3_key', uploaded.s3_key);
          fd.append('s3_url', uploaded.public_url);
          fd.append('file_name', uploaded.original_name);
          fd.append('file_size', uploaded.size);
          fd.append('firebase_id', msgId);
          await fetch('/api/support/save-message/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': getCsrfToken() },
            body: fd.toString(),
          });
        } catch (e) {}

        this.messages.push(payload);
      }
      this.renderMessages();
      setTimeout(() => {
        const c = document.getElementById('messagesContainer');
        if (c) c.scrollTop = c.scrollHeight;
      }, 50);
    },

    // ---- Media picker ----
    openGallery: function () {
      if (!this.currentTicketId) { toast('Select a ticket first', 'info'); return; }
      document.getElementById('imageInput').click();
    },

    handleMediaSelect: function (e) {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) { toast(file.name + ' too large', 'info'); continue; }
        const isImg = file.type.startsWith('image/');
        const isVid = file.type.startsWith('video/');
        const type = isImg ? 'image' : isVid ? 'video' : 'file';
        const reader = new FileReader();
        reader.onload = ev => {
          this.pendingMedia.push({ file, type, preview: ev.target.result });
          this.updateMediaPreview();
        };
        reader.readAsDataURL(file);
      }
      e.target.value = '';
    },

    updateMediaPreview: function () {
      const container = document.getElementById('mediaPreviewContainer');
      const grid = document.getElementById('mediaPreviewGrid');
      const count = document.getElementById('mediaCount');
      if (!container || !grid || !count) return;

      if (!this.pendingMedia.length) { container.classList.remove('show'); return; }
      container.classList.add('show');
      count.textContent = this.pendingMedia.length + ' file' + (this.pendingMedia.length > 1 ? 's' : '') + ' selected';

      let html = '';
      this.pendingMedia.forEach((m, i) => {
        if (m.type === 'image') {
          html += '<div class="media-preview-item"><img src="' + m.preview + '">'
               + '<button class="remove-media-btn" onclick="supportApp.removeMedia(' + i + ')"><i class="bi bi-x"></i></button></div>';
        } else if (m.type === 'video') {
          html += '<div class="media-preview-item"><video><source src="' + m.preview + '"></video>'
               + '<button class="remove-media-btn" onclick="supportApp.removeMedia(' + i + ')"><i class="bi bi-x"></i></button></div>';
        } else {
          html += '<div class="media-preview-item file-preview"><i class="bi bi-file-earmark-text"></i>'
               + '<button class="remove-media-btn" onclick="supportApp.removeMedia(' + i + ')"><i class="bi bi-x"></i></button></div>';
        }
      });
      grid.innerHTML = html;
    },

    removeMedia: function (i) { this.pendingMedia.splice(i, 1); this.updateMediaPreview(); },
    clearMedia: function () {
      this.pendingMedia = [];
      this.updateMediaPreview();
      ['imageInput', 'videoInput', 'fileInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    },

    // ---- UI helpers ----
    updateScrollButton: function () {
      const c = document.getElementById('messagesContainer');
      const b = document.getElementById('scrollBottomBtn');
      if (!c || !b) return;
      const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 100;
      b.classList.toggle('show', !atBottom);
    },

    scrollToBottom: function () {
      const c = document.getElementById('messagesContainer');
      if (c) c.scrollTop = c.scrollHeight;
    },

    viewMedia: function (url, type) {
      const content = document.getElementById('mediaViewerContent');
      if (!content) return;
      if (type === 'image') content.innerHTML = '<img src="' + url + '" class="img-fluid" style="max-height:85vh;border-radius:12px;">';
      else content.innerHTML = '<video controls autoplay class="img-fluid" style="max-height:85vh;border-radius:12px;"><source src="' + url + '"></video>';
      const el = document.getElementById('mediaViewerModal');
      if (el && window.bootstrap) new bootstrap.Modal(el).show();
    },

    markRead: async function () {
      if (!this.currentMySQLId) return;
      try {
        const fd = new URLSearchParams();
        fd.append('ticket_id', this.currentMySQLId);
        await fetch('/api/support/mark-read/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': getCsrfToken() },
          body: fd.toString(),
        });
        const t = this.tickets.find(x => x.mysql_id === this.currentMySQLId);
        if (t) t.unread_count = 0;
        this.renderTickets(this.tickets);
      } catch (e) {}
    },

    openNewTicketModal: function () {
      const el = document.getElementById('newTicketModal');
      if (el && window.bootstrap) new bootstrap.Modal(el).show();
    },

    createNewTicket: async function () {
      const subject = (document.getElementById('ticketSubjectInput') || {}).value;
      const message = (document.getElementById('ticketMessage') || {}).value;
      const type = (document.getElementById('ticketType') || {}).value || 'query';
      if (!subject || !message) { toast('Please fill in all fields', 'info'); return; }

      try {
        const fd = new URLSearchParams();
        fd.append('subject', subject.trim());
        fd.append('message', message.trim());
        fd.append('type', type);
        fd.append('urgency', 'medium');
        const r = await fetch('/api/support/create-ticket/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': getCsrfToken() },
          body: fd.toString(),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Failed');

        // Also push to Firebase so admin panel sees it
        if (this.db) {
          const ts = Date.now();
          const ticketData = {
            id: d.firebase_id,
            mysql_id: d.ticket_id,
            subject: subject.trim(),
            type: type,
            status: 'open',
            created_at: ts,
            last_updated: ts,
            last_message: message.trim().slice(0, 100),
            user_id: CURRENT_USER.id,
            user_name: CURRENT_USER.name,
            unread_count: 0,
          };
          try {
            await this.db.ref(`users/${CURRENT_USER.id}/tickets/${d.firebase_id}`).set(ticketData);
          } catch (e) {}
        }

        const modalEl = document.getElementById('newTicketModal');
        if (modalEl && window.bootstrap) bootstrap.Modal.getInstance(modalEl).hide();
        document.getElementById('ticketSubjectInput').value = '';
        document.getElementById('ticketMessage').value = '';

        await this.loadTickets();
        this.selectTicket(d.firebase_id);
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    },  
  };

  window.supportApp = SupportApp;

  document.addEventListener('DOMContentLoaded', () => SupportApp.init());
})();