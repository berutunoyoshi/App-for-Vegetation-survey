/* オフライン対応サービスワーカー
   - アプリ本体：事前キャッシュ（更新はバックグラウンドで取得）
   - 地図ライブラリ（jsDelivr）：初回取得後キャッシュ
   - 地理院タイル：表示したタイルをキャッシュ（上限あり）し、圏外でも再表示
   - 標高・住所API：通信時のみ */
const VERSION = 'v1.1.0';
const APP_CACHE = 'vegsurvey-app-' + VERSION;
const LIB_CACHE = 'vegsurvey-lib-v2';
const TILE_CACHE = 'vegsurvey-tiles-v1';
const TILE_LIMIT = 6000;
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES);
    const lib = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map(u => lib.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [APP_CACHE, LIB_CACHE, TILE_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > TILE_LIMIT) for (const k of keys.slice(0, keys.length - TILE_LIMIT)) await c.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 地図タイル：キャッシュ優先
  if (/cyberjapandata\.gsi\.go\.jp\/xyz\//.test(url.href) || url.hostname === 'tile.openstreetmap.org') {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  // ライブラリ：キャッシュ優先
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdn.sheetjs.com') {
    e.respondWith((async () => {
      const c = await caches.open(LIB_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }
  // アプリ本体：キャッシュを返しつつ裏で更新（stale-while-revalidate）
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(APP_CACHE);
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./index.html') : null);
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
  }
});
