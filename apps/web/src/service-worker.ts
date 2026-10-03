// Service Worker für die PWA. In SvelteKit 3 ersetzt durch $app/manifest ($service-worker ist entfernt):
// `immutable`/`assets` liefern die zu cachenden Dateien, `version` aus $app/env für den Cache-Namen.
// /api, /ws, /mailpit, /tiles werden nie gecacht (Network-only); Navigationen fallen auf index.html
// zurück (Cache-first), damit die SPA auch offline startet.
/// <reference lib="webworker" />
import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';
import { self } from '$app/service-worker';

const CACHE_NAME = `bahn-tracker-${version}`;
const NEVER_CACHE_PREFIXES = ['/api', '/ws', '/mailpit', '/tiles'];

const PRECACHE_PATHS = ['/', ...immutable.map((f) => f.path), ...assets.map((f) => f.path)];

function isNeverCached(pathname: string): boolean {
	return NEVER_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(PRECACHE_PATHS);
		})(),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;
	if (isNeverCached(url.pathname)) return; // Network-only, nie cachen.

	if (request.mode === 'navigate') {
		// Cache-first: SPA-Shell sofort aus dem Cache, Fallback auf index.html für alle Routen.
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				const cached = (await cache.match(request)) ?? (await cache.match('/'));
				if (cached) return cached;
				try {
					return await fetch(request);
				} catch {
					return Response.error();
				}
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			const cached = await cache.match(request);
			if (cached) return cached;
			const response = await fetch(request);
			if (response.ok && PRECACHE_PATHS.includes(url.pathname)) {
				void cache.put(request, response.clone());
			}
			return response;
		})(),
	);
});
