<script lang="ts">
	// Öffentliche Karte: MapLibre + PMTiles-Basemap (Protomaps) + H3-Zellen aus /api/public/cells.
	import { onDestroy, onMount } from 'svelte';
	import { cellToBoundary } from 'h3-js';
	import maplibregl, { type ExpressionSpecification } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { createBaseStyle, DEFAULT_CENTER, DEFAULT_ZOOM, ensurePmtilesProtocol } from '#lib/map/basemap.js';
	import { RTT_LEGEND, rttColorExpression } from '#lib/map/colors.js';
	import { attachHoverPopup } from '#lib/map/hover-popup.js';
	import {
		METRICS,
		NET_CLASSES,
		PERIODS,
		Period,
		TRAIN_TYPES,
		type CellRow,
		type Metric,
		type NetClass,
		type TrainType,
	} from '@bahn/shared';
	import type { z } from 'zod';

	type PeriodValue = z.infer<typeof Period>;
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import { fmtNumber, i18n, netClassLabel, trainTypeLabel } from '#lib/i18n.svelte.js';

	const de = {
		title: 'Karte',
		metricLabels: {
			rtt: 'Latenz (Median)',
			loss: 'Verlust',
			avail: 'Verfügbarkeit',
			down: 'Download',
			up: 'Upload',
		} as Record<Metric, string>,
		metric: 'Metrik',
		net: 'Netz',
		period: 'Zeitraum',
		train: 'Zugtyp',
		all: 'alle',
		periodAll: 'gesamt',
		periodDays: (d: string) => `${d} Tage`,
		mineOnly: 'nur meine Fahrten',
		loadError: 'Zellen konnten nicht geladen werden',
		noCells: 'Für diesen Ausschnitt/Filter liegen noch keine Zellen vor.',
		legend: 'Legende',
		popup: {
			trips: (n: number | string) => `${n} Fahrten`,
			samples: (n: number | string) => `${n} Messungen`,
			rtt: 'Latenz (Median)',
			loss: 'Verlust',
			avail: 'Verfügbarkeit',
			down: 'Download',
			up: 'Upload',
			dash: '–',
		},
	};
	const en: typeof de = {
		title: 'Map',
		metricLabels: {
			rtt: 'Latency (median)',
			loss: 'Loss',
			avail: 'Availability',
			down: 'Download',
			up: 'Upload',
		},
		metric: 'Metric',
		net: 'Network',
		period: 'Period',
		train: 'Train type',
		all: 'all',
		periodAll: 'all time',
		periodDays: (d: string) => `${d} days`,
		mineOnly: 'my rides only',
		loadError: 'Cells could not be loaded',
		noCells: 'No cells available yet for this view/filter.',
		legend: 'Legend',
		popup: {
			trips: (n: number | string) => `${n} trips`,
			samples: (n: number | string) => `${n} samples`,
			rtt: 'Latency (median)',
			loss: 'Loss',
			avail: 'Availability',
			down: 'Download',
			up: 'Upload',
			dash: '–',
		},
	};
	// Eigener Name "t" statt des üblichen "m", da im Skript bereits lokale Variablen "m" (MapLibre-Instanz)
	// und Schleifenvariablen "m" (METRICS) existieren.
	const t = $derived(i18n.locale === 'de' ? de : en);

	const LEGEND: Record<Metric, { color: string; label: string }[]> = {
		rtt: RTT_LEGEND,
		loss: [
			{ color: '#22c55e', label: '< 1 %' },
			{ color: '#eab308', label: '< 5 %' },
			{ color: '#f97316', label: '< 15 %' },
			{ color: '#ef4444', label: '≥ 15 %' },
		],
		avail: [
			{ color: '#ef4444', label: '< 80 %' },
			{ color: '#f97316', label: '< 95 %' },
			{ color: '#eab308', label: '< 99 %' },
			{ color: '#22c55e', label: '≥ 99 %' },
		],
		down: [
			{ color: '#ef4444', label: '< 2 Mbit/s' },
			{ color: '#f97316', label: '< 10 Mbit/s' },
			{ color: '#eab308', label: '< 50 Mbit/s' },
			{ color: '#22c55e', label: '≥ 50 Mbit/s' },
		],
		up: [
			{ color: '#ef4444', label: '< 2 Mbit/s' },
			{ color: '#f97316', label: '< 10 Mbit/s' },
			{ color: '#eab308', label: '< 50 Mbit/s' },
			{ color: '#22c55e', label: '≥ 50 Mbit/s' },
		],
	};

	let mapContainer: HTMLDivElement | undefined = $state(undefined);
	let map: maplibregl.Map | null = null;
	let mapReady = $state(false);

	let metric = $state<Metric>('rtt');
	let netFilter = $state<NetClass | 'all'>('all');
	let period = $state<PeriodValue>('30d');
	let trainFilter = $state<TrainType | 'all'>('all');
	let mineOnly = $state(false);

	let cells = $state<CellRow[]>([]);
	let loadError = $state<string | null>(null);
	let hasLoadedOnce = $state(false);
	let moveDebounce: ReturnType<typeof setTimeout> | null = null;

	function metricIndex(): 3 | 4 | 5 | 6 | 7 {
		switch (metric) {
			case 'rtt':
				return 3;
			case 'loss':
				return 4;
			case 'avail':
				return 5;
			case 'down':
				return 6;
			case 'up':
				return 7;
		}
	}

	function colorExpression(): ExpressionSpecification {
		switch (metric) {
			case 'rtt':
				return rttColorExpression('value');
			case 'loss':
				return ['step', ['get', 'value'], '#22c55e', 1, '#eab308', 5, '#f97316', 15, '#ef4444'];
			case 'avail':
				return ['step', ['get', 'value'], '#ef4444', 80, '#f97316', 95, '#eab308', 99, '#22c55e'];
			case 'down':
			case 'up':
				return ['step', ['get', 'value'], '#ef4444', 2_000_000, '#f97316', 10_000_000, '#eab308', 50_000_000, '#22c55e'];
		}
	}

	// Kein @types/geojson im Projekt verfügbar; eigene, minimale Feature-Form statt des globalen
	// `GeoJSON`-Namespace, den maplibre-gl.d.ts voraussetzt.
	function toGeoJson(rows: CellRow[]) {
		const idx = metricIndex();
		return {
			type: 'FeatureCollection' as const,
			features: rows
				.filter((row) => row[idx] !== null)
				.map((row) => {
					const [h3, nSamples, nTrips, rtt, loss, avail, down, up] = row;
					const boundary = cellToBoundary(h3, true);
					return {
						type: 'Feature' as const,
						properties: { h3, nSamples, nTrips, rtt, loss, avail, down, up, value: row[idx] },
						geometry: { type: 'Polygon' as const, coordinates: [[...boundary, boundary[0]]] },
					};
				}),
		};
	}

	function currentBbox(): string | null {
		if (!map) return null;
		const b = map.getBounds();
		return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
	}

	async function fetchCells(): Promise<void> {
		const bbox = currentBbox();
		if (!bbox) return;
		const res = map && map.getZoom() < 10 ? 8 : 9;
		try {
			const response = await api.publicCells({
				res,
				bbox,
				net: netFilter,
				period,
				train: trainFilter,
				mine: mineOnly && !!auth.me,
			});
			cells = response.cells;
			loadError = null;
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : t.loadError;
		} finally {
			hasLoadedOnce = true;
		}

		const source = map?.getSource('cells');
		if (source && source.type === 'geojson') {
			(source as maplibregl.GeoJSONSource).setData(toGeoJson(cells));
		}
		if (map?.getLayer('cells-fill')) {
			map.setPaintProperty('cells-fill', 'fill-color', colorExpression());
		}
	}

	function scheduleFetch(): void {
		if (moveDebounce) clearTimeout(moveDebounce);
		moveDebounce = setTimeout(() => void fetchCells(), 400);
	}

	// Filter-Änderungen lösen sofort eine neue Abfrage aus.
	$effect(() => {
		// Abhängigkeiten explizit lesen, damit $effect bei jeder Filteränderung neu läuft.
		void metric;
		void netFilter;
		void period;
		void trainFilter;
		void mineOnly;
		if (mapReady) void fetchCells();
	});

	onMount(() => {
		ensurePmtilesProtocol();

		const m = new maplibregl.Map({
			container: mapContainer as HTMLDivElement,
			center: DEFAULT_CENTER,
			zoom: DEFAULT_ZOOM,
			style: createBaseStyle(
				{ cells: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
				[
					{
						id: 'cells-fill',
						type: 'fill',
						source: 'cells',
						paint: { 'fill-color': colorExpression(), 'fill-opacity': 0.6 },
					},
					{
						id: 'cells-outline',
						type: 'line',
						source: 'cells',
						paint: { 'line-color': '#000000', 'line-opacity': 0.15, 'line-width': 0.5 },
					},
				],
			),
		});
		map = m;

		m.on('load', () => {
			mapReady = true;
			void fetchCells();
		});
		m.on('moveend', scheduleFetch);

		attachHoverPopup(m, ['cells-fill'], (f) => {
			const p = f.properties as Record<string, number | string | null>;
			const html = `
				<strong>${t.popup.trips(p.nTrips ?? 0)} · ${t.popup.samples(p.nSamples ?? 0)}</strong><br />
				${t.popup.rtt}: ${p.rtt ?? t.popup.dash} ms<br />
				${t.popup.loss}: ${p.loss ?? t.popup.dash} %<br />
				${t.popup.avail}: ${p.avail ?? t.popup.dash} %<br />
				${t.popup.down}: ${p.down ? (Number(p.down) / 1_000_000).toFixed(1) + ' Mbit/s' : t.popup.dash}<br />
				${t.popup.up}: ${p.up ? (Number(p.up) / 1_000_000).toFixed(1) + ' Mbit/s' : t.popup.dash}
			`;
			return html;
		});
	});

	onDestroy(() => {
		if (moveDebounce) clearTimeout(moveDebounce);
		map?.remove();
	});
</script>

<svelte:head>
	<title>{t.title}</title>
</svelte:head>

<div class="card">
	<div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
		<div class="field">
			<label for="metric">{t.metric}</label>
			<select id="metric" bind:value={metric}>
				{#each METRICS as metricOpt (metricOpt)}
					<option value={metricOpt}>{t.metricLabels[metricOpt]}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="net">{t.net}</label>
			<select id="net" bind:value={netFilter}>
				<option value="all">{t.all}</option>
				{#each NET_CLASSES as n (n)}
					<option value={n}>{netClassLabel(n)}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="period">{t.period}</label>
			<select id="period" bind:value={period}>
				{#each PERIODS as p (p)}
					<option value={p}>{p === 'all' ? t.periodAll : t.periodDays(p.replace('d', ''))}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="train">{t.train}</label>
			<select id="train" bind:value={trainFilter}>
				<option value="all">{t.all}</option>
				{#each TRAIN_TYPES as tt (tt)}
					<option value={tt}>{trainTypeLabel(tt)}</option>
				{/each}
			</select>
		</div>
		{#if auth.me}
			<div class="field">
				<label for="mine">
					<input id="mine" type="checkbox" bind:checked={mineOnly} style="width: auto; min-height: auto" />
					{t.mineOnly}
				</label>
			</div>
		{/if}
	</div>
</div>

{#if loadError}
	<div class="notice error">{loadError}</div>
{:else if hasLoadedOnce && cells.length === 0}
	<div class="notice warn">{t.noCells}</div>
{/if}

<div class="card" style="padding: 0; overflow: hidden">
	<div bind:this={mapContainer} style="width: 100%; height: 70vh; min-height: 400px"></div>
</div>

<div class="card">
	<strong>{t.legend}: {t.metricLabels[metric]}</strong>
	<div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem">
		{#each LEGEND[metric] as step (step.label)}
			<span style="display: inline-flex; align-items: center; gap: 0.4rem">
				<span style="width: 14px; height: 14px; border-radius: 3px; background: {step.color}; display: inline-block"
				></span>
				{step.label}
			</span>
		{/each}
	</div>
</div>
