// Service Worker für die PWA. In SvelteKit 3 ersetzt durch $app/manifest ($service-worker ist entfernt):
// `immutable`/`assets` liefern die zu cachenden Dateien, `version` aus $app/env für den Cache-Namen.
// /api, /ws, /mailpit, /tiles werden nie gecacht (Network-only). Navigationen laufen Network-first
// (frische index.html nach jedem Update) und fallen nur offline auf die gecachte Shell zurück.
// Ein neuer Service Worker übernimmt sofort (skipWaiting), statt auf das Schließen aller Tabs zu warten.
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
			await self.skipWaiting();
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
		// Network-first: frische Shell vom Server, offline Fallback auf die gecachte index.html.
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				try {
					const response = await fetch(request, { cache: 'no-cache' });
					if (response.ok) void cache.put('/', response.clone());
					return response;
				} catch {
					return (await cache.match('/')) ?? Response.error();
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
