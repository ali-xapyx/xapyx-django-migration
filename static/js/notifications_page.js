// static/js/notifications_page.js
// Dedicated Notifications Page Controller (Task 16 + Task 16.5)

class NotificationsPageController {
    constructor() {
        this.currentFilter = 'all';
        this.currentPage = 1;
        this.limit = 20;
        this.isLoading = false;
        this.hasMore = false;
        this.notifications = [];

        this.listEl = document.getElementById('notificationsPageList');
        this.loadMoreBtn = document.getElementById('loadMoreNotifsBtn');
        this.unreadBadge = document.getElementById('notifHeaderBadge');
        this.statUnread = document.getElementById('statNotifUnread');
        this.statTotal = document.getElementById('statNotifTotal');

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadNotifications(1, false);
    }

    bindEvents() {
        // Filter tabs
        document.querySelectorAll('.notif-filter-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const filter = target.getAttribute('data-filter') || 'all';
                if (filter === this.currentFilter && this.currentPage === 1) return;

                document.querySelectorAll('.notif-filter-tab').forEach(b => b.classList.remove('active'));
                target.classList.add('active');

                this.currentFilter = filter;
                this.currentPage = 1;
                this.loadNotifications(1, false);
            });
        });

        // Load more button
        if (this.loadMoreBtn) {
            this.loadMoreBtn.addEventListener('click', () => {
                if (!this.isLoading && this.hasMore) {
                    this.loadNotifications(this.currentPage + 1, true);
                }
            });
        }

        // Mark all as read
        const markAllBtn = document.getElementById('btnMarkAllRead');
        if (markAllBtn) {
            markAllBtn.addEventListener('click', () => this.markAllAsRead());
        }

        // Clear all
        const clearAllBtn = document.getElementById('btnClearAll');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => this.clearAll());
        }
    }

    getCSRFToken() {
        const match = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
        return match ? match.split('=')[1] : '';
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    cleanTitle(rawTitle, notifType) {
        if (!rawTitle) return '';
        let t = rawTitle.trim();
        if (t.startsWith('??')) {
            t = t.substring(2).trim();
            const emojiMap = {
                'page_follow': '📄',
                'reaction': '❤️',
                'comment': '💬',
                'friend_request': '👥',
                'friend_request_accepted': '👥',
                'shoutbox_mention': '📢',
                'mention': '📢'
            };
            const prefix = emojiMap[notifType] || '🔔';
            return prefix + (t ? ' ' + t : '');
        }
        return t;
    }

    sanitizeLink(raw) {
        if (!raw || raw === '#' || raw.indexOf('undefined') !== -1) return '/feed/';
        try {
            if (raw.startsWith('http://') || raw.startsWith('https://')) {
                const u = new URL(raw);
                raw = u.pathname + u.search + u.hash;
            }
        } catch (e) { /* keep */ }

        if (raw.indexOf('/model/user_profile.php') !== -1) {
            const m = raw.match(/user_id=(\d+)/);
            return m ? ('/user/' + m[1] + '/') : '/feed/';
        }
        if (raw.indexOf('/model/friends.php') !== -1)     return '/friends/';
        if (raw.indexOf('/model/shoutbox.php') !== -1)    return '/shoutbox/';
        if (raw.indexOf('/model/chat.php') !== -1)        return '/chat/';
        if (raw.indexOf('/model/chatrooms.php') !== -1)   return '/chatrooms/';
        if (raw.indexOf('/model/groups.php') !== -1)      return '/groups/';
        if (raw.indexOf('/model/group_view.php') !== -1) {
            const m = raw.match(/group_id=(\d+)/);
            return m ? ('/groups/' + m[1] + '/') : '/groups/';
        }
        if (raw.indexOf('/model/pages.php') !== -1)       return '/pages/';
        if (raw.indexOf('/model/leaderboard.php') !== -1) return '/leaderboard/';
        if (raw.indexOf('/model/support.php') !== -1)     return '/support/';
        if (raw.indexOf('/model/') !== -1)                return '/feed/';
        if (raw.startsWith('/view/'))                     return '/feed/';
        if (raw.startsWith('/'))                          return raw;
        return '/feed/';
    }

    updateBadges(unreadCount, totalCount) {
        if (this.unreadBadge) {
            this.unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            this.unreadBadge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
        }
        if (this.statUnread) {
            this.statUnread.textContent = unreadCount;
        }
        if (this.statTotal && typeof totalCount === 'number') {
            this.statTotal.textContent = totalCount;
        }

        if (window.notificationSystem) {
            window.notificationSystem.unreadCount = unreadCount;
            window.notificationSystem.updateBadge();
        }
    }

    async loadNotifications(page = 1, append = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        if (!append && this.listEl) {
            this.listEl.innerHTML = `
                <div class="notif-page-loading">
                    <i class="fas fa-spinner fa-spin fa-2x"></i>
                    <p class="mt-2 text-muted">Loading notifications...</p>
                </div>
            `;
        }

        if (this.loadMoreBtn) {
            this.loadMoreBtn.disabled = true;
            this.loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Loading...';
        }

        try {
            const url = `/api/notifications/page/?page=${page}&filter=${encodeURIComponent(this.currentFilter)}&limit=${this.limit}`;
            const res = await fetch(url);
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load notifications');
            }

            this.currentPage = data.page || page;
            this.hasMore = !!data.has_more;
            this.updateBadges(data.unread_count || 0, data.total);

            if (append) {
                this.notifications = this.notifications.concat(data.notifications || []);
            } else {
                this.notifications = data.notifications || [];
            }

            this.render(append);
        } catch (err) {
            console.error('Error loading notifications:', err);
            if (!append && this.listEl) {
                this.listEl.innerHTML = `
                    <div class="notif-page-empty">
                        <i class="fas fa-exclamation-triangle fa-2x text-warning"></i>
                        <h4 class="mt-3">Error loading notifications</h4>
                        <p class="text-muted">${this.escapeHtml(err.message)}</p>
                        <button class="btn btn-outline-primary btn-sm mt-2" onclick="window.notifApp.loadNotifications(1, false)">Try Again</button>
                    </div>
                `;
            }
        } finally {
            this.isLoading = false;
            if (this.loadMoreBtn) {
                this.loadMoreBtn.disabled = false;
                this.loadMoreBtn.innerHTML = '<i class="fas fa-angle-double-down me-1"></i> Load more';
                this.loadMoreBtn.style.display = this.hasMore ? 'inline-block' : 'none';
            }
        }
    }

    render(append = false) {
        if (!this.listEl) return;

        if (this.notifications.length === 0) {
            this.listEl.innerHTML = `
                <div class="notif-page-empty">
                    <i class="fas fa-bell-slash fa-3x"></i>
                    <h4 class="mt-3">No notifications found</h4>
                    <p class="text-muted">You have no notifications in this view.</p>
                </div>
            `;
            return;
        }

        if (!append) {
            this.listEl.innerHTML = '';
        }

        const itemsToRender = append
            ? this.notifications.slice((this.currentPage - 1) * this.limit)
            : this.notifications;

        const frag = document.createDocumentFragment();

        itemsToRender.forEach(n => {
            const card = document.createElement('div');
            card.className = `notif-page-card ${n.is_read ? 'read' : 'unread'}`;
            card.setAttribute('data-id', n.id);

            const safeLink = this.sanitizeLink(n.link);
            const iconName = n.icon || 'bell';
            const displayTitle = this.cleanTitle(n.title, n.type);

            // Actor avatar rendering with _avatar.webp thumbnail and fallback (Task 10.5 & Task 16.5)
            let iconOrAvatarHtml = '';
            if (n.actor_picture) {
                let av = n.actor_picture;
                let avThumb = av;
                if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp')) {
                    avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
                }
                iconOrAvatarHtml = `
                    <div class="notif-page-avatar-wrap">
                        <img src="${this.escapeHtml(avThumb)}"
                             width="42" height="42"
                             alt="${this.escapeHtml(n.actor_name || n.actor_username || 'User')}"
                             class="notif-page-avatar-img"
                             onerror="this.onerror=null;this.src='${this.escapeHtml(av)}';this.onerror=function(){this.src='/static/images/avatars/default.png';};">
                    </div>
                `;
            } else {
                iconOrAvatarHtml = `
                    <div class="notif-page-icon">
                        <i class="fas fa-${this.escapeHtml(iconName)}"></i>
                    </div>
                `;
            }

            card.innerHTML = `
                ${iconOrAvatarHtml}
                <div class="notif-page-body">
                    <div class="notif-page-title">${this.escapeHtml(displayTitle)}</div>
                    <div class="notif-page-msg">${this.escapeHtml(n.message)}</div>
                    <div class="notif-page-meta">
                        <span class="notif-page-time"><i class="far fa-clock me-1"></i>${this.escapeHtml(n.time_ago || 'Recently')}</span>
                        <span class="notif-page-type-tag">${this.escapeHtml(n.type || 'general')}</span>
                        ${n.actor_name ? `<span class="notif-page-actor-tag">${this.escapeHtml(n.actor_name)}</span>` : ''}
                    </div>
                </div>
                <div class="notif-page-actions">
                    ${!n.is_read ? '<span class="notif-unread-dot" title="Unread"></span>' : ''}
                    <button class="notif-page-del-btn" title="Delete notification" type="button">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;

            // Card click -> mark read and navigate
            card.addEventListener('click', (e) => {
                if (e.target.closest('.notif-page-del-btn')) return;
                this.handleCardClick(n.id, safeLink, card);
            });

            // Delete button click
            const delBtn = card.querySelector('.notif-page-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteNotification(n.id, card, delBtn);
                });
            }

            frag.appendChild(card);
        });

        this.listEl.appendChild(frag);
    }

    async handleCardClick(notifId, targetUrl, cardEl) {
        try {
            await fetch(`/api/notifications/mark-read/${notifId}/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': this.getCSRFToken() }
            });
            if (cardEl) {
                cardEl.classList.remove('unread');
                cardEl.classList.add('read');
                const dot = cardEl.querySelector('.notif-unread-dot');
                if (dot) dot.remove();
            }
        } catch (err) {
            console.warn('Error marking notification read:', err);
        } finally {
            window.location.href = targetUrl || '/feed/';
        }
    }

    async deleteNotification(notifId, cardEl, btnEl) {
        if (!confirm('Dismiss this notification?')) return;

        const originalHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const formData = new FormData();
            formData.append('notification_id', notifId);

            const res = await fetch('/api/notifications/delete/', {
                method: 'POST',
                headers: { 'X-CSRFToken': this.getCSRFToken() },
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                cardEl.style.transition = 'all 0.3s ease';
                cardEl.style.opacity = '0';
                cardEl.style.transform = 'translateX(20px)';

                setTimeout(() => {
                    if (cardEl.parentNode) cardEl.remove();
                    this.notifications = this.notifications.filter(item => item.id !== notifId);
                    if (this.notifications.length === 0) {
                        this.render(false);
                    }
                }, 300);

                const curBadge = parseInt(this.unreadBadge?.textContent || '0', 10);
                if (cardEl.classList.contains('unread') && curBadge > 0) {
                    this.updateBadges(Math.max(0, curBadge - 1));
                }
            } else {
                alert(data.error || 'Failed to delete notification');
                btnEl.disabled = false;
                btnEl.innerHTML = originalHtml;
            }
        } catch (err) {
            console.error('Delete notification failed:', err);
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        }
    }

    async markAllAsRead() {
        try {
            const res = await fetch('/api/notifications/read-all/', {
                method: 'POST',
                headers: { 'X-CSRFToken': this.getCSRFToken() }
            });
            const data = await res.json();
            if (data.success) {
                this.updateBadges(0);
                if (this.listEl) {
                    this.listEl.querySelectorAll('.notif-page-card').forEach(c => {
                        c.classList.remove('unread');
                        c.classList.add('read');
                        const dot = c.querySelector('.notif-unread-dot');
                        if (dot) dot.remove();
                    });
                }
                this.notifications.forEach(n => { n.is_read = true; });
                if (this.currentFilter === 'unread') {
                    this.render(false);
                }
            }
        } catch (err) {
            console.error('Mark all as read error:', err);
        }
    }

    async clearAll() {
        if (!confirm('Are you sure you want to delete ALL notifications? This cannot be undone.')) {
            return;
        }

        try {
            const res = await fetch('/api/notifications/clear-all/', {
                method: 'POST',
                headers: { 'X-CSRFToken': this.getCSRFToken() }
            });
            const data = await res.json();
            if (data.success) {
                this.notifications = [];
                this.hasMore = false;
                this.updateBadges(0, 0);
                this.render(false);
                if (this.loadMoreBtn) this.loadMoreBtn.style.display = 'none';
            } else {
                alert(data.error || 'Failed to clear notifications');
            }
        } catch (err) {
            console.error('Clear all error:', err);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.notifApp = new NotificationsPageController();
});