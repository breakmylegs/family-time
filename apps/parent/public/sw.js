// Family time's service worker: alerts only. It caches nothing, so every deploy is live at once.
// Payloads use the Declarative Web Push shape ({ web_push: 8030, notification: { title, body,
// navigate } }). iOS 18.4 and later show those without running this code; everywhere else, this
// reads the same shape. Tapping an alert opens the one screen it is about.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const n = (data && data.notification) || {};
  const title = typeof n.title === 'string' ? n.title : 'Family time';
  const target = safeTarget(n.navigate);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof n.body === 'string' ? n.body : '',
      lang: 'en-GB',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { navigate: target },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.navigate);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) return w.navigate(target).then((c) => (c || w).focus());
      }
      return self.clients.openWindow(target);
    }),
  );
});

/** Only ever a page of this app, so an alert can never open somewhere else. */
function safeTarget(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/', self.location.origin);
    // The whole URL, not a path: a path like //evil.example would be read as another site.
    return url.origin === self.location.origin ? url.href : new URL('/', self.location.origin).href;
  } catch {
    return new URL('/', self.location.origin).href;
  }
}
