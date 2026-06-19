/**
 * sw.js — Phase 7: Service Worker
 * Provides full offline capability by pre-caching all static assets
 * on install, then serving them from cache first on subsequent loads.
 *
 * Cache strategy:
 *  • Install:  pre-cache shell HTML, JS modules, JSON data files,
 *              and CDN assets (Tailwind, FontAwesome, Google Fonts).
 *  • Fetch:    Cache-first for everything in STATIC_ASSETS;
 *              Network-first for anything else (future API calls, etc.).
 *  • Activate: Delete all old caches so stale assets never linger.
 *
 * To bust the cache after an update, increment CACHE_VERSION below.
 */

const CACHE_VERSION  = 'mext-v3';
const CACHE_STATIC   = `${CACHE_VERSION}-static`;

/**
 * Everything the app needs to run fully offline.
 * Update this list if you add new JS modules or data files.
 */
const STATIC_ASSETS = [
  // App shell
  './',
  './index.html',

  // JS modules
  './js/main.js',
  './js/state.js',
  './js/timer.js',
  './js/analytics.js',
  './js/loader.js',
  './js/quiz.js',
  './js/godspeed.js',
  './js/srs.js',

  // Question data
  './data/english.json',
  './data/japanese.json',

  // CDN — Tailwind (runtime CDN build used by this project)
  'https://cdn.tailwindcss.com',

  // CDN — Font Awesome
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',

  // CDN — Google Fonts (pre-rendered CSS + the two variable fonts)
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap',
];

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(async cache => {
      // Cache assets individually so one CDN miss doesn't abort everything.
      await Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Failed to pre-cache ${url}:`, err)
          )
        )
      );
    })
  );
  // Activate immediately — don't wait for existing tabs to close.
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC)
          .map(key => caches.delete(key))
      )
    )
  );
  // Take control of all open tabs immediately.
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  // Only handle GET requests.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;                // Cache hit — serve instantly.

      // Cache miss — fetch from network, then cache the response.
      return fetch(event.request)
        .then(response => {
          // Only cache valid responses (not opaque 0-status CDN failures).
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          const toCache = response.clone();
          caches.open(CACHE_STATIC).then(cache => {
            cache.put(event.request, toCache);
          });

          return response;
        })
        .catch(() => {
          // Offline and not cached — for navigation requests return the shell.
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // For other assets, just fail gracefully.
          return new Response('Offline', { status: 503 });
        });
    })
  );
});
