<script lang="ts">
	// Live-Karte auf der Startseite ("Jetzt unterwegs"): zeigt die anonymisierten Live-Züge aus
	// `GET /api/public/live`. Besucher-Einstellung (an/aus) in localStorage, Standard an. Die Karte
	// (und damit der erste Kachel-/API-Request) wird erst erzeugt, wenn der Abschnitt sichtbar ist
	// (IntersectionObserver) UND die Einstellung an ist.
	import { onDestroy, onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { ICE_STATE_LABELS, NET_CLASS_LABELS, type LiveTrain } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { createBaseStyle, DEFAULT_CENTER, DEFAULT_ZOOM, ensurePmtilesProtocol } from '#lib/map/basemap.js';
	import { rttColorExpression } from '#lib/map/colors.js';

	const STORAGE_KEY = 'bahn-tracker:liveMapEnabled';
	const POLL_MS = 15_000;

	function readEnabled(): boolean {
		try {
			const v = localStorage.getItem(STORAGE_KEY);
			return v === null ? true : v === '1';
		} catch {
			return true;
		}
	}

	function writeEnabled(value: boolean): void {
		try {
			localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
		} catch {
			// privater Modus o.ä. – egal, nur Komfortfunktion
		}
	}

	let enabled = $state(readEnabled());
	let sectionVisible = $state(false);
	let sectionEl: HTMLDivElement | undefined = $state(undefined);
	let mapContainer: HTMLDivElement | undefined = $state(undefined);

	let activeTrips = $state<number | null>(null);
	let trains = $state<LiveTrain[]>([]);
	let loadError = $state<string | null>(null);

	let map: maplibregl.Map | null = null;
	let popup: maplibregl.Popup | null = null;
	let created = false;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let observer: IntersectionObserver | null = null;

	function toggleEnabled(): void {
		enabled = !enabled;
		writeEnabled(enabled);
	}

	/** Durchschnittliche RTT über alle Netze eines Zugs, für die Einfärbung des Kreises. */
	function repRtt(train: LiveTrain): number | null {
		const values = train.nets.map((n) => n.rttMedian).filter((v): v is number => v !== null);
		return values.length > 0 ? values.reduce((a, v) => a + v, 0) / values.length : null;
	}

	function trainsGeoJson() {
		return {
			type: 'FeatureCollection' as const,
			features: trains.map((t) => ({
				type: 'Feature' as const,
				properties: {
					key: t.key,
					label: t.label,
					speedKmh: t.speedKmh,
					trackers: t.trackers,
					rtt: repRtt(t),
					nets: t.nets,
					iceState: t.iceState,
					lastSeenSec: t.lastSeenSec,
				},
				geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] },
			})),
		};
	}

	function updateTrains(): void {
		const source = map?.getSource('live-trains');
		if (source && source.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(trainsGeoJson());
	}

	async function load(): Promise<void> {
		try {
			const res = await api.publicLive();
			activeTrips = res.activeTrips;
			trains = res.trains;
			loadError = null;
			if (created) updateTrains();
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : 'Live-Fahrten konnten nicht geladen werden';
		}
	}

	function startPolling(): void {
		if (pollTimer) return;
		pollTimer = setInterval(() => {
			if (document.visibilityState === 'visible') void load();
		}, POLL_MS);
		document.addEventListener('visibilitychange', handleVisibilityChange);
	}

	function stopPolling(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	}

	function handleVisibilityChange(): void {
		if (document.visibilityState === 'visible') void load();
	}

	function popupHtml(p: Record<string, unknown>): string {
		const nets = (p.nets as LiveTrain['nets']) ?? [];
		const netLines = nets
			.map(
				(n) =>
					`${NET_CLASS_LABELS[n.netClass]}: RTT ${n.rttMedian !== null ? n.rttMedian.toFixed(0) : '–'} ms, Verlust ${
						n.lossPct !== null ? n.lossPct.toFixed(0) : '–'
					} %`,
			)
			.join('<br />');
		const iceState = p.iceState as string | null;
		return `
			<strong>${p.label}</strong><br />
			Geschwindigkeit: ${p.speedKmh !== null && p.speedKmh !== undefined ? Number(p.speedKmh).toFixed(0) : '–'} km/h<br />
			${netLines}
			${netLines ? '<br />' : ''}
			ICE-Status: ${iceState ? ICE_STATE_LABELS[iceState] ?? iceState : '–'}<br />
			vor ${p.lastSeenSec} s
		`;
	}

	function setupMap(): void {
		if (!mapContainer || created) return;
		created = true;
		ensurePmtilesProtocol();
		const m = new maplibregl.Map({
			container: mapContainer,
			center: DEFAULT_CENTER,
			zoom: DEFAULT_ZOOM,
			style: createBaseStyle(
				{ 'live-trains': { type: 'geojson', data: trainsGeoJson() } },
				[
					{
						id: 'live-trains-circle',
						type: 'circle',
						source: 'live-trains',
						paint: {
							'circle-radius': ['interpolate', ['linear'], ['get', 'trackers'], 1, 7, 10, 18],
							'circle-color': rttColorExpression('rtt'),
							'circle-stroke-color': '#0b0d10',
							'circle-stroke-width': 1.5,
							'circle-opacity': 0.85,
						},
					},
					{
						id: 'live-trains-label',
						type: 'symbol',
						source: 'live-trains',
						minzoom: 7,
						layout: {
							'text-field': ['get', 'label'],
							'text-size': 12,
							'text-offset': [0, 1.4],
							'text-anchor': 'top',
						},
						paint: { 'text-color': '#e8eaed', 'text-halo-color': '#0b0d10', 'text-halo-width': 1.2 },
					},
				],
			),
		});
		map = m;
		m.on('click', 'live-trains-circle', (e) => {
			const f = e.features?.[0];
			if (!f) return;
			popup?.remove();
			popup = new maplibregl.Popup().setLngLat(e.lngLat).setHTML(popupHtml(f.properties as Record<string, unknown>)).addTo(m);
		});
		m.on('mouseenter', 'live-trains-circle', () => (m.getCanvas().style.cursor = 'pointer'));
		m.on('mouseleave', 'live-trains-circle', () => (m.getCanvas().style.cursor = ''));
	}

	function teardownMap(): void {
		stopPolling();
		popup?.remove();
		popup = null;
		map?.remove();
		map = null;
		created = false;
	}

	onMount(() => {
		if (!sectionEl) return;
		observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					sectionVisible = true;
					observer?.disconnect();
				}
			},
			{ rootMargin: '100px' },
		);
		observer.observe(sectionEl);
	});

	// Karte erst aufbauen, wenn sichtbar UND die Einstellung "Live-Fahrten anzeigen" an ist.
	$effect(() => {
		if (enabled && sectionVisible && mapContainer && !created) {
			setupMap();
			void load();
			startPolling();
		}
	});

	// Einstellung ausgeschaltet -> Karte/Polling wieder abbauen, keine weiteren Requests.
	$effect(() => {
		if (!enabled && created) teardownMap();
	});

	onDestroy(() => {
		observer?.disconnect();
		teardownMap();
	});
</script>

<div class="card live-map" bind:this={sectionEl}>
	<div class="live-map__header">
		<h2>Jetzt unterwegs</h2>
		<label class="live-map__toggle">
			<input type="checkbox" checked={enabled} onchange={toggleEnabled} style="width: auto; min-height: auto" />
			Live-Fahrten anzeigen
		</label>
	</div>

	{#if enabled}
		<p class="live-map__count">
			{#if activeTrips === null && !loadError}
				Lade…
			{:else}
				{activeTrips ?? 0} Fahrt{activeTrips === 1 ? '' : 'en'} aktiv
			{/if}
		</p>

		{#if loadError}
			<div class="notice error">{loadError}</div>
		{/if}

		<div bind:this={mapContainer} class="live-map__container"></div>

		{#if activeTrips !== null && trains.length === 0 && !loadError}
			<p class="live-map__empty">
				Gerade fährt niemand mit eingeschalteter Live-Ansicht – oder alle Fahrten sind noch zu neu
				für eine Position. Schau später wieder vorbei.
			</p>
		{/if}
	{:else}
		<p class="live-map__empty">Live-Karte ist ausgeblendet.</p>
	{/if}
</div>

<style>
	.live-map__header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.live-map__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		color: var(--fg-dim);
	}

	.live-map__count {
		margin: 0.2rem 0 0.6rem;
		font-size: 0.9rem;
		color: var(--fg-dim);
	}

	.live-map__container {
		width: 100%;
		height: 50vh;
		min-height: 280px;
		max-height: 480px;
		border-radius: var(--radius);
		overflow: hidden;
	}

	.live-map__empty {
		margin-top: 0.6rem;
		color: var(--fg-dim);
	}
</style>
