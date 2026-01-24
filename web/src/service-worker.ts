/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare let self: ServiceWorkerGlobalScope;

const CACHE_NAME = `tsj-filing-${version}`;

// Archivos a cachear
const ASSETS = [
  ...build,
  ...files
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Manejar solicitudes
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // No cachear solicitudes externas
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        // Devolver cache si existe
        if (cached) {
          // Actualizar cache en segundo plano
          event.waitUntil(
            fetch(event.request)
              .then((response) => {
                if (response.ok) {
                  caches.open(CACHE_NAME)
                    .then((cache) => cache.put(event.request, response));
                }
              })
              .catch(() => {})
          );
          return cached;
        }

        // Hacer solicitud de red
        return fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Respuesta offline para páginas HTML
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/TSJ_Filing_online/') || new Response(
                '<html><body><h1>Sin conexión</h1><p>Por favor, verifica tu conexión a internet.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            }
            throw new Error('Network error');
          });
      })
  );
});

// Manejar notificaciones push
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};

  const options: NotificationOptions = {
    body: data.body || 'Nueva notificación',
    icon: '/TSJ_Filing_online/icon-192.png',
    badge: '/TSJ_Filing_online/icon-192.png',
    tag: data.tag || 'tsj-notification',
    requireInteraction: data.requireInteraction || false,
    data: data.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'TSJ Filing', options)
  );
});

// Manejar clic en notificaciones
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/TSJ_Filing_online/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Buscar ventana existente
        for (const client of clients) {
          if (client.url.includes('/TSJ_Filing_online') && 'focus' in client) {
            return client.focus();
          }
        }
        // Abrir nueva ventana
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

// Sincronización en segundo plano
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-expedientes') {
    event.waitUntil(syncExpedientes());
  }
});

async function syncExpedientes() {
  // Implementar sincronización cuando sea necesario
  console.log('[SW] Sincronizando expedientes...');
}

console.log('[SW] Service Worker cargado - versión:', version);
