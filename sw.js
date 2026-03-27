const CACHE_NAME = 'recordtap-v24';
const ASSETS = [
    '/',
    '/index.html',
    '/css/style.css?v=24',
    '/js/audio.js?v=24',
    '/js/beatmap.js?v=24',
    '/js/singer.js?v=24',
    '/js/catalogue.js?v=24',
    '/js/game.js?v=24',
    '/js/screens.js?v=24',
    '/js/app.js?v=24',
    '/manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Network-first for everything — always get fresh files, fall back to cache offline
    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
