<script lang="ts">
	// Einklappbare Live-Karte im Fahrt-Modus. Standardmäßig eingeklappt (Zustand in localStorage),
	// die MapLibre-Karte (und damit der erste Kachel-Request) wird erst beim ersten Aufklappen
	// erzeugt, damit auf schlechtem Netz nicht ungefragt Kacheln geladen werden.
	import { onDestroy } from 'svelte';
	import { cellToBoundary } from 'h3-js';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { CellRow } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { createBaseStyle, DEFAULT_CENTER, DEFAULT_ZOOM, ensurePmtilesProtocol } from '#lib/map/basemap.js';
	import { FULL_LOSS_COLOR, FULL_LOSS_STROKE, rttColorExpression } from '#lib/map/colors.js';
	import { mapPrefs, speedtestVisibility } from '#lib/map/prefs.svelte.js';
	import { tracker } from '#lib/tracker/tracker.svelte.js';
	import { i18n } from '#lib/i18n.svelte.js';

	const STORAGE_KEY = 'bahn-tracker:mapExpanded';
	const MINE_DEBOUNCE_MS = 400;

	const de = {
		map: 'Karte',
		follow: 'Folgen',
		previousMeasurements: 'Frühere Messungen',
		speedtests: 'Speedtests',
		mineLoadError: 'Frühere Messungen konnten nicht geladen werden',
	};
	const en: typeof de = {
		map: 'Map',
		follow: 'Follow',
		previousMeasurements: 'Previous measurements',
		speedtests: 'Speed tests',
		mineLoadError: 'Previous measurements could not be loaded',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	let expanded = $state(readExpandedStorage());
	let follow = $state(true);
	let showMine = $state(false);
	let mineLoadError = $state<string | null>(null);

	let container: HTMLDivElement | undefined = $state(undefined);
	let map: maplibregl.Map | null = null;
	let created = false;
	let mineDebounce: ReturnType<typeof setTimeout> | null = null;
	let markerEl: HTMLDivElement | undefined;
	let marker: maplibregl.Marker | null = null;

	function readExpandedStorage(): boolean {
		try {
			return localStorage.getItem(STORAGE_KEY) === '1';
		} catch {
			return false;
		}
	}

	function writeExpandedStorage(value: boolean): void {
		try {
			localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
		} catch {
			// z.B. privater Modus ohne Storage-Zugriff – egal, nur Komfortfunktion.
		}
	}

	function toggleExpanded(): void {
		expanded = !expanded;
		writeExpandedStorage(expanded);
	}

	function toggleFullscreen(): void {
		if (!container) return;
		if (document.fullscreenElement) void document.exitFullscreen();
		else void container.requestFullscreen().catch(() => {});
	}

	function pointGeoJson() {
		const pts = tracker.tripSamples.filter((s) => s.lat !== null && s.lon !== null);
		return {
			type: 'FeatureCollection' as const,
			features: pts.map((s) => ({
				type: 'Feature' as const,
				properties: {
					id: s.id,
					rtt: s.rttMedian,
					kind: s.kind,
					fullLoss: s.n !== null && s.n > 0 && s.lost === s.n,
				},
				geometry: { type: 'Point' as const, coordinates: [s.lon as number, s.lat as number] },
			})),
		};
	}

	function mineGeoJson(rows: CellRow[]) {
		return {
			type: 'FeatureCollection' as const,
			features: rows.map(([h3]) => {
				const boundary = cellToBoundary(h3, true);
				return {
					type: 'Feature' as const,
					properties: {},
					geometry: { type: 'Polygon' as const, coordinates: [[...boundary, boundary[0]]] },
				};
			}),
		};
	}

	function updatePoints(): void {
		const source = map?.getSource('track-points');
		if (source && source.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(pointGeoJson());
	}

	async function fetchMineCells(): Promise<void> {
		if (!map || !showMine) return;
		const b = map.getBounds();
		try {
			const res = await api.publicCells({
				res: 8,
				bbox: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
				net: 'all',
				period: 'all',
				train: 'all',
				mine: true,
			});
			mineLoadError = null;
			const source = map?.getSource('mine-cells');
			if (source && source.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(mineGeoJson(res.cells));
		} catch (err) {
			mineLoadError = err instanceof ApiError ? (err.detail ?? err.title) : m.mineLoadError;
		}
	}

	function scheduleMineFetch(): void {
		if (mineDebounce) clearTimeout(mineDebounce);
		mineDebounce = setTimeout(() => void fetchMineCells(), MINE_DEBOUNCE_MS);
	}

	function setupMap(): void {
		if (!container || created) return;
		created = true;
		ensurePmtilesProtocol();
		const m = new maplibregl.Map({
			container,
			center: DEFAULT_CENTER,
			zoom: DEFAULT_ZOOM,
			style: createBaseStyle(
				{
					'track-points': { type: 'geojson', data: pointGeoJson() },
					'mine-cells': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
				},
				[
					{
						id: 'mine-cells-fill',
						type: 'fill',
						source: 'mine-cells',
						paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.25 },
					},
					{
						id: 'mine-cells-outline',
						type: 'line',
						source: 'mine-cells',
						paint: { 'line-color': '#38bdf8', 'line-opacity': 0.4, 'line-width': 0.5 },
					},
					{
						id: 'track-points',
						type: 'circle',
						source: 'track-points',
						filter: ['!=', ['get', 'kind'], 'speedtest'],
						paint: {
							'circle-radius': 4,
							'circle-color': ['case', ['get', 'fullLoss'], FULL_LOSS_COLOR, rttColorExpression('rtt')],
							'circle-stroke-color': ['case', ['get', 'fullLoss'], FULL_LOSS_STROKE, '#0b0d10'],
							'circle-stroke-width': ['case', ['get', 'fullLoss'], 1.5, 0.5],
						},
					},
					{
						id: 'track-points-speedtest',
						type: 'circle',
						source: 'track-points',
						filter: ['==', ['get', 'kind'], 'speedtest'],
						layout: { visibility: speedtestVisibility() },
						paint: {
							'circle-radius': 8,
							'circle-color': '#38bdf8',
							'circle-stroke-color': '#0b0d10',
							'circle-stroke-width': 1.5,
						},
					},
				],
			),
		});
		map = m;

		markerEl = document.createElement('div');
		markerEl.className = 'track-map__position';
		markerEl.innerHTML = '<div class="track-map__accuracy"></div><div class="track-map__arrow"></div>';
		marker = new maplibregl.Marker({ element: markerEl, rotationAlignment: 'map' });

		m.on('load', () => {
			updatePosition();
			if (tracker.geo.lat !== null && tracker.geo.lon !== null) {
				m.jumpTo({ center: [tracker.geo.lon, tracker.geo.lat] });
			}
		});
		m.on('dragstart', () => (follow = false));
		m.on('moveend', () => {
			if (showMine) scheduleMineFetch();
		});
	}

	/** Accuracy-Kreis in Pixel umrechnen (Mercator-Näherung bei aktueller Breite/Zoom). */
	function accuracyPx(accuracyM: number, lat: number, zoom: number): number {
		const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
		return Math.max(6, Math.min(120, accuracyM / metersPerPixel));
	}

	function updatePosition(): void {
		if (!map || !marker) return;
		const { lat, lon, heading, accuracyM } = tracker.geo;
		if (lat === null || lon === null) {
			marker.remove();
			return;
		}
		marker.setLngLat([lon, lat]);
		if (heading !== null) marker.setRotation(heading);
		if (markerEl) {
			const circle = markerEl.querySelector<HTMLDivElement>('.track-map__accuracy');
			if (circle) {
				const px = accuracyM !== null ? accuracyPx(accuracyM, lat, map.getZoom()) : 14;
				circle.style.width = `${px * 2}px`;
				circle.style.height = `${px * 2}px`;
			}
		}
		if (!marker.getElement().isConnected) marker.addTo(map);
		if (follow) map.easeTo({ center: [lon, lat], duration: 400 });
	}

	// Beim ersten Aufklappen die Karte erzeugen (lazy, siehe Modulkommentar).
	$effect(() => {
		if (expanded && container && !created) setupMap();
	});

	// Container nach Größenänderung (eingeklappt -> ausgeklappt) neu vermessen.
	$effect(() => {
		if (expanded && map) {
			requestAnimationFrame(() => map?.resize());
		}
	});

	// Neue Samples -> Punkte aktualisieren.
	$effect(() => {
		void tracker.tripSamples.length;
		if (created) updatePoints();
	});

	// Positionsänderung -> Marker/Folgen aktualisieren.
	$effect(() => {
		void tracker.geo.lat;
		void tracker.geo.lon;
		void tracker.geo.heading;
		void tracker.geo.accuracyM;
		if (created) updatePosition();
	});

	// Speedtests an/aus -> nur die Sichtbarkeit des Layers umschalten.
	$effect(() => {
		const visibility = speedtestVisibility();
		if (created && map?.getLayer('track-points-speedtest')) map.setLayoutProperty('track-points-speedtest', 'visibility', visibility);
	});

	// „Frühere Messungen“ an/aus -> sofort (neu) laden bzw. ausblenden.
	$effect(() => {
		if (!created) return;
		if (showMine) void fetchMineCells();
		else {
			const source = map?.getSource('mine-cells');
			if (source && source.type === 'geojson') (source as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
		}
	});

	onDestroy(() => {
		if (mineDebounce) clearTimeout(mineDebounce);
		map?.remove();
		map = null;
	});
</script>

<div class="card track-map">
	<button class="track-map__toggle" onclick={toggleExpanded} aria-expanded={expanded}>
		<span>{m.map}</span>
		<span>{expanded ? '▾' : '▸'}</span>
	</button>

	{#if expanded}
		<div class="track-map__controls">
			<label>
				<input type="checkbox" bind:checked={follow} style="width: auto; min-height: auto" />
				{m.follow}
			</label>
			<label>
				<input type="checkbox" bind:checked={showMine} style="width: auto; min-height: auto" />
				{m.previousMeasurements}
			</label>
			<label>
				<input
					type="checkbox"
					checked={mapPrefs.showSpeedtests}
					onchange={(e) => mapPrefs.setShowSpeedtests(e.currentTarget.checked)}
					style="width: auto; min-height: auto"
				/>
				{m.speedtests}
			</label>
			<button type="button" class="btn secondary" style="padding: 0.3rem 0.7rem" onclick={toggleFullscreen}>⛶</button>
		</div>
		{#if mineLoadError}
			<div class="notice error" style="margin: 0.5rem 0 0">{mineLoadError}</div>
		{/if}
	{/if}

	<div bind:this={container} class="track-map__container" class:track-map__container--hidden={!expanded}></div>
</div>

<style>
	.track-map {
		padding: 0;
		overflow: hidden;
	}

	.track-map__toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		padding: 0.8rem 1rem;
		cursor: pointer;
	}

	.track-map__controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0 1rem 0.6rem;
		font-size: 0.9rem;
	}

	.track-map__controls label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.track-map__container {
		width: 100%;
		height: 45vh;
		min-height: 280px;
	}

	.track-map__container--hidden {
		height: 0;
		min-height: 0;
	}

	:global(.track-map__position) {
		width: 0;
		height: 0;
		position: relative;
	}

	:global(.track-map__accuracy) {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		background: rgba(56, 189, 248, 0.2);
		border: 1px solid rgba(56, 189, 248, 0.5);
	}

	:global(.track-map__arrow) {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 14px;
		height: 14px;
		transform: translate(-50%, -50%);
		background: #38bdf8;
		border: 2px solid #0b0d10;
		border-radius: 50%;
		box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.4);
	}
</style>
