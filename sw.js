/* Gør Ruteplanlæggeren installerbar som app. Altid nyeste version fra nettet først;
   den gemte kopi bruges kun, hvis der ikke er net. Adresse- og ruteopslag går aldrig gennem cachen. */
const CACHE = 'ruteplan-3.0.1';
// Ny version tager over, når alle vinduer med programmet har været lukket (ingen udskiftning midt i en beregning).
// Siden selv hentes altid fra nettet først, så indholdet er nyt alligevel.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
