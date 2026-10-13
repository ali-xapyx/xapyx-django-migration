// friends.js — Friends page (matches PHP behavior)
(function () {
    'use strict';

    const API = {
        counts:    '/api/friends/counts/',
        list:      '/api/friends/list/',
        pending:   '/api/friends/pending/',
        sent:      '/api/friends/sent/',
        suggested: '/api/friends/suggested/',
        search:    '/api/friends/search/',
        send:      '/api/friends/send-request/',
        accept:    '/api/friends/accept/',
        decline:   '/api/friends/decline/',
        cancel:    '/api/friends/cancel/',
        remove:    '/api/friends/remove/',
        recentActivity: '/api/friends/recent-activity/',
    };

    let currentSection = 'friends';
    let countsInterval = null;

    function getCsrfToken() {
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? m[1] : '';
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    // ─────────────────────────────────────────────────────────
    // TOAST
    // ─────────────────────────────────────────────────────────
    function showAlert(message, type = 'info', duration = 5000) {
        const container = document.getElementById('toastContainer');
        if (!container) { console.warn('Toast container not found'); return; }

        const iconMap = {
            success: 'fa-check-circle',
            error:   'fa-times-circle',
            warning: 'fa-exclamation-triangle',
            info:    'fa-info-circle',
        };

        const toast = document.createElement('div');
        toast.className = 'toast-notification ' + type;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas ${iconMap[type] || 'fa-info-circle'} toast-icon"></i>
                <span class="toast-message">${escapeHtml(message)}</span>
                <button class="toast-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
            </div>
        `;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    window.showAlert = showAlert;

    // ─────────────────────────────────────────────────────────
    // CONFIRM DIALOGS
    // ─────────────────────────────────────────────────────────
    function setupCustomConfirms() {
        const overlay        = document.getElementById('customConfirmOverlay');
        const confirmBox     = document.getElementById('customConfirmBox');
        const confirmCancel  = document.getElementById('confirmCancel');
        const confirmOk      = document.getElementById('confirmOk');
        const deleteBox      = document.getElementById('deleteConfirmBox');
        const deleteCancel   = document.getElementById('deleteCancel');
        const deleteOk       = document.getElementById('deleteOk');

        if (!overlay) return;

        let confirmResolve = null;
        let deleteResolve  = null;

        window.showConfirm = function (title, message, options = {}) {
            return new Promise((resolve) => {
                confirmResolve = resolve;
                document.getElementById('confirmTitle').textContent = title;
                document.getElementById('confirmMessage').textContent = message;
                if (options.okText)     confirmOk.textContent = options.okText;
                if (options.cancelText) confirmCancel.textContent = options.cancelText;
                overlay.classList.add('show');
                confirmBox.classList.add('show');
            });
        };

        window.showDeleteConfirm = function (message) {
            return new Promise((resolve) => {
                deleteResolve = resolve;
                document.getElementById('deleteConfirmMessage').textContent =
                    message || 'Are you sure you want to delete this?';
                overlay.classList.add('show');
                deleteBox.classList.add('show');
            });
        };

        confirmCancel.onclick = () => { hideAllConfirms(); if (confirmResolve) confirmResolve(false); };
        confirmOk.onclick     = () => { hideAllConfirms(); if (confirmResolve) confirmResolve(true); };
        deleteCancel.onclick  = () => { hideAllConfirms(); if (deleteResolve)  deleteResolve(false); };
        deleteOk.onclick      = () => { hideAllConfirms(); if (deleteResolve)  deleteResolve(true); };

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                hideAllConfirms();
                if (confirmResolve) confirmResolve(false);
                if (deleteResolve)  deleteResolve(false);
            }
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideAllConfirms();
                if (confirmResolve) confirmResolve(false);
                if (deleteResolve)  deleteResolve(false);
            }
        });
    }

    function hideAllConfirms() {
        document.querySelectorAll('.custom-confirm-overlay, .custom-confirm-box')
            .forEach(el => el.classList.remove('show'));
    }

    // ─────────────────────────────────────────────────────────
    // CARD RENDERERS
    // ─────────────────────────────────────────────────────────
    function friendCard(f) {
        var av = f.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `<div class="friend-item" data-friendship-id="${f.friendship_id}">
            <div class="friend-item-main">
                <a href="/user/${f.friend_id}/" class="friend-avatar">
                    <img src="${escapeHtml(avThumb)}" width="40" height="40" onerror="this.onerror=null;this.src='${escapeHtml(av)}'" alt="${escapeHtml(f.name)}">
                </a>
                <div class="friend-info">
                    <a href="/user/${f.friend_id}/" class="friend-name">${escapeHtml(f.name)}</a>
                    <div class="friend-username">@${escapeHtml(f.username)}</div>
                    <div class="friend-meta"><span class="friend-activity">Friends since ${escapeHtml(f.time_ago)}</span></div>
                </div>
            </div>
            <div class="friend-actions">
                <button class="btn-action-small btn-message" data-id="${f.friend_id}" title="Message"><i class="fas fa-comment"></i></button>
                <button class="btn-action-small btn-remove" data-id="${f.friendship_id}" title="Remove Friend"><i class="fas fa-user-times"></i></button>
            </div>
        </div>`;
    }

    function pendingCard(p) {
        var av = p.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `<div class="request-item" data-request-id="${p.request_id}">
            <div class="request-item-main">
                <a href="/user/${p.sender_id}/" class="request-avatar">
                    <img src="${escapeHtml(avThumb)}" width="40" height="40" onerror="this.onerror=null;this.src='${escapeHtml(av)}'" alt="${escapeHtml(p.name)}">
                </a>
                <div class="request-info">
                    <a href="/user/${p.sender_id}/" class="request-name">${escapeHtml(p.name)}</a>
                    <div class="request-username">@${escapeHtml(p.username)}</div>
                    <div class="request-meta"><span class="request-date">Requested ${escapeHtml(p.time_ago)}</span></div>
                </div>
            </div>
            <div class="request-actions">
                <button class="btn-action-small btn-accept" data-id="${p.request_id}" title="Accept"><i class="fas fa-check"></i></button>
                <button class="btn-action-small btn-decline" data-id="${p.request_id}" title="Decline"><i class="fas fa-times"></i></button>
            </div>
        </div>`;
    }

    function sentCard(s) {
        var av = s.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `<div class="sent-request-item" data-request-id="${s.request_id}">
            <div class="sent-request-item-main">
                <a href="/user/${s.receiver_id}/" class="sent-request-avatar">
                    <img src="${escapeHtml(avThumb)}" width="40" height="40" onerror="this.onerror=null;this.src='${escapeHtml(av)}'" alt="${escapeHtml(s.name)}">
                </a>
                <div class="sent-request-info">
                    <a href="/user/${s.receiver_id}/" class="sent-request-name">${escapeHtml(s.name)}</a>
                    <div class="sent-request-username">@${escapeHtml(s.username)}</div>
                    <div class="sent-request-meta"><span class="sent-request-date">Sent ${escapeHtml(s.time_ago)}</span></div>
                </div>
            </div>
            <div class="sent-request-actions">
                <button class="btn-action-small btn-message" data-id="${s.receiver_id}" title="Message"><i class="fas fa-comment"></i></button>
                <button class="btn-action-small btn-cancel" data-id="${s.request_id}" title="Cancel Request"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }

    function searchResultCard(u) {
        var av = u.picture || '/static/images/avatars/default.png';
        var avThumb = av;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
        }
        return `<div class="search-result-item" data-user-id="${u.id}">
            <div class="search-result-item-main">
                <a href="/user/${u.id}/" class="search-result-avatar">
                    <img src="${escapeHtml(avThumb)}" width="40" height="40" onerror="this.onerror=null;this.src='${escapeHtml(av)}'" alt="${escapeHtml(u.name)}">
                </a>
                <div class="search-result-info">
                    <a href="/user/${u.id}/" class="search-result-name">${escapeHtml(u.name)}</a>
                    <div class="search-result-username">@${escapeHtml(u.username)}</div>
                </div>
            </div>
            <div class="search-result-actions">
                <button class="btn-action-small btn-message" data-id="${u.id}" title="Message"><i class="fas fa-comment"></i></button>
                <button class="btn-action-small btn-add" data-id="${u.id}" title="Add Friend"><i class="fas fa-user-plus"></i></button>
            </div>
        </div>`;
    }

    function emptyState(icon, title, message, buttonText, section) {
        return `<div class="content-empty">
            <i class="fas ${icon}"></i>
            <h4>${title}</h4>
            <p>${message}</p>
            ${buttonText ? `<button class="btn-primary" data-goto="${section}"><i class="fas fa-user-plus"></i> ${buttonText}</button>` : ''}
        </div>`;
    }

    // ─────────────────────────────────────────────────────────
    // COUNTS
    // ─────────────────────────────────────────────────────────
    async function loadCounts() {
        try {
            const r = await fetch(API.counts);
            const d = await r.json();
            if (!d.success) return;

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val;
            };
            setText('friendsCount',      d.friends);
            setText('pendingCount',      d.pending);
            setText('sentCount',         d.sent);
            setText('statTotalFriends',  d.friends);
            setText('statTotalPending',  d.pending);
            setText('statTotalSent',     d.sent);

            const pendingBox = document.getElementById('statPending');
            if (pendingBox) {
                let badge = pendingBox.querySelector('.notification-badge');
                if (d.pending > 0) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'notification-badge';
                        pendingBox.appendChild(badge);
                    }
                    badge.textContent = d.pending;
                } else if (badge) {
                    badge.remove();
                }
            }

            window.dispatchEvent(new CustomEvent('friendsCountsUpdated', {
                detail: { pending: d.pending }
            }));
            if (typeof window.refreshNotifications === 'fucntion') {
                window.refreshNotifications();
            }
        } catch (err) {
            console.error('Counts error:', err);
        }
    }

    // ─────────────────────────────────────────────────────────
    // POST HELPER
    // ─────────────────────────────────────────────────────────
    async function postAction(url, data) {
        const body = new URLSearchParams(data).toString();
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRFToken': getCsrfToken(),
            },
            body: body,
        });
        return r.json();
    }

    // ─────────────────────────────────────────────────────────
    // SECTION LOADING
    // ─────────────────────────────────────────────────────────
    async function loadSection(section) {
        currentSection = section;

        const url = new URL(window.location);
        url.searchParams.set('section', section);
        window.history.pushState({}, '', url);

        document.querySelectorAll('.stat-box').forEach(b => b.classList.remove('active'));
        const activeBox = document.querySelector(`.stat-link[data-section="${section}"] .stat-box`);
        if (activeBox) activeBox.classList.add('active');

        const titles = {
            friends: 'All Friends',
            pending: 'Pending Requests',
            sent:    'Sent Requests',
            add:     'Add Friends',
        };
        const icons = {
            friends: 'fa-user-friends',
            pending: 'fa-clock',
            sent:    'fa-paper-plane',
            add:     'fa-user-plus',
        };
        const titleEl = document.getElementById('sectionTitle');
        if (titleEl) titleEl.innerHTML = `<i class="fas ${icons[section] || 'fa-users'}"></i> ${titles[section] || 'All Friends'}`;

        const container = document.getElementById('contentContainer');
        if (!container) return;
        container.innerHTML = `<div class="content-loading"><div class="friends-spinner"></div><p>Loading ${titles[section]}...</p></div>`;

        try {
            if (section === 'friends') {
                const r = await fetch(API.list);
                const d = await r.json();
                if (d.success && d.friends.length) {
                    container.innerHTML = '<div class="friends-list">' + d.friends.map(friendCard).join('') + '</div>';
                } else {
                    container.innerHTML = emptyState('fa-users', 'No Friends Yet', 'Start adding friends to see them here!', 'Add Friends', 'add');
                }
            } else if (section === 'pending') {
                const r = await fetch(API.pending);
                const d = await r.json();
                if (d.success && d.pending.length) {
                    container.innerHTML = '<div class="requests-list">' + d.pending.map(pendingCard).join('') + '</div>';
                } else {
                    container.innerHTML = emptyState('fa-clock', 'No Pending Requests', "You don't have any pending friend requests.", null, null);
                }
            } else if (section === 'sent') {
                const r = await fetch(API.sent);
                const d = await r.json();
                if (d.success && d.sent.length) {
                    container.innerHTML = '<div class="sent-requests-list">' + d.sent.map(sentCard).join('') + '</div>';
                } else {
                    container.innerHTML = emptyState('fa-paper-plane', 'No Sent Requests', "You haven't sent any friend requests yet.", 'Find Friends', 'add');
                }
            } else if (section === 'add') {
                container.innerHTML = `
                    <div class="add-friends-container">
                        <div class="search-box">
                            <div class="search-input-group">
                                <i class="fas fa-search"></i>
                                <input type="text" id="searchFriendsInput" class="search-input" placeholder="Search by name or username...">
                            </div>
                        </div>
                        <div id="searchResults" class="search-results">
                            <div class="content-loading"><div class="friends-spinner"></div><p>Loading suggestions...</p></div>
                        </div>
                    </div>
                `;
                wireSearchInput();
                loadSuggestions();
            }
        } catch (err) {
            console.error('Load error:', err);
            container.innerHTML = '<div class="content-error"><i class="fas fa-exclamation-triangle"></i><h4>Error Loading</h4><p>Please try again.</p></div>';
        }
    }
    window.loadSection = loadSection;

    // ─────────────────────────────────────────────────────────
    // SUGGESTIONS + SEARCH (Add Friends tab)
    // ─────────────────────────────────────────────────────────
    async function loadSuggestions() {
        const results = document.getElementById('searchResults');
        if (!results) return;
        try {
            const r = await fetch(API.suggested);
            const d = await r.json();
            if (d.success && d.users.length) {
                results.innerHTML = '<div class="search-results-list">' + d.users.map(searchResultCard).join('') + '</div>';
            } else {
                results.innerHTML = emptyState('fa-user-friends', 'No Suggestions Available', 'Try searching for friends instead.', null, null);
            }
        } catch (e) {
            results.innerHTML = '<div class="content-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load suggestions</p></div>';
        }
    }

    function wireSearchInput() {
        const input = document.getElementById('searchFriendsInput');
        if (!input) return;

        let debounceTimer = null;
        input.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            const q = this.value.trim();
            const results = document.getElementById('searchResults');
            if (!results) return;

            if (q.length < 2) {
                loadSuggestions();
                return;
            }

            results.innerHTML = '<div class="content-loading"><div class="friends-spinner"></div><p>Searching...</p></div>';

            debounceTimer = setTimeout(async function () {
                try {
                    const r = await fetch(API.search + '?q=' + encodeURIComponent(q));
                    const d = await r.json();
                    if (d.success && d.users.length) {
                        results.innerHTML = '<div class="search-results-list">' + d.users.map(searchResultCard).join('') + '</div>';
                    } else {
                        results.innerHTML = emptyState('fa-search', 'No Users Found', 'No users match "' + escapeHtml(q) + '"', null, null);
                    }
                } catch (e) {
                    results.innerHTML = '<div class="content-error"><i class="fas fa-exclamation-triangle"></i><p>Search failed</p></div>';
                }
            }, 500);
        });
    }

    // ─────────────────────────────────────────────────────────
    // RECENT ACTIVITY
    // ─────────────────────────────────────────────────────────
    async function loadRecentActivity() {
        try {
            const r = await fetch(API.recentActivity);
            const d = await r.json();
            if (!d.success) return;

            const onlineEl = document.getElementById('statTotalOnline');
            if (onlineEl) onlineEl.textContent = d.online_count;

            const widget = document.getElementById('recentActivityWidget');
            const list = document.getElementById('recentActivityList');
            if (!widget || !list) return;

            widget.style.display = 'block';

            if (!d.activity || d.activity.length === 0) {
                list.innerHTML = `<div class="text-center py-3" style="font-size:0.8rem; color:var(--xpy-text-secondary);">
                    <i class="fas fa-inbox"></i> No recent activity
                </div>`;
                return;
            }

            list.innerHTML = d.activity.map(a => {
                var av = a.picture || '/static/images/avatars/default.png';
                var avThumb = av;
                if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
                    avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
                }
                return `
                <div class="activity-item">
                    <img src="${escapeHtml(avThumb)}" width="40" height="40" onerror="this.onerror=null;this.src='${escapeHtml(av)}'" class="activity-avatar" alt="">
                    <span class="activity-text">
                        <strong>${escapeHtml(a.name)}</strong>
                        <span class="activity-action">
                            ${a.action_type === 'sent' ? 'became your friend' : 'accepted your request'}
                        </span>
                    </span>
                    <span class="activity-time">${escapeHtml(a.time_ago)}</span>
                </div>
            `;
            }).join('');
        } catch (err) {
            console.error('Recent activity error:', err);
        }
    }

    // ─────────────────────────────────────────────────────────
    // CLICK DELEGATION
    // ─────────────────────────────────────────────────────────
    document.addEventListener('click', async function (e) {
        // Empty-state "goto" buttons
        const goto = e.target.closest('[data-goto]');
        if (goto) { loadSection(goto.dataset.goto); return; }

        // Stat box clicks
        const link = e.target.closest('.stat-link');
        if (link) {
            const section = link.dataset.section;
            if (section) loadSection(section);
            return;
        }

        // Action buttons
        const btn = e.target.closest('.btn-action-small');
        if (!btn) return;
        const id = btn.dataset.id;

        // ACCEPT — no confirm
        if (btn.classList.contains('btn-accept')) {
            const r = await postAction(API.accept, { request_id: id });
            if (r.success) { showAlert('Friend request accepted!', 'success'); loadSection('friends'); loadCounts(); }
            else showAlert(r.error || 'Failed to accept request', 'error');
        }

        // DECLINE — custom confirm
        else if (btn.classList.contains('btn-decline')) {
            showConfirm('Decline Request', 'Are you sure you want to decline this request?').then(async (ok) => {
                if (!ok) return;
                const r = await postAction(API.decline, { request_id: id });
                if (r.success) {
                    showAlert('Friend request declined', 'info');
                    const card = btn.closest('.request-item, .request-card');
                    if (card) card.remove();
                    loadCounts();
                }
                else showAlert(r.error || 'Failed to decline request', 'error');
            });
        }
        // CANCEL — custom confirm
        else if (btn.classList.contains('btn-cancel')) {
            showConfirm('Cancel Request', 'Are you sure you want to cancel this request?').then(async (ok) => {
                if (!ok) return;
                const r = await postAction(API.cancel, { request_id: id });
                if (r.success) {
                    showAlert('Friend request cancelled', 'info');
                    // Optimistically remove the card immediately
                    const card = btn.closest('.sent-request-item, .request-card, .sent-request-card');
                    if (card) card.remove();
                    loadCounts();
                }
                else showAlert(r.error || 'Failed to cancel request', 'error');
            });
        }

        // REMOVE — custom delete confirm
        else if (btn.classList.contains('btn-remove')) {
            showDeleteConfirm('Are you sure you want to remove this friend?').then(async (ok) => {
                if (!ok) return;
                const r = await postAction(API.remove, { friendship_id: id });
                if (r.success) {
                    showAlert('Friend removed successfully', 'success');
                    const card = btn.closest('.friend-item, .friend-card');
                    if (card) card.remove();
                    loadCounts();
                }
                else showAlert(r.error || 'Failed to remove friend', 'error');
            });
        }

        // ADD — no confirm, reload suggestions after
        else if (btn.classList.contains('btn-add')) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<div class="friends-spinner" style="width:16px;height:16px;border-width:2px;"></div>';
            btn.disabled = true;
            try {
                const r = await postAction(API.send, { user_id: id });
                if (r.success) {
                    showAlert(r.message || 'Friend request sent!', 'success');
                    loadCounts();
                    const searchInput = document.getElementById('searchFriendsInput');
                    if (searchInput && searchInput.value.trim().length >= 2) {
                        searchInput.dispatchEvent(new Event('input'));
                    } else {
                        loadSuggestions();
                    }
                } else {
                    showAlert(r.error || 'Failed to send request', 'error');
                }
            } finally {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        }

        // MESSAGE
        else if (btn.classList.contains('btn-message')) {
            window.location.href = '/chat/?user_id=' + id;
        }
    });

    // ─────────────────────────────────────────────────────────
    // POPSTATE — browser back/forward
    // ─────────────────────────────────────────────────────────
    window.addEventListener('popstate', function () {
        const params = new URLSearchParams(window.location.search);
        const section = params.get('section') || 'friends';
        if (section !== currentSection) loadSection(section);
    });

    // ─────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        console.log('Friends page loaded');
        setupCustomConfirms();
        loadCounts();
        loadRecentActivity();

        const params = new URLSearchParams(window.location.search);
        const initialSection = params.get('section') || 'friends';
        loadSection(initialSection);

        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', function () {
            loadSection(currentSection);
            loadCounts();
            loadRecentActivity();
        });

        countsInterval = setInterval(function () {
            loadCounts();
            loadRecentActivity();
        }, 30000);
    });

    window.addEventListener('beforeunload', function () {
        if (countsInterval) clearInterval(countsInterval);
    });

})();