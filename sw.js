// Service worker minimal : rend le jeu installable et garde l'interface
// disponible si le réseau hésite. Toujours le réseau d'abord, pour recevoir les mises à jour.
var CACHE = 'soiree-canape-v13';
var SHELL = ['./', 'index.html', 'style.css?v=13', 'app.js?v=13', 'engine.js?v=13', 'questions.js?v=13', 'vendor/supabase.js?v=13', 'vendor/qrcode.js?v=13', 'vendor/legacy.js?v=13', 'vendor/gapfix.js?v=13', 'icon-192.png', 'die.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
