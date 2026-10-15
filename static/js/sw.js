// ============================================================
// XAPYX Web Push Service Worker (sw.js)
// Handles native browser push events, background sync & notification clicks.
// ============================================================

self.addEventListener('install', (event) => {
    // Activate immediately on install
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Claim all clients immediately
    event.waitUntil(self.clients.claim());
});

// Push notification received from Web Push / VAPID dispatch
self.addEventListener('push', (event) => {
    let payload = {};
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (err) {
            payload = {
                title: 'XAPYX Notification',
                body: event.data.text()
            };
        }
    }

    const title = payload.title || 'XAPYX Notification';
    const body = payload.body || payload.message || '';
    const icon = payload.icon || '/static/images/icons/icon-192x192.png';
    const badge = payload.badge || '/static/images/icons/icon-192x192.png';
    const tag = payload.tag || 'xapyx-push';
    const targetUrl = (payload.data && (payload.data.url || payload.data.link)) || payload.url || '/feed/';

    const options = {
        body: body,
        icon: icon,
        badge: badge,
        tag: tag,
        data: {
            url: targetUrl,
            tag: tag
        },
        vibrate: [100, 50, 100],
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// Handle notification click: focus existing window or open target URL
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) || '/feed/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus().then(() => {
                        if ('navigate' in client && targetUrl) {
                            return client.navigate(targetUrl);
                        }
                    });
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});