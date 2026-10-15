// Firebase Cloud Messaging (FCM) Service Worker
// Provides native desktop push notifications for background messages.

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyDYX3xZ_S_0TSCumdAl3b3u5LmI1hzPJ4Q",
    authDomain: "xapyx-notifications.firebaseapp.com",
    databaseURL: "https://xapyx-notifications-default-rtdb.firebaseio.com",
    projectId: "xapyx-notifications",
    storageBucket: "xapyx-notifications.firebasestorage.app",
    messagingSenderId: "151754965872",
    appId: "1:151754965872:web:8512a599c72f1c5640c5b5"
};

// Initialize Firebase if not already initialized
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// Handle background messages received while the app is closed or in background
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);

    const title = (payload.notification && payload.notification.title) ||
                  (payload.data && payload.data.title) ||
                  'XAPYX Notification';
    const body = (payload.notification && payload.notification.body) ||
                 (payload.data && payload.data.body) ||
                 (payload.data && payload.data.message) ||
                 '';
    const icon = (payload.notification && payload.notification.icon) ||
                 '/static/images/logo.png';

    const notificationOptions = {
        body: body,
        icon: icon,
        badge: '/static/images/icons/icon-192x192.png',
        data: payload.data || {}
    };

    return self.registration.showNotification(title, notificationOptions);
});

// Handle notification click: focus existing window or open new window to target link
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = (event.notification.data && (event.notification.data.url || event.notification.data.link)) || '/feed/';

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