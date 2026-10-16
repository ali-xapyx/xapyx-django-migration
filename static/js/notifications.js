/**
 * XAPYX Web Push Notifications Client
 * Handles service worker registration, push notification permission requests,
 * and VAPID push subscription syncing with the Django backend.
 */
(function() {
    'use strict';

    function getCsrfToken() {
        const cookie = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('csrftoken='));
        return cookie ? decodeURIComponent(cookie.split('=')[1]) : '';
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    async function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            console.warn('[WebPush] Service workers not supported.');
            return null;
        }
        try {
            const reg = await navigator.serviceWorker.register('/static/js/firebase-messaging-sw.js');
            console.log('Firebase Messaging Service Worker registered with scope:', reg.scope);
            if (typeof firebase !== 'undefined' && firebase.messaging) {
                const messaging = firebase.messaging();
                messaging.useServiceWorker(reg);
            }
            return reg;
        } catch (err) {
            console.warn('⚠️ [WebPush] Service Worker registration failed:', err);
            return null;
        }
    }

    async function subscribeToPush(registration) {
        if (!registration) {
            registration = await navigator.serviceWorker.ready;
        }
        if (!registration || !registration.pushManager) {
            console.warn('[WebPush] Push manager not available.');
            return null;
        }

        try {
            // Fetch VAPID public key
            const res = await fetch('/api/save-push-subscription/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const data = await res.json();
            if (!data.success || !data.public_key) {
                console.warn('[WebPush] Failed to retrieve VAPID public key:', data);
                return null;
            }

            const appKey = urlBase64ToUint8Array(data.public_key);
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: appKey
                });
            }

            // Sync with backend endpoint
            const saveRes = await fetch('/api/save-push-subscription/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(subscription.toJSON())
            });
            const saveResult = await saveRes.json();
            if (saveResult.success) {
                console.log('✅ [WebPush] Subscription saved on backend.');
            }
            return subscription;
        } catch (err) {
            console.warn('⚠️ [WebPush] Subscription error:', err);
            return null;
        }
    }

    async function requestPushPermission() {
        if (!('Notification' in window)) {
            alert('This browser does not support desktop notifications.');
            return false;
        }
        try {
            const perm = await Notification.requestPermission();
            console.log('🔔 [WebPush] Permission status:', perm);
            if (perm === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                await subscribeToPush(reg);
                return true;
            }
            return false;
        } catch (err) {
            console.warn('⚠️ [WebPush] Permission request error:', err);
            return false;
        }
    }

    // Auto-init on load if permission is already granted
    async function initWebPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const reg = await registerServiceWorker();
        if (reg && 'Notification' in window && Notification.permission === 'granted') {
            await subscribeToPush(reg);
        }
    }

    window.WebPush = {
        init: initWebPush,
        register: registerServiceWorker,
        subscribe: subscribeToPush,
        requestPermission: requestPushPermission,
        urlBase64ToUint8Array: urlBase64ToUint8Array
    };

    window.requestPushNotifications = requestPushPermission;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWebPush);
    } else {
        initWebPush();
    }
})();