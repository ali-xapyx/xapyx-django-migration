// sidebar js

// ===========================================
// GLOBAL VARIABLES
// ===========================================
const isLoggedIn = window.XPY_CONFIG.isLoggedIn;
const userId = window.XPY_CONFIG.userId;
const basePath = "/";

if (typeof window.firebaseOff === 'undefined') {
    window.firebaseOff = function() { return false; };
}

// ===========================================
// STARS GENERATOR
// ===========================================
function createStars() {
    var container = document.getElementById('xpyStars');
    if (!container) return;
    container.innerHTML = '';
    var count = window.innerWidth < 480 ? 80 : window.innerWidth < 768 ? 120 : 200;
    for (var i = 0; i < count; i++) {
        var star = document.createElement('div');
        star.className = 'xpy-star';
        var size = Math.random() * 2.2 + 0.8;
        var brightness = Math.random() * 0.5 + 0.5;
        star.style.cssText =
            'width:' + size + 'px;height:' + size + 'px;' +
            'left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 100) + '%;' +
            '--xpy-d:' + ((Math.random() * 3 + 1.5).toFixed(1)) + 's;' +
            'animation-delay:' + ((Math.random() * 5).toFixed(1)) + 's;' +
            'opacity:' + brightness + ';';
        container.appendChild(star);
    }
    // Shooting stars
    for (var i = 0; i < 3; i++) {
        var s = document.createElement('div');
        s.className = 'xpy-shooting-star';
        s.style.cssText =
            'left:' + (Math.random() * 50 + 10) + '%;' +
            'top:' + (Math.random() * 25 + 5) + '%;' +
            'animation-duration:' + ((Math.random() * 3 + 2).toFixed(1)) + 's;' +
            'animation-delay:' + ((Math.random() * 8 + 3).toFixed(1)) + 's;';
        container.appendChild(s);
    }
}

// ===========================================
// TOAST FUNCTION
// ===========================================
function showToast(message, title = 'XAPYX', icon = '👋') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ===========================================
// THEME MANAGER
// ===========================================
class ThemeManager {
    constructor() {
        this.currentColor = window.XPY_CONFIG.themeColor || '#ff8c00';
        this.currentMode = window.XPY_CONFIG.themeMode || 'dark';
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.initCustomColorPicker();
        document.documentElement.setAttribute('data-theme', this.currentMode);
        document.documentElement.setAttribute('data-bs-theme', this.currentMode);
        this.updateThemeIcon();
    }

    updatePrimaryColor(color) {
        this.currentColor = color;
        document.documentElement.style.setProperty('--primary-color', color);
        document.documentElement.style.setProperty('--xpy-primary', color);
        const rgb = this.hexToRgb(color);
        document.documentElement.style.setProperty('--primary-rgb', rgb);
        document.documentElement.style.setProperty('--xpy-primary-rgb', rgb);

        document.querySelectorAll('.color-preset').forEach(p => {
            p.classList.remove('active');
            if (p.dataset.color === color) p.classList.add('active');
        });

        const customPicker = document.getElementById('customColorPicker');
        if (customPicker) customPicker.value = color;

        document.cookie = `xapyx_theme_color=${color}; path=/; max-age=${31536000}`;

        if (isLoggedIn && userId) {
            this.persistTheme(this.currentMode, color);
        }

        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { color: color, mode: this.currentMode } }));
    }

    hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `${r}, ${g}, ${b}`;
    }
        persistTheme(mode, color) {
        const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        const csrf = csrfMatch ? csrfMatch[1] : '';
        const fd = new FormData();
        fd.append('theme_mode', mode);
        fd.append('theme_color', color);
        return fetch('/api/user/theme/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf },
            body: fd
        })
        .then(r => r.json())
        .then(d => !!d.success)
        .catch(() => false);
    }

    setThemeMode(mode) {
        this.currentMode = mode;
        document.documentElement.setAttribute('data-theme', mode);
        document.documentElement.setAttribute('data-bs-theme', mode);
        document.cookie = `xapyx_theme_mode=${mode}; path=/; max-age=${31536000}`;
        this.updateThemeIcon();

        if (isLoggedIn && userId) {
            this.persistTheme(mode, this.currentColor);
        }

        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { color: this.currentColor, mode: mode } }));
        this.showThemeToast();
    }

    updateThemeIcon() {
        const icon = document.getElementById('themeIcon');
        if (icon) {
            icon.className = this.currentMode === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
        }
    }

    showThemeToast() {
        const mode = this.currentMode === 'dark' ? '🌙 Dark' : '☀️ Light';
        showToast(`${mode} mode activated`, 'Theme', '🪄');
    }

    initCustomColorPicker() {
        const customColorPicker = document.getElementById('customColorPicker');
        if (customColorPicker) {
            customColorPicker.value = this.currentColor;
            customColorPicker.addEventListener('input', (e) => {
                this.updatePrimaryColor(e.target.value);
            });
        }
    }

    setupEventListeners() {
        const themeToggle = document.getElementById('themeToggleBtn');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.setThemeMode(this.currentMode === 'dark' ? 'light' : 'dark');
            });
        }

        document.querySelectorAll('.color-preset').forEach(preset => {
            preset.addEventListener('click', (e) => {
                this.updatePrimaryColor(e.target.dataset.color);
            });
        });

        const themeTrigger = document.getElementById('themeTrigger');
        if (themeTrigger) {
            themeTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const picker = document.getElementById('themePickerPopup');
                if (picker) {
                    if (picker.classList.contains('show')) {
                        picker.classList.remove('show');
                    } else {
                        picker.classList.add('show');
                    }
                }
            });
        }

        document.addEventListener('click', (e) => {
            const picker = document.getElementById('themePickerPopup');
            const trigger = document.getElementById('themeTrigger');
            if (picker && trigger && !picker.contains(e.target) && !trigger.contains(e.target)) {
                picker.classList.remove('show');
            }
        });
    }

    saveTheme() {
        if (!isLoggedIn || !userId) {
            document.cookie = `xapyx_theme_mode=${this.currentMode}; path=/; max-age=${31536000}`;
            document.cookie = `xapyx_theme_color=${this.currentColor}; path=/; max-age=${31536000}`;
            this.closeThemePicker();
            showToast('Theme saved to browser', 'Theme', '💾');
            return;
        }

        const self = this;
        this.persistTheme(this.currentMode, this.currentColor)
            .then(function (ok) {
                document.cookie = `xapyx_theme_mode=${self.currentMode}; path=/; max-age=${31536000}`;
                document.cookie = `xapyx_theme_color=${self.currentColor}; path=/; max-age=${31536000}`;
                showToast(ok ? 'Theme saved successfully' : 'Theme saved to browser', 'Theme', '💾');
            });

        this.closeThemePicker();
    }

    resetTheme() {
        if (confirm('Reset to default theme?')) {
            this.updatePrimaryColor('#ff8c00');
            this.setThemeMode('light');
            this.saveTheme();
            this.closeThemePicker();
        }
    }

    closeThemePicker() {
        const picker = document.getElementById('themePickerPopup');
        if (picker) picker.classList.remove('show');
    }
}

// ===========================================
// CLOSE THEME PICKER - Global
// ===========================================
window.closeThemePicker = function() {
    window.themeManager?.closeThemePicker();
};

window.saveTheme = function() {
    window.themeManager?.saveTheme();
};

window.resetTheme = function() {
    window.themeManager?.resetTheme();
};

// ===========================================
// DELETE NOTIFICATION
// ===========================================


// ===========================================
// AUTHORITATIVE BELL BADGE & STATE CONTROLLER
// ===========================================
window.updateBellBadge = function(count) {
    const val = Math.max(0, parseInt(count, 10) || 0);
    if (window.notificationSystem) {
        window.notificationSystem.unreadCount = val;
    }
    const badges = document.querySelectorAll('.notification-badge, #notifHeaderBadge');
    badges.forEach(badge => {
        if (val > 0) {
            badge.textContent = val > 99 ? '99+' : String(val);
            badge.style.display = 'flex';
            badge.classList.remove('d-none');
        } else {
            badge.textContent = '0';
            badge.style.display = 'none';
            badge.classList.add('d-none');
        }
    });
    const statEl = document.getElementById('statNotifUnread');
    if (statEl) statEl.textContent = String(val);
};

window.handleNotificationClick = function(notificationId, targetUrl, event) {
    if (event) {
        if (event.target && event.target.closest && event.target.closest('.notification-delete')) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }
    const destUrl = targetUrl || '/feed/';

    if (notificationId) {
        // Optimistic UI updates
        const item = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
        if (item && item.classList.contains('unread')) {
            item.classList.remove('unread');
            item.classList.add('read');
            const dot = item.querySelector('.notification-dot');
            if (dot) dot.remove();

            const cur = window.notificationSystem ? window.notificationSystem.unreadCount : 0;
            window.updateBellBadge(Math.max(0, cur - 1));
        }

        const csrfMatch = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
        const csrfToken = csrfMatch ? csrfMatch.split('=')[1] : '';

        try {
            fetch('/api/notifications/mark-read/' + notificationId + '/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken },
                keepalive: true
            }).then(r => r.json()).then(data => {
                if (data && data.success && data.unread_count !== undefined) {
                    window.updateBellBadge(data.unread_count);
                }
            }).catch(() => {});
        } catch (e) {}
    }

    setTimeout(() => {
        window.location.href = destUrl;
    }, 60);
};

window.deleteNotification = async function(notificationId, event, button) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (!userId) return;

    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const notificationItem = button.closest('.notification-item');
    if (!notificationItem) return;

    try {
        const formData = new FormData();
        formData.append('notification_id', notificationId);

        const csrfMatch = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
        const csrfToken = csrfMatch ? csrfMatch.split('=')[1] : '';

        const response = await fetch('/api/notifications/delete/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrfToken },
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            notificationItem.style.transition = 'all 0.3s ease';
            notificationItem.style.opacity = '0';
            notificationItem.style.transform = 'translateX(20px)';

            const isUnread = notificationItem.classList.contains('unread');

            setTimeout(() => {
                if (notificationItem.parentNode) notificationItem.remove();
                if (window.notificationSystem && isUnread) {
                    window.notificationSystem.unreadCount = Math.max(0, window.notificationSystem.unreadCount - 1);
                    window.notificationSystem.updateBadge();
                }
                const notificationList = document.getElementById('notificationList');
                if (notificationList && notificationList.children.length === 0) {
                    notificationList.innerHTML = `
                        <div class="notification-item empty">
                            <i class="fas fa-bell-slash me-2"></i>
                            <span>No notifications yet</span>
                        </div>
                    `;
                }
            }, 300);
        } else {
            button.disabled = false;
            button.innerHTML = originalHTML;
        }
    } catch (error) {
        button.disabled = false;
        button.innerHTML = originalHTML;
    }
};

// ===========================================
// PROFILE DROPDOWN
// ===========================================
function setupProfileDropdown() {
    const profileMini = document.getElementById('profileMini');
    const profileDropdown = document.getElementById('profileDropdown');
    const profileWrapper = document.getElementById('profileMenuWrapper');

    if (profileMini && profileDropdown) {
        profileMini.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = profileDropdown.classList.contains('show');
            
            // Close other top popups
            document.getElementById('notificationPanel')?.classList.remove('show');
            document.getElementById('themePickerPopup')?.classList.remove('show');

            if (isOpen) {
                profileDropdown.classList.remove('show');
                profileMini.setAttribute('aria-expanded', 'false');
            } else {
                profileDropdown.classList.add('show');
                profileMini.setAttribute('aria-expanded', 'true');
            }
        });

        document.addEventListener('click', (e) => {
            if (profileWrapper) {
                if (!profileWrapper.contains(e.target)) {
                    profileDropdown.classList.remove('show');
                    profileMini.setAttribute('aria-expanded', 'false');
                }
            } else if (!profileMini.contains(e.target) && !profileDropdown.contains(e.target)) {
                profileDropdown.classList.remove('show');
                profileMini.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

// ===========================================
// SIDEBAR MANAGEMENT
// ===========================================
function setupSidebar() {
    const sidebar = document.getElementById("sidebar");
    const mobileToggle = document.getElementById("headerHamburger");
    const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
    const overlay = document.getElementById("overlay");

    if (!sidebar) return;

    function toggleMobileSidebar() {
        if (window.innerWidth >= 768) return;
        if (!sidebar || !overlay) return;

        const isOpen = sidebar.classList.contains('show');

        if (isOpen) {
            sidebar.classList.remove('show');
            overlay.classList.remove('show');
            setTimeout(() => { if (!overlay.classList.contains('show')) overlay.style.display = 'none'; }, 300);
        } else {
            sidebar.classList.add('show');
            overlay.style.display = 'block';
            setTimeout(() => overlay.classList.add('show'), 10);

            document.getElementById('notificationPanel')?.classList.remove('show');
            document.getElementById('profileDropdown')?.classList.remove('show');
            document.getElementById('themePickerPopup')?.classList.remove('show');
        }
    }

    if (mobileToggle) mobileToggle.addEventListener('click', toggleMobileSidebar);
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', toggleMobileSidebar);
    if (overlay) overlay.addEventListener('click', toggleMobileSidebar);

    sidebar.addEventListener('click', (e) => {
        if (window.innerWidth < 768 && (e.target.tagName === 'A' || e.target.closest('a'))) {
            setTimeout(toggleMobileSidebar, 150);
        }
    });
}

// ===========================================
// NOTIFICATION SYSTEM
// ===========================================
class NotificationSystem {
    constructor(userId) {
        this.userId = userId;
        this.unreadCount = 0;
        this.firebaseConnected = false;
        this.lastChildAddedAt = 0;
        this.notificationPanel = document.getElementById('notificationPanel');
        this.notificationTrigger = document.getElementById('notificationTrigger');
        this.notificationList = document.getElementById('notificationList');
        this.notificationBadge = document.querySelector('.notification-badge');
        this.markAllBtn = document.getElementById('markAllNotificationsBtn');
        this.lastMarkAllAt = 0;
        this.firebaseListeners = [];
        this.cleanup = this.cleanup.bind(this);

        if (!userId || userId === 0) return;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupFirebaseListeners();
        // Load initial notifications immediately so dropdown is never blank
        this.loadInitialNotifications();
        this.initPushNotifications();
    }

    async initPushNotifications() {
        if (!('serviceWorker' in navigator)) return;

        try {
            // Register root Service Worker for full-site scope
            const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('✅ [WebPush] Service Worker registered with scope:', registration.scope);

            if ('Notification' in window && 'PushManager' in window) {
                if (Notification.permission === 'granted') {
                    await this.syncPushSubscription(registration);
                } else if (Notification.permission === 'default') {
                    console.log('🔔 [WebPush] Push notification permission is default');
                }
            }
        } catch (error) {
            console.warn('⚠️ [WebPush] Service Worker registration error:', error);
        }
    }

    async syncPushSubscription(registration) {
        if (!registration) {
            registration = await navigator.serviceWorker.ready;
        }
        if (!registration || !registration.pushManager) return null;

        try {
            // Fetch VAPID public key from backend
            const res = await fetch('/api/save-push-subscription/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();
            if (!data.success || !data.public_key) {
                console.warn('[WebPush] Could not obtain VAPID public key:', data);
                return null;
            }

            const vapidKey = data.public_key;
            const appKey = this.urlBase64ToUint8Array(vapidKey);

            let sub = await registration.pushManager.getSubscription();
            if (!sub) {
                sub = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: appKey
                });
            }

            // Sync subscription to backend via raw SQL endpoint
            const csrfToken = this.getCsrfToken();
            await fetch('/api/save-push-subscription/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify(sub.toJSON())
            });
            console.log('✅ [WebPush] Push subscription synced to backend.');
            return sub;
        } catch (e) {
            console.warn('⚠️ [WebPush] Sync subscription error:', e);
            return null;
        }
    }

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    getCsrfToken() {
        const cookie = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('csrftoken='));
        return cookie ? decodeURIComponent(cookie.split('=')[1]) : '';
    }

    setupFirebaseListeners() {
        if (!window.notificationsDb || !window.firebaseRef) {
            setTimeout(() => this.setupFirebaseListeners(), 500);
            return;
        }

        try {
            const db = window.notificationsDb;
            const ref = window.firebaseRef;
            const query = window.firebaseQuery;
            const orderByKey = window.firebaseOrderByKey;
            const limitToLast = window.firebaseLimitToLast;
            const onChildAdded = window.firebaseOnChildAdded;
            const onValue = window.firebaseOnValue;

            // Track Firebase connection state
            const connectedRef = ref(db, '.info/connected');
            const connListener = onValue(connectedRef, (snap) => {
                this.firebaseConnected = !!snap.val();
            });
            this.firebaseListeners.push({ type: 'value', ref: connectedRef, listener: connListener });

            const notificationsRef = ref(db, `notifications/${this.userId}`);
            const recentQuery = query(notificationsRef, orderByKey(), limitToLast(1));

            const childListener = onChildAdded(recentQuery, (snapshot) => {
                const notification = snapshot.val();
                if (!notification) return;
                notification.id = parseInt(notification.id);
                notification.is_read = notification.is_read ? 1 : 0;

                // Format time_ago from created_at timestamp if present (type-aware for Unix int, ms int, or PHP datetime string)
                if (notification.created_at && !notification.time_ago) {
                    let createdAt = notification.created_at;
                    if (typeof createdAt === 'string') {
                        const parsed = Date.parse(createdAt.replace(' ', 'T'));
                        createdAt = isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
                    } else if (typeof createdAt === 'number' && createdAt > 1e12) {
                        createdAt = Math.floor(createdAt / 1000);
                    } else {
                        createdAt = parseInt(createdAt) || 0;
                    }
                    const nowSec = Math.floor(Date.now() / 1000);
                    const diffSec = Math.max(0, nowSec - createdAt);
                    if (diffSec < 60) notification.time_ago = 'Just now';
                    else if (diffSec < 3600) notification.time_ago = Math.floor(diffSec / 60) + 'm ago';
                    else if (diffSec < 86400) notification.time_ago = Math.floor(diffSec / 3600) + 'h ago';
                    else if (diffSec < 604800) notification.time_ago = Math.floor(diffSec / 86400) + 'd ago';
                    else notification.time_ago = Math.floor(diffSec / 604800) + 'w ago';
                }

                // Clean legacy '??' in title if present
                if (notification.title && notification.title.startsWith('??')) {
                    const cleanT = notification.title.substring(2).trim();
                    const emojiMap = {
                        'page_follow': '📄',
                        'reaction': '❤️',
                        'comment': '💬',
                        'friend_request': '👥',
                        'friend_request_accepted': '👥',
                        'shoutbox_mention': '📢',
                        'mention': '📢'
                    };
                    const prefix = emojiMap[notification.type] || '🔔';
                    notification.title = prefix + (cleanT ? ' ' + cleanT : '');
                }

                const isUnread = !notification.is_read;
                const nType = String(notification.type || '').toLowerCase();
                if (nType === 'message' || nType === 'chat_message' || nType.startsWith('chat_')) {
                    if (isUnread && window.handleNotificationSidebarBadge) {
                        window.handleNotificationSidebarBadge(notification);
                    }
                } else {
                    if (isUnread) {
                        this.unreadCount++;
                        this.lastChildAddedAt = Date.now();
                        window.updateBellBadge(this.unreadCount);
                    }
                    this.addNotificationToPanel(notification);
                }
            });

            this.firebaseListeners.push({ type: 'child', query: recentQuery, listener: childListener });

            const unreadRef = ref(db, `unread_counts/${this.userId}`);
            const valueListener = onValue(unreadRef, (snapshot) => {
                if (Date.now() - this.lastChildAddedAt < 5000) return;
                if (Date.now() - (this.lastMarkAllAt || 0) < 10000) return;
                const count = snapshot.val();
                if (count !== null && count !== this.unreadCount) {
                    window.updateBellBadge(count);
                }
            });

            this.firebaseListeners.push({ type: 'value', ref: unreadRef, listener: valueListener });
        } catch (error) {
            console.error('Firebase setup error:', error);
        }
    }

    markAllAsRead() {
        window.updateBellBadge(0);
        this.lastMarkAllAt = Date.now();

        if (this.notificationList) {
            this.notificationList.querySelectorAll('.notification-item').forEach(item => {
                item.classList.remove('unread');
                item.classList.add('read');
                const dot = item.querySelector('.notification-dot');
                if (dot) dot.remove();
            });
        }

        const csrfMatch = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
        const csrfToken = csrfMatch ? csrfMatch.split('=')[1] : '';

        fetch('/api/notifications/read-all/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrfToken },
            keepalive: true
        })
        .then(r => r.json())
        .then(d => {
            if (d && d.success) {
                window.updateBellBadge(0);
                window.dispatchEvent(new CustomEvent('notificationsRead'));
            }
        })
        .catch(err => console.error('Mark all read failed:', err));
    }

    async loadInitialNotifications() {
        try {
            const response = await fetch('/api/notifications/list/', {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const data = await response.json();
            if (!data.success) return;

            window.updateBellBadge(data.unread_count || 0);

            if (!this.notificationList) return;
            this.notificationList.innerHTML = '';

            if (!data.notifications || data.notifications.length === 0) {
                this.notificationList.innerHTML = '<div class="notification-item empty"><span>No notifications yet</span></div>';
                return;
            }

            this.initialLoaded = true;
            // Reverse so that when each item is prepended, the newest ends up on top
            data.notifications.slice().reverse().forEach((n) => {
                this.addNotificationToPanel({
                    id: n.id,
                    title: n.title,
                    message: n.message,
                    icon: n.icon,
                    link: n.link,
                    is_read: n.is_read ? 1 : 0,
                    time_ago: n.time_ago,
                    actor_id: n.actor_id,
                    actor_name: n.actor_name,
                    actor_username: n.actor_username,
                    actor_picture: n.actor_picture,
                });
            });
        } catch (error) {
            console.error('Load notifications error:', error);
        }
    }

    updateBadge() {
        window.updateBellBadge(this.unreadCount);
    }

        /* Map legacy PHP notification links → Django URLs and sanitize */
    sanitizeNotificationLink(raw) {
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

    addNotificationToPanel(notification) {
        if (!this.notificationList) return;

        // Deduplication guard: allow enriched payload to replace raw item
        if (notification.id) {
            const existing = this.notificationList.querySelector(`[data-id="${notification.id}"]`);
            if (existing) {
                // If new payload has actor_picture or time_ago, replace existing item
                if (notification.actor_picture || notification.time_ago) {
                    existing.remove();
                } else {
                    return;  // No enrichment — keep existing
                }
            }
        }

        const emptyState = this.notificationList.querySelector('.notification-item.empty');
        if (emptyState) emptyState.remove();

        const isUnread = !notification.is_read;

        // Render circular avatar with _avatar.webp thumbnail or fallback icon
        let iconOrAvatarHtml = '';
        if (notification.actor_picture) {
            let av = notification.actor_picture;
            let avThumb = av;
            if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp')) {
                avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
            }
            iconOrAvatarHtml = `
                <div class="notification-icon notification-avatar-wrap" style="padding:0; overflow:hidden; border-radius:50%;">
                    <img src="${this.escapeHtml(avThumb)}"
                         width="34" height="34"
                         alt="${this.escapeHtml(notification.actor_name || notification.actor_username || 'User')}"
                         style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;"
                         onerror="this.onerror=null;this.src='${this.escapeHtml(av)}';this.onerror=function(){this.src='/static/images/avatars/default.png';};">
                </div>
            `;
        } else {
            iconOrAvatarHtml = `
                <div class="notification-icon">
                    <i class="fas fa-${notification.icon || 'bell'}"></i>
                </div>
            `;
        }

        const html = `
            <div class="notification-item ${isUnread ? 'unread' : 'read'} new"
                 data-id="${notification.id}"
                 data-link="${this.escapeHtml(this.sanitizeNotificationLink(notification.link))}">
                ${iconOrAvatarHtml}
                <div class="notification-content" onclick="window.handleNotificationClick(${notification.id}, '${this.escapeHtml(this.sanitizeNotificationLink(notification.link))}', event)">
                    <div class="notification-title">${this.escapeHtml(notification.title)}</div>
                    <div class="notification-message">${this.escapeHtml(notification.message)}</div>
                    <div class="notification-time">${this.escapeHtml(notification.time_ago || 'Just now')}</div>
                </div>
                <button class="notification-delete" onclick="deleteNotification(${notification.id}, event, this)">
                    <i class="fas fa-times"></i>
                </button>
                ${isUnread ? '<div class="notification-dot"></div>' : ''}
            </div>
        `;

        const temp = document.createElement('div');
        temp.innerHTML = html;
        const newItem = temp.firstElementChild;
        if (!newItem) return;

        if (this.notificationList.firstChild) {
            this.notificationList.insertBefore(newItem, this.notificationList.firstChild);
        } else {
            this.notificationList.appendChild(newItem);
        }
        setTimeout(() => newItem.classList.remove('new'), 300);
    }

    setupEventListeners() {
        if (this.notificationTrigger && this.notificationPanel) {
            if (this.markAllBtn) {
                this.markAllBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.markAllAsRead();
                });
            }

            this.notificationTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();

                if ('Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission().then(permission => {
                        console.log('🔔 [FCM] Bell-click permission status:', permission);
                    }).catch(err => console.warn(err));
                }

                if (this.notificationPanel.classList.contains('show')) {
                    this.notificationPanel.classList.remove('show');
                } else {
                    document.getElementById('profileDropdown')?.classList.remove('show');
                    document.getElementById('themePickerPopup')?.classList.remove('show');
                    this.notificationPanel.classList.add('show');
                    if (!this.initialLoaded || !this.notificationList || this.notificationList.children.length === 0 || this.notificationList.querySelector('.notification-item.empty')) {
                        this.loadInitialNotifications();
                    }
                }
            });

            document.addEventListener('click', (e) => {
                if (this.notificationPanel && !this.notificationPanel.contains(e.target) &&
                    this.notificationTrigger && !this.notificationTrigger.contains(e.target)) {
                    this.notificationPanel.classList.remove('show');
                }
            });
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    cleanup() {
        if (this.firebaseListeners && this.firebaseListeners.length > 0) {
            this.firebaseListeners.forEach(listener => {
                try {
                    if (listener && window.firebaseOff) {
                        if (listener.type === 'child' && listener.query) {
                            window.firebaseOff(listener.query, 'child_added', listener.listener);
                        } else if (listener.ref) {
                            window.firebaseOff(listener.ref, 'value', listener.listener);
                        }
                    }
                } catch (e) {}
            });
            this.firebaseListeners = [];
        }
    }
}

// ===========================================
// RESPONSIVE CAMERA
// ===========================================
class ResponsiveCamera {
    constructor() {
        this.isOpen = false;
        this.currentMode = 'photo';
        this.currentFacingMode = 'environment';
        this.isRecording = false;
        this.recordedChunks = [];
        this.stream = null;
        this.mediaRecorder = null;
        this.currentFilter = 'none';
        this.filters = {
            none: 'none',
            grayscale: 'grayscale(100%)',
            sepia: 'sepia(100%)',
            brightness: 'brightness(1.2)',
            contrast: 'contrast(1.3)',
            warm: 'sepia(50%) saturate(150%)',
            cool: 'hue-rotate(200deg) saturate(120%)'
        };
        this.init();
    }

    init() {
        console.log('ResponsiveCamera initialized');
        this.createModal();
        this.setupEventListeners();
    }

    createModal() {
        if (document.getElementById('responsiveCameraModal')) return;

        const modalHtml = `
            <div id="responsiveCameraModal" class="camera-modal-overlay">
                <div class="camera-header">
                    <h3><i class="fas fa-camera"></i> Create Post</h3>
                    <button class="camera-close" id="camCloseBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div class="camera-options" id="camOptions">
                    <button class="camera-option-btn" id="camPhotoBtn">
                        <i class="fas fa-camera"></i> Take Photo
                    </button>
                    <button class="camera-option-btn" id="camVideoBtn">
                        <i class="fas fa-video"></i> Record Video
                    </button>
                    <button class="camera-option-btn" id="camUploadBtn">
                        <i class="fas fa-upload"></i> Upload from Gallery
                    </button>
                </div>

                <div class="camera-preview-area" id="camPreviewArea">
                    <div class="video-wrapper">
                        <video id="cameraVideoStream" autoplay playsinline muted></video>
                        <canvas id="photoCanvas"></canvas>
                    </div>

                    <div class="filter-bar" id="filterBar">
                        <button class="filter-chip active" data-filter="none">Normal</button>
                        <button class="filter-chip" data-filter="grayscale">B&W</button>
                        <button class="filter-chip" data-filter="sepia">Sepia</button>
                        <button class="filter-chip" data-filter="brightness">Bright</button>
                        <button class="filter-chip" data-filter="contrast">Contrast</button>
                        <button class="filter-chip" data-filter="warm">Warm</button>
                        <button class="filter-chip" data-filter="cool">Cool</button>
                    </div>

                    <div class="recording-timer" id="recTimer">00:00</div>
                    <div class="recording-indicator" id="recIndicator">
                        <div class="recording-dot"></div>
                        <span>REC</span>
                    </div>

                    <div class="camera-controls-bar">
                        <button class="switch-btn" id="switchCamBtn">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="capture-btn" id="captureBtn">
                            <i class="fas fa-camera"></i>
                        </button>
                        <button class="stop-recording-btn" id="stopRecordingBtn">
                            <i class="fas fa-stop"></i>
                        </button>
                    </div>
                </div>

                <div class="post-preview-area" id="postPreviewArea">
                    <div class="preview-header">
                        <h4>Preview</h4>
                        <button class="preview-close" id="previewCloseBtn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="preview-media" id="previewMedia"></div>
                    <textarea class="preview-caption" id="postCaption" placeholder="Write a caption... (optional)" rows="2"></textarea>
                    <div class="preview-actions">
                        <button class="cancel-post-btn" id="cancelPostBtn">Cancel</button>
                        <button class="submit-post-btn" id="submitPostBtn">Post</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        this.modal = document.getElementById('responsiveCameraModal');
        this.optionsDiv = document.getElementById('camOptions');
        this.previewArea = document.getElementById('camPreviewArea');
        this.video = document.getElementById('cameraVideoStream');
        this.canvas = document.getElementById('photoCanvas');
        this.captureBtn = document.getElementById('captureBtn');
        this.switchBtn = document.getElementById('switchCamBtn');
        this.stopBtn = document.getElementById('stopRecordingBtn');
        this.timer = document.getElementById('recTimer');
        this.recIndicator = document.getElementById('recIndicator');
        this.postPreviewArea = document.getElementById('postPreviewArea');
        this.previewMedia = document.getElementById('previewMedia');
        this.captionInput = document.getElementById('postCaption');
        this.submitBtn = document.getElementById('submitPostBtn');
        this.cancelBtn = document.getElementById('cancelPostBtn');
        this.previewClose = document.getElementById('previewCloseBtn');
        this.closeBtn = document.getElementById('camCloseBtn');
        this.photoBtn = document.getElementById('camPhotoBtn');
        this.videoBtn = document.getElementById('camVideoBtn');
        this.uploadBtn = document.getElementById('camUploadBtn');
        this.filterBar = document.getElementById('filterBar');

        if (!document.getElementById('hiddenFileInputCam')) {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.id = 'hiddenFileInputCam';
            fileInput.accept = 'image/*,video/*';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
        }
        this.fileInput = document.getElementById('hiddenFileInputCam');

        console.log('Modal created');
    }

    setupEventListeners() {
        const cameraBtn = document.getElementById('mobileCameraBtn');
        if (cameraBtn) {
            cameraBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Opening camera');
                this.open();
            });
        }

        if (this.photoBtn) this.photoBtn.addEventListener('click', () => this.startPhotoMode());
        if (this.videoBtn) this.videoBtn.addEventListener('click', () => this.startVideoMode());
        if (this.uploadBtn) this.uploadBtn.addEventListener('click', () => this.openGallery());
        if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
        if (this.captureBtn) this.captureBtn.addEventListener('click', () => this.capture());
        if (this.switchBtn) this.switchBtn.addEventListener('click', () => this.switchCamera());
        if (this.stopBtn) this.stopBtn.addEventListener('click', () => this.stopRecording());
        if (this.submitBtn) this.submitBtn.addEventListener('click', () => this.submitPost());
        if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.closePreview());
        if (this.previewClose) this.previewClose.addEventListener('click', () => this.closePreview());

        if (this.fileInput) this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        if (this.filterBar) {
            this.filterBar.querySelectorAll('.filter-chip').forEach(btn => {
                btn.addEventListener('click', () => this.applyFilter(btn.dataset.filter));
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    applyFilter(filterName) {
        this.currentFilter = filterName;
        const filterValue = this.filters[filterName] || 'none';
        if (this.video) this.video.style.filter = filterValue;

        if (this.filterBar) {
            this.filterBar.querySelectorAll('.filter-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filterName);
            });
        }
    }

    open() {
        if (this.modal) {
            this.modal.classList.add('active');
            this.isOpen = true;
            document.body.style.overflow = 'hidden';
        }
    }

    startPhotoMode() {
        this.currentMode = 'photo';
        this.showCameraPreview();
        this.startCamera();
    }

    startVideoMode() {
        this.currentMode = 'video';
        this.showCameraPreview();
        this.startCamera();
    }

    openGallery() {
        if (this.fileInput) this.fileInput.click();
    }

    showCameraPreview() {
        if (this.optionsDiv) this.optionsDiv.style.display = 'none';
        if (this.previewArea) this.previewArea.classList.add('active');
        if (this.captureBtn) {
            this.captureBtn.innerHTML = '<i class="fas fa-camera"></i>';
            this.captureBtn.style.display = 'flex';
            this.stopBtn.style.display = 'none';
        }
    }

    async startCamera() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera not supported');
            }

            this.showToast('Requesting camera access...', 'info');

            const constraints = {
                video: {
                    facingMode: this.currentFacingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: this.currentMode === 'video'
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);

            if (this.video) {
                this.video.srcObject = this.stream;
                await this.video.play();
                this.applyFilter('none');
                console.log('Camera started');
            }

        } catch (error) {
            console.error('Camera error:', error);
            this.showToast('Cannot access camera. Use gallery upload.', 'error');
            this.close();
        }
    }

    switchCamera() {
        this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.startCamera();
        }
    }

    capture() {
        if (this.currentMode === 'photo') {
            this.takePhoto();
        } else {
            if (this.isRecording) {
                this.stopRecording();
            } else {
                this.startRecording();
            }
        }
    }

    takePhoto() {
        if (!this.video || !this.video.videoWidth) {
            this.showToast('Camera not ready', 'error');
            return;
        }

        if (this.canvas) {
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;

            const ctx = this.canvas.getContext('2d');
            ctx.filter = this.filters[this.currentFilter] || 'none';
            ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

            this.canvas.toBlob((blob) => {
                if (blob) {
                    this.previewMediaBlob = blob;
                    this.previewMediaType = 'image';
                    this.showPostPreview(URL.createObjectURL(blob), 'image');
                }
            }, 'image/jpeg', 0.9);
        }
    }

    startRecording() {
        if (!this.stream) {
            this.showToast('Camera not ready', 'error');
            return;
        }

        this.recordedChunks = [];
        this.isRecording = true;

        if (this.captureBtn) this.captureBtn.style.display = 'none';
        if (this.stopBtn) this.stopBtn.style.display = 'flex';
        if (this.timer) this.timer.style.display = 'block';
        if (this.recIndicator) this.recIndicator.style.display = 'flex';

        let seconds = 0;
        this.recordingInterval = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            if (this.timer) {
                this.timer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
            if (seconds >= 30) this.stopRecording();
        }, 1000);

        try {
            this.mediaRecorder = new MediaRecorder(this.stream);
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
            };
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: 'video/mp4' });
                if (blob.size > 0) {
                    this.previewMediaBlob = blob;
                    this.previewMediaType = 'video';
                    this.showPostPreview(URL.createObjectURL(blob), 'video');
                }
            };
            this.mediaRecorder.start(1000);
        } catch (error) {
            console.error('Recording error:', error);
            this.showToast('Failed to start recording', 'error');
            this.isRecording = false;
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;

            if (this.captureBtn) this.captureBtn.style.display = 'flex';
            if (this.stopBtn) this.stopBtn.style.display = 'none';
            if (this.timer) this.timer.style.display = 'none';
            if (this.recIndicator) this.recIndicator.style.display = 'none';
            if (this.recordingInterval) clearInterval(this.recordingInterval);
        }
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');

        if (!isVideo && !isImage) {
            this.showToast('Please select an image or video', 'error');
            return;
        }

        this.previewMediaBlob = file;
        this.previewMediaType = isVideo ? 'video' : 'image';
        this.showPostPreview(URL.createObjectURL(file), this.previewMediaType);
        this.fileInput.value = '';
    }

    showPostPreview(url, type) {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.previewArea) this.previewArea.classList.remove('active');
        if (this.postPreviewArea) this.postPreviewArea.classList.add('active');

        if (type === 'image') {
            this.previewMedia.innerHTML = `<img src="${url}" alt="Preview">`;
        } else {
            this.previewMedia.innerHTML = `<video controls><source src="${url}" type="video/mp4"></video>`;
        }

        this.previewUrl = url;
        if (this.captionInput) this.captionInput.value = '';
        this.captionInput.focus();
    }

    closePreview() {
        if (this.postPreviewArea) this.postPreviewArea.classList.remove('active');
        if (this.previewMedia) this.previewMedia.innerHTML = '';
        if (this.captionInput) this.captionInput.value = '';
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);

        if (this.optionsDiv) this.optionsDiv.style.display = 'flex';
        if (this.previewArea) this.previewArea.classList.remove('active');
    }

    async submitPost() {
        const caption = this.captionInput ? this.captionInput.value.trim() : '';
        const content = caption || (this.previewMediaType === 'image' ? '📸 Shared a photo' : '🎥 Shared a video');

        const formData = new FormData();
        formData.append('content', content);

        const fileName = `${this.previewMediaType}_${Date.now()}.${this.previewMediaType === 'image' ? 'jpg' : 'mp4'}`;
        const file = new File([this.previewMediaBlob], fileName, {
            type: this.previewMediaType === 'image' ? 'image/jpeg' : 'video/mp4'
        });
        formData.append('media[]', file);

        this.showToast('Posting...', 'info');
        if (this.submitBtn) {
            this.submitBtn.disabled = true;
            this.submitBtn.textContent = 'Posting...';
        }

        try {
            const csrfMatch = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
            const csrfToken = csrfMatch ? csrfMatch.split('=')[1] : '';

            const response = await fetch('/api/posts/create/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfToken },
                body: formData
            });

            const data = await response.json();

            if (data.success) {
                this.showToast('Posted successfully!', 'success');
                this.close();
                if (typeof window.loadPosts === 'function') {
                    window.loadPosts(true);
                } else {
                    setTimeout(() => location.reload(), 1000);
                }
            } else {
                this.showToast(data.error || 'Failed to post', 'error');
                if (this.submitBtn) {
                    this.submitBtn.disabled = false;
                    this.submitBtn.textContent = 'Post';
                }
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.showToast('Failed to upload. Please try again.', 'error');
            if (this.submitBtn) {
                this.submitBtn.disabled = false;
                this.submitBtn.textContent = 'Post';
            }
        }
    }

    close() {
        console.log('Closing camera');

        if (this.isRecording) this.stopRecording();

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.modal) {
            this.modal.classList.remove('active');
            document.body.style.overflow = '';
        }

        if (this.optionsDiv) this.optionsDiv.style.display = 'flex';
        if (this.previewArea) this.previewArea.classList.remove('active');
        if (this.postPreviewArea) this.postPreviewArea.classList.remove('active');

        this.isOpen = false;
    }

    showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        } else {
            const toast = document.createElement('div');
            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                bottom: 100px;
                left: 50%;
                transform: translateX(-50%);
                background: ${type === 'error' ? '#e74c3c' : type === 'success' ? '#2ecc71' : '#3498db'};
                color: white;
                padding: 10px 20px;
                border-radius: 25px;
                z-index: 100001;
                font-size: 14px;
                white-space: nowrap;
                font-family: sans-serif;
            `;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }
}

// ===========================================
// ORBIT LEVEL SIMULATION
// ===========================================
function setupOrbitLevel() {
    let level = 24;
    let progress = 62;
    const levelNum = document.getElementById('levelNum');
    const progressFill = document.getElementById('progressFill');
    const xpText = document.getElementById('xpText');

    if (!levelNum || !progressFill || !xpText) return;

    setInterval(() => {
        progress += Math.random() * 0.3;
        if (progress >= 100) {
            progress = 0;
            level++;
            levelNum.textContent = level;
            showToast(`Orbit Level ${level} unlocked!`, 'Level Up!', '🎉');
        }
        progressFill.style.width = Math.min(progress, 100) + '%';
        xpText.textContent = `${Math.round(progress * 200).toLocaleString()} / 20,000 XP`;
    }, 9000);
}

// ===========================================
// NAVIGATION
// ===========================================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.removeEventListener('click', function() {});
    });
}


// ===========================================
// INITIALIZATION
// ===========================================
document.addEventListener('DOMContentLoaded', function() {
    createStars();

    // Register Service Worker for Web Push notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(function(reg) {
                console.log('✅ [WebPush] Service Worker registered:', reg.scope);
                if ('Notification' in window && Notification.permission === 'granted') {
                    if (window.sidebarNotifications && window.sidebarNotifications.syncPushSubscription) {
                        window.sidebarNotifications.syncPushSubscription(reg);
                    }
                }
            })
            .catch(function(err) {
                console.warn('[WebPush] Service Worker registration failed:', err);
            });
    }

    // Global helper for user-initiated push notification permission requests
    window.requestPushNotifications = async function() {
        if (!('Notification' in window)) {
            alert('This browser does not support desktop notifications.');
            return false;
        }
        try {
            const perm = await Notification.requestPermission();
            console.log('🔔 [WebPush] Permission status:', perm);
            if (perm === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                if (window.sidebarNotifications && window.sidebarNotifications.syncPushSubscription) {
                    await window.sidebarNotifications.syncPushSubscription(reg);
                }
                return true;
            }
            return false;
        } catch (err) {
            console.warn('⚠️ [WebPush] Error requesting notification permission:', err);
            return false;
        }
    };

    try {
        window.themeManager = new ThemeManager();
    } catch (e) { console.error('Theme error:', e); }

    if (userId && userId > 0) {
        setTimeout(() => {
            try {
                window.notificationSystem = new NotificationSystem(userId);
            } catch (e) { console.error('Notification error:', e); }
        }, 500);
    }

    try {
        setupSidebar();
        setupProfileDropdown();
        setupNavigation();
        setupOrbitLevel();
        if (isLoggedIn && userId) {
            window.responsiveCamera = new ResponsiveCamera();
        }
    } catch (e) { console.error('UI error:', e); }

    setTimeout(() => {
        document.body.classList.add('loaded');
        showToast('Your cosmic orbit is ready.', 'Welcome to XAPYX', '👋');
    }, 700);
});

window.addEventListener('resize', createStars);

window.addEventListener('beforeunload', function() {
    if (window.notificationSystem?.firebaseListeners) {
        window.notificationSystem.firebaseListeners.forEach(l => {
            try {
                if (l.type === 'child' && l.query) {
                    window.firebaseOff?.(l.query, 'child_added', l.listener);
                } else if (l.type === 'value' && l.ref) {
                    window.firebaseOff?.(l.ref, 'value', l.listener);
                }
            } catch (e) {}
        });
    }
});

console.log('🚀 XAPYX Sidebar loaded with Cosmic Theme!');
console.log('🌌 Theme mode:', window.XPY_CONFIG.themeMode, 'Color:', window.XPY_CONFIG.themeColor);
console.log('📸 Camera modal, notifications, theme picker, and all functions loaded!');

/* ============================================================
   IMAGE FALLBACK
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('img[data-default-avatar]').forEach(function (img) {
        var av = img.src;
        if (av && /\.(jpg|jpeg|png|gif|webp)$/i.test(av) && !av.includes('_avatar.webp') && !av.includes('default.png') && !av.includes('avatar.png')) {
            var avThumb = av.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '_avatar.webp');
            // BEFORE changing src, keep original in memory and set as onerror
            img.addEventListener('error', function() {
                if (this.dataset.origSrc && this.src !== this.dataset.origSrc) {
                    this.src = this.dataset.origSrc;
                } else if (this.src !== this.dataset.defaultAvatar) {
                    this.src = this.dataset.defaultAvatar;
                }
            }, { once: true });
            img.dataset.origSrc = av;
            img.src = avThumb;
        } else {
            img.addEventListener('error', function () {
                if (this.src !== this.dataset.defaultAvatar) {
                    this.src = this.dataset.defaultAvatar;
                }
            }, { once: true });
        }
    });
});

// ============================================================
// REAL-TIME SIDEBAR BADGES SYSTEM (Messages, Groups, Pages, Chatrooms, Shoutbox, Friends)
// ============================================================
const SIDEBAR_BADGE_CONFIG = {
    chat: {
        desktopId: 'chatNavBadge',
        mobileId: 'chatMobileBadge',
        path: '/chat',
        max: 9,
        displayMax: '9+'
    }
};

const currentSidebarCounts = {
    chat: 0
};

function isCurrentSection(pathPrefix) {
    if (!pathPrefix) return false;
    const cur = window.location.pathname;
    return cur === pathPrefix || cur.indexOf(pathPrefix + '/') === 0;
}

function updateSidebarBadge(section, rawCount) {
    const config = SIDEBAR_BADGE_CONFIG[section];
    if (!config) return;

    // Clear badge if user is currently visiting that section
    if (isCurrentSection(config.path)) {
        currentSidebarCounts[section] = 0;
        const desktop = document.getElementById(config.desktopId);
        if (desktop) desktop.style.display = 'none';
        if (config.mobileId) {
            const mobile = document.getElementById(config.mobileId);
            if (mobile) mobile.style.display = 'none';
        }
        return;
    }

    const count = Math.max(0, parseInt(rawCount) || 0);
    currentSidebarCounts[section] = count;

    const label = count > config.max ? config.displayMax : String(count);
    const desktopEl = document.getElementById(config.desktopId);
    if (desktopEl) {
        if (count > 0) {
            desktopEl.textContent = label;
            desktopEl.style.display = 'inline-flex';
        } else {
            desktopEl.style.display = 'none';
        }
    }

    if (config.mobileId) {
        const mobileEl = document.getElementById(config.mobileId);
        if (mobileEl) {
            if (count > 0) {
                mobileEl.textContent = label;
                mobileEl.style.display = 'flex';
            } else {
                mobileEl.style.display = 'none';
            }
        }
    }
}

function incrementSidebarBadge(section, delta = 1) {
    const config = SIDEBAR_BADGE_CONFIG[section];
    if (!config) return;

    if (isCurrentSection(config.path)) {
        currentSidebarCounts[section] = 0;
        updateSidebarBadge(section, 0);
        return;
    }

    const next = (currentSidebarCounts[section] || 0) + delta;
    updateSidebarBadge(section, next);
}

function applySidebarCounts(countsObj) {
    if (!countsObj) return;
    for (const key of Object.keys(SIDEBAR_BADGE_CONFIG)) {
        if (countsObj[key] !== undefined) {
            updateSidebarBadge(key, countsObj[key]);
        }
    }
}

async function fetchSidebarCounts() {
    if (document.hidden) return;

    try {
        const res = await fetch('/api/sidebar/counts/', { credentials: 'same-origin' });
        const data = await res.json();
        if (data && data.success) {
            applySidebarCounts(data.counts || data);
        }
    } catch (e) {
        /* silent fallback */
    }
}

function handleNotificationSidebarBadge(notification) {
    if (!notification) return;
    const type = String(notification.type || '').toLowerCase();

    // Badges strictly for direct Chat/Messages (general notifications use notification-badge in header)
    if (type === 'message' || type === 'chat_message' || type.startsWith('chat_')) {
        incrementSidebarBadge('chat');
    }
}

// Global hooks for other modules
window.updateSidebarBadge = updateSidebarBadge;
window.incrementSidebarBadge = incrementSidebarBadge;
window.refreshSidebarBadges = fetchSidebarCounts;
window.handleNotificationSidebarBadge = handleNotificationSidebarBadge;
window.applyFriendsBadge = function(pending) {
    updateSidebarBadge('friends', pending);
};
window.updateFriendsBadge = fetchSidebarCounts;

// Cross-module event listeners
window.addEventListener('friendsCountsUpdated', function(e) {
    if (e.detail && e.detail.pending !== undefined) {
        updateSidebarBadge('friends', e.detail.pending);
    }
});

window.addEventListener('chatMessagesRead', function() {
    updateSidebarBadge('chat', 0);
});

window.addEventListener('pageInboxRead', function() {
    updateSidebarBadge('pages', 0);
});

window.addEventListener('groupNotificationsRead', function() {
    updateSidebarBadge('groups', 0);
});

window.addEventListener('chatroomMessagesRead', function() {
    updateSidebarBadge('chatrooms', 0);
});

window.addEventListener('shoutboxMentionsRead', function() {
    updateSidebarBadge('shoutbox', 0);
});

// ===========================================
// NOTIFICATION & SIDEBAR BADGE POLLING
// ===========================================
async function pollNotificationCount() {
    if (document.hidden) return;

    try {
        const r = await fetch('/api/notifications/count/', {
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const d = await r.json();
        if (!d.success) return;

        window.updateBellBadge(d.unread_count);

        if (d.counts) {
            applySidebarCounts(d.counts);
        }
    } catch (e) { /* silent */ }
}
window.refreshNotifications = pollNotificationCount;

document.addEventListener('DOMContentLoaded', function() {
    // Clear badges for whichever section is active on current page
    for (const [section, config] of Object.entries(SIDEBAR_BADGE_CONFIG)) {
        if (isCurrentSection(config.path)) {
            updateSidebarBadge(section, 0);
        }
    }

    // Initial sidebar counts fetch
    fetchSidebarCounts();
    setInterval(fetchSidebarCounts, 30000);

    // Initial notifications poll
    pollNotificationCount();
    setInterval(pollNotificationCount, 20000);

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            pollNotificationCount();
            fetchSidebarCounts();
        }
    });
});


window.requestDesktopNotificationPermission = async function() {
    if (!('Notification' in window)) return 'unsupported';
    try {
        const permission = await Notification.requestPermission();
        console.log('🔔 [FCM] User requested notification permission:', permission);
        return permission;
    } catch (e) {
        console.warn('Permission request error:', e);
        return 'denied';
    }
};
