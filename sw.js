// Service Worker de Gasolina98 App
// 1) Notificaciones push (OneSignal)  2) Caché de la "carcasa" de la app
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

var CACHE = 'g98-app-v40';
var SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
// Datos que cambian a diario: siempre red primero, la copia solo sin conexión
var DATOS = ['/estaciones.json', '/precio-medio.json'];
// Si la red tarda más que esto al abrir la app, se enseña la copia guardada
var ESPERA_RED_MS = 4000;

self.addEventListener('install', function (e) {
  // cache:'reload' salta la caché HTTP del navegador para guardar la versión recién publicada
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

function guardar(req, res) {
  if (res && res.ok) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
  }
  return res;
}

// Red primero; si falla (o tarda más de "espera" ms y hay copia), la copia guardada
function redPrimero(req, claveCache, espera) {
  var red = fetch(req).then(function (res) { return guardar(claveCache, res); });
  var copia = function () { return caches.match(claveCache, { ignoreSearch: true }); };
  if (!espera) {
    return red.catch(function () { return copia(); });
  }
  return new Promise(function (resolve, reject) {
    var hecho = false;
    var t = setTimeout(function () {
      copia().then(function (hit) { if (hit && !hecho) { hecho = true; resolve(hit); } });
    }, espera);
    red.then(function (res) {
      clearTimeout(t);
      if (!hecho) { hecho = true; resolve(res); }
    }).catch(function () {
      clearTimeout(t);
      copia().then(function (hit) {
        if (hecho) return;
        hecho = true;
        if (hit) resolve(hit); else reject(new Error('sin red ni copia'));
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // Todo lo de fuera (API del Ministerio, callejero, Leaflet, OneSignal, AdSense, GA4): directo a la red
  if (url.origin !== location.origin) return;

  // Abrir la app: red primero para ver siempre la última versión publicada
  // (otras páginas propias, como futuras fichas estáticas, se guardan con su propia ruta)
  if (e.request.mode === 'navigate') {
    var esInicio = url.pathname === '/' || url.pathname === '/index.html';
    e.respondWith(redPrimero(e.request, esInicio ? '/index.html' : url.pathname, ESPERA_RED_MS));
    return;
  }
  // Precios y estaciones del día: red primero (revalidando la caché HTTP)
  if (DATOS.indexOf(url.pathname) !== -1) {
    e.respondWith(redPrimero(new Request(e.request, { cache: 'no-cache' }), url.pathname));
    return;
  }
  // Iconos, manifest y demás estáticos propios: caché primero, red como respaldo
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) { return guardar(e.request, res); });
    })
  );
});
