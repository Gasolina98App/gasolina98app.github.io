// Service Worker de Gasolina98 App
// 1) Notificaciones push (OneSignal)  2) Caché de la "carcasa" de la app
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

var CACHE = 'g98-app-v13';
var SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // La API del Ministerio: siempre red (precios frescos)
  if (url.hostname.indexOf('minetur.gob.es') !== -1) return;
  // La carcasa: caché primero, red como respaldo
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        if (e.request.method === 'GET' && url.origin === location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    }).catch(function () { return caches.match('/index.html'); })
  );
});
