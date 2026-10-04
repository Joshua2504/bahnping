<script lang="ts">
	// Fahrtdetail: Kopf, Kennzahlen, Netzliste, Karte der Strecke (eingefärbt nach RTT) und
	// Zeitverlauf (RTT/Verlust/Geschwindigkeit). Nutzt dieselbe Basemap wie `/map` (siehe
	// #lib/map/basemap.js). Bei laufender Fahrt (status 'active') wird alle LIVE_POLL_MS inkrementell
	// nachgeladen (nur bei sichtbarem Tab), bis die Fahrt endet.
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { ICE_STATE_LABELS, NET_CLASS_LABELS, TRAIN_TYPE_LABELS } from '@bahn/shared';
	import { ApiError, api, type TripSampleExt, type TripSamplesExt } from '#lib/api.js';
	import { createBaseStyle, DEFAULT_CENTER, DEFAULT_ZOOM, ensurePmtilesProtocol } from '#lib/map/basemap.js';
	import { rttColorExpression } from '#lib/map/colors.js';
	import { median, percentile } from '#lib/tracker/util.js';

	const tripId = page.params.id as string;
	const LIVE_POLL_MS = 10_000;

	let data = $state<TripSamplesExt | null>(null);
	let loadError = $state<string | null>(null);
	let flagsOpen = $state(false);
	/** Karte folgt der letzten Position einer laufenden Fahrt; aus bei manuellem Ziehen. */
	let follow = $state(true);
	/** Aktualisiert sich jede Sekunde, damit "vor X s" ohne erneuten Request mitläuft. */
	let nowTick = $state(Date.now());
	let livePollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;

	let mapContainer: HTMLDivElement | undefined = $state(undefined);
	let chartContainer: HTMLDivElement | undefined = $state(undefined);
	let map: maplibregl.Map | null = null;
	let popup: maplibregl.Popup | null = null;
	let chart: uPlot | null = null;

	const RTT_COLOR = rttColorExpression('rtt');

	async function load(): Promise<void> {
		try {
			data = await api.getTripSamples(tripId);
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : 'Fahrt konnte nicht geladen werden';
		}
	}

	/** Lädt nur Samples seit der letzten Serverzeit nach und hängt sie an (inkrementell, für LIVE). */
	async function loadIncremental(): Promise<void> {
		if (!data) return;
		try {
			const res = await api.getTripSamples(tripId, data.serverTime);
			const known = new Set(data.samples.map((s) => s.id));
			const merged = [...data.samples, ...res.samples.filter((s) => !known.has(s.id))];
			merged.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
			data = { trip: res.trip, samples: merged, asns: res.asns, serverTime: res.serverTime };
			loadError = null;
		} catch (err) {
			// Live-Nachladen schlägt leise fehl (z.B. kurzer Netzwerkhänger); Anzeige bleibt auf altem Stand.
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : loadError;
		}
		if (data.trip.status !== 'active') stopLivePolling();
	}

	function startLivePolling(): void {
		if (livePollTimer || !data || data.trip.status !== 'active') return;
		livePollTimer = setInterval(() => {
			if (document.visibilityState === 'visible') void loadIncremental();
		}, LIVE_POLL_MS);
		if (!tickTimer) tickTimer = setInterval(() => (nowTick = Date.now()), 1000);
		document.addEventListener('visibilitychange', handleVisibilityChange);
	}

	function stopLivePolling(): void {
		if (livePollTimer) {
			clearInterval(livePollTimer);
			livePollTimer = null;
		}
		if (tickTimer) {
			clearInterval(tickTimer);
			tickTimer = null;
		}
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	}

	function handleVisibilityChange(): void {
		if (document.visibilityState === 'visible') void loadIncremental();
	}

	const lastSample = $derived.by(() => {
		const samples = data?.samples ?? [];
		return samples.length > 0 ? samples[samples.length - 1] : null;
	});
	const currentSpeedKmh = $derived.by(() => {
		for (let i = (data?.samples.length ?? 0) - 1; i >= 0; i -= 1) {
			const s = data!.samples[i];
			if (s.speedMps !== null) return s.speedMps * 3.6;
		}
		return null;
	});
	const currentIceState = $derived.by(() => {
		for (let i = (data?.samples.length ?? 0) - 1; i >= 0; i -= 1) {
			const s = data!.samples[i];
			if (s.iceState) return s.iceState;
		}
		return null;
	});
	const lastSeenSecLive = $derived(
		lastSample ? Math.max(0, Math.round((nowTick - new Date(lastSample.ts).getTime()) / 1000)) : null,
	);

	function fmt(value: number | null, digits = 0, suffix = ''): string {
		return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
	}

	function mbit(bps: number | null): string {
		return bps === null ? '–' : `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
	}

	function durationLabel(startedAt: string, endedAt: string | null): string {
		const end = endedAt ? new Date(endedAt).getTime() : Date.now();
		const ms = end - new Date(startedAt).getTime();
		const min = Math.round(ms / 60_000);
		if (min < 60) return `${min} min`;
		return `${Math.floor(min / 60)} h ${min % 60} min`;
	}

	const pingSamples = $derived((data?.samples ?? []).filter((s): s is TripSampleExt => s.kind === 'ping_window'));
	const speedtestSamples = $derived((data?.samples ?? []).filter((s) => s.kind === 'speedtest'));
	const flaggedSamples = $derived((data?.samples ?? []).filter((s) => s.flags.length > 0));

	const rttMedianOverall = $derived(median(pingSamples.map((s) => s.rttMedian).filter((v): v is number => v !== null)));
	const rttP90Overall = $derived(percentile(pingSamples.map((s) => s.rttP90).filter((v): v is number => v !== null), 90));
	const lossPct = $derived.by(() => {
		const withN = pingSamples.filter((s) => s.n !== null);
		const n = withN.reduce((a, s) => a + (s.n ?? 0), 0);
		const lost = withN.reduce((a, s) => a + (s.lost ?? 0), 0);
		return n > 0 ? (100 * lost) / n : null;
	});
	const availPct = $derived.by(() => {
		if (pingSamples.length === 0) return null;
		const ok = pingSamples.filter((s) => (s.n ?? 0) > (s.lost ?? 0)).length;
		return (100 * ok) / pingSamples.length;
	});

	const totalAsnSamples = $derived((data?.asns ?? []).reduce((a, r) => a + r.samples, 0));

	/** Zeitlicher Verlauf des ICE-Portal-Konnektivitätsstatus (nur Wechsel, nicht jedes Sample). */
	const iceStateChanges = $derived.by(() => {
		const out: { state: string; at: string }[] = [];
		for (const s of data?.samples ?? []) {
			if (!s.iceState) continue;
			if (out.length === 0 || out[out.length - 1].state !== s.iceState) out.push({ state: s.iceState, at: s.ts });
		}
		return out;
	});
	function pointGeoJson() {
		const samples = (data?.samples ?? []).filter((s) => s.lat !== null && s.lon !== null);
		return {
			type: 'FeatureCollection' as const,
			features: samples.map((s) => ({
				type: 'Feature' as const,
				properties: {
					id: s.id,
					ts: s.ts,
					rtt: s.rttMedian,
					loss: s.n !== null && s.n !== null && s.n! > 0 ? (100 * (s.lost ?? 0)) / (s.n ?? 1) : null,
					speedKmh: s.speedMps !== null ? s.speedMps * 3.6 : null,
					netClass: s.netClass,
					asn: s.asn,
					kind: s.kind,
					fullLoss: s.n !== null && s.n! > 0 && s.lost === s.n,
				},
				geometry: { type: 'Point' as const, coordinates: [s.lon as number, s.lat as number] },
			})),
		};
	}

	function fitToRoute(): void {
		const samples = (data?.samples ?? []).filter((s) => s.lat !== null && s.lon !== null);
		if (!map || samples.length === 0) return;
		let west = Infinity;
		let south = Infinity;
		let east = -Infinity;
		let north = -Infinity;
		for (const s of samples) {
			west = Math.min(west, s.lon as number);
			east = Math.max(east, s.lon as number);
			south = Math.min(south, s.lat as number);
			north = Math.max(north, s.lat as number);
		}
		map.fitBounds(
			[
				[west, south],
				[east, north],
			],
			{ padding: 40, maxZoom: 12 },
		);
	}

	function setupMap(): void {
		if (!mapContainer || !data) return;
		ensurePmtilesProtocol();
		const m = new maplibregl.Map({
			container: mapContainer,
			center: DEFAULT_CENTER,
			zoom: DEFAULT_ZOOM,
			style: createBaseStyle(
				{ route: { type: 'geojson', data: pointGeoJson() } },
				[
					{
						id: 'route-points',
						type: 'circle',
						source: 'route',
						filter: ['!=', ['get', 'kind'], 'speedtest'],
						paint: {
							'circle-radius': 4,
							'circle-color': ['case', ['get', 'fullLoss'], '#ef4444', RTT_COLOR],
							'circle-stroke-color': ['case', ['get', 'fullLoss'], '#000000', '#0b0d10'],
							'circle-stroke-width': ['case', ['get', 'fullLoss'], 1.5, 0.5],
						},
					},
					{
						id: 'route-speedtests',
						type: 'circle',
						source: 'route',
						filter: ['==', ['get', 'kind'], 'speedtest'],
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
		m.on('load', () => {
			fitToRoute();
		});
		m.on('dragstart', () => (follow = false));
		m.on('click', 'route-points', (e) => {
			const f = e.features?.[0];
			if (!f) return;
			const p = f.properties as Record<string, unknown>;
			const html = `
				<strong>${new Date(p.ts as string).toLocaleTimeString('de-DE')}</strong><br />
				RTT: ${p.rtt ?? '–'} ms<br />
				Verlust: ${p.loss !== null && p.loss !== undefined ? Number(p.loss).toFixed(0) : '–'} %<br />
				Geschwindigkeit: ${p.speedKmh !== null && p.speedKmh !== undefined ? Number(p.speedKmh).toFixed(0) : '–'} km/h<br />
				Netz: ${p.asn ? `AS${p.asn} · ` : ''}${NET_CLASS_LABELS[p.netClass as keyof typeof NET_CLASS_LABELS] ?? p.netClass}
			`;
			popup?.remove();
			popup = new maplibregl.Popup().setLngLat(e.lngLat).setHTML(html).addTo(m);
		});
		m.on('mouseenter', 'route-points', () => (m.getCanvas().style.cursor = 'pointer'));
		m.on('mouseleave', 'route-points', () => (m.getCanvas().style.cursor = ''));
	}

	/** Aktualisiert die Streckenpunkte einer bereits erzeugten Karte (nach inkrementellem Nachladen). */
	function updateRoute(): void {
		if (!map) return;
		const source = map.getSource('route');
		if (source && source.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(pointGeoJson());
		if (follow && lastSample && lastSample.lat !== null && lastSample.lon !== null) {
			map.easeTo({ center: [lastSample.lon, lastSample.lat], duration: 400 });
		}
	}

	function setupChart(): void {
		if (!chartContainer || pingSamples.length === 0) return;
		const t = pingSamples.map((s) => new Date(s.ts).getTime() / 1000);
		const rttMed = pingSamples.map((s) => s.rttMedian);
		const rttP90 = pingSamples.map((s) => s.rttP90);
		const loss = pingSamples.map((s) => (s.n ? (100 * (s.lost ?? 0)) / s.n : null));
		const speedKmh = pingSamples.map((s) => (s.speedMps !== null ? s.speedMps * 3.6 : null));

		chart?.destroy();
		chart = new uPlot(
			{
				width: chartContainer.clientWidth || 600,
				height: 220,
				padding: [8, 8, 0, 8],
				scales: { y: { range: [0, null] }, loss: { range: [0, 100] }, speed: { range: [0, null] } },
				axes: [
					{},
					{ scale: 'y', label: 'RTT (ms)' },
					{ scale: 'loss', side: 1, label: 'Verlust (%)' },
					{ scale: 'speed', side: 1, label: 'km/h' },
				],
				series: [
					{},
					{ label: 'RTT Median', stroke: '#4ade80', width: 2, scale: 'y', points: { show: false } },
					{ label: 'RTT p90', stroke: '#fbbf24', width: 1.5, scale: 'y', points: { show: false } },
					{ label: 'Verlust', stroke: '#f87171', width: 1, scale: 'loss', points: { show: false } },
					{ label: 'Geschwindigkeit', stroke: '#38bdf8', width: 1.5, scale: 'speed', points: { show: false } },
				],
			},
			[t, rttMed, rttP90, loss, speedKmh] as uPlot.AlignedData,
			chartContainer,
		);
	}

	onMount(() => {
		void load().then(() => {
			if (data?.trip.status === 'active') startLivePolling();
		});
	});

	$effect(() => {
		if (data && mapContainer && !map) setupMap();
	});

	// Nach dem ersten Aufbau: neue Samples (z.B. durch Live-Nachladen) in die bestehende Karte übernehmen.
	$effect(() => {
		void data?.samples.length;
		if (map) updateRoute();
	});

	$effect(() => {
		if (data && chartContainer && pingSamples.length > 0) setupChart();
	});

	onDestroy(() => {
		stopLivePolling();
		map?.remove();
		chart?.destroy();
	});
</script>

<svelte:head>
	<title>Fahrtdetail</title>
</svelte:head>

{#if loadError}
	<div class="notice error">{loadError}</div>
{:else if !data}
	<p>Lade…</p>
{:else}
	<h1>
		{TRAIN_TYPE_LABELS[data.trip.trainType]}
		{data.trip.trainNumber ?? ''}
		{#if data.trip.status === 'active'}<span class="live-badge">LIVE</span>{/if}
	</h1>

	{#if data.trip.status === 'active'}
		<div class="card">
			<div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
				<div class="stat">
					<div class="stat__label">Geschwindigkeit</div>
					<div class="stat__value">{currentSpeedKmh !== null ? `${currentSpeedKmh.toFixed(0)} km/h` : '–'}</div>
				</div>
				<div class="stat">
					<div class="stat__label">ICE-Status</div>
					<div class="stat__value" style="font-size: 1.1rem">
						{currentIceState ? ICE_STATE_LABELS[currentIceState] ?? currentIceState : '–'}
					</div>
				</div>
				<div class="stat">
					<div class="stat__label">Netz</div>
					<div class="stat__value" style="font-size: 1.1rem">
						{lastSample ? NET_CLASS_LABELS[lastSample.netClass] : '–'}
					</div>
				</div>
				<div class="stat">
					<div class="stat__label">Letzte Messung</div>
					<div class="stat__value">{lastSeenSecLive !== null ? `vor ${lastSeenSecLive} s` : '–'}</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="card">
		<div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
			<div class="stat">
				<div class="stat__label">Datum</div>
				<div class="stat__value">{new Date(data.trip.startedAt).toLocaleString('de-DE')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Dauer</div>
				<div class="stat__value">{durationLabel(data.trip.startedAt, data.trip.endedAt)}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Plattform</div>
				<div class="stat__value" style="font-size: 1rem">{data.trip.platform}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Messwerte</div>
				<div class="stat__value">{data.samples.length}</div>
			</div>
		</div>
	</div>

	<div class="card">
		<h2>Kennzahlen</h2>
		<div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
			<div class="stat">
				<div class="stat__label">RTT Median</div>
				<div class="stat__value">{fmt(rttMedianOverall, 0, ' ms')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">RTT p90</div>
				<div class="stat__value">{fmt(rttP90Overall, 0, ' ms')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Verlust</div>
				<div class="stat__value">{fmt(lossPct, 0, ' %')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Verfügbarkeit</div>
				<div class="stat__value">{fmt(availPct, 0, ' %')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Speedtests</div>
				<div class="stat__value" style="font-size: 1rem">
					{#if speedtestSamples.length === 0}
						keine
					{:else}
						{#each speedtestSamples as s (s.id)}
							<div>↓ {mbit(s.downBps)} / ↑ {mbit(s.upBps)}</div>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="card">
		<h2>Gesehene Netze</h2>
		{#if data.asns.length === 0}
			<p>Keine Netzinformationen vorhanden.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>ASN</th>
						<th>Name</th>
						<th>Klasse</th>
						<th>Anteil</th>
					</tr>
				</thead>
				<tbody>
					{#each data.asns as a (a.asn)}
						<tr>
							<td>AS{a.asn}</td>
							<td>{a.name}</td>
							<td>{NET_CLASS_LABELS[a.netClass]}</td>
							<td>{totalAsnSamples > 0 ? ((100 * a.samples) / totalAsnSamples).toFixed(0) : '0'} %</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	{#if iceStateChanges.length > 0}
		<div class="card">
			<h2>ICE-Portal-Status</h2>
			<ul style="margin: 0.4rem 0 0; padding-left: 1.2rem">
				{#each iceStateChanges as change (change.at)}
					<li>
						{ICE_STATE_LABELS[change.state] ?? change.state}
						– seit {new Date(change.at).toLocaleTimeString('de-DE')}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="card" style="padding: 0; overflow: hidden">
		{#if data.trip.status === 'active'}
			<label style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.6rem 1rem 0">
				<input type="checkbox" bind:checked={follow} style="width: auto; min-height: auto" />
				Folgen
			</label>
		{/if}
		<div bind:this={mapContainer} style="width: 100%; height: 60vh; min-height: 320px"></div>
	</div>

	<div class="card">
		<h2>Zeitverlauf</h2>
		{#if pingSamples.length === 0}
			<p>Keine Ping-Messwerte vorhanden.</p>
		{:else}
			<div bind:this={chartContainer} style="width: 100%"></div>
		{/if}
	</div>

	{#if flaggedSamples.length > 0}
		<div class="card">
			<button class="btn secondary" onclick={() => (flagsOpen = !flagsOpen)}>
				{flagsOpen ? 'Geflaggte Messwerte ausblenden' : `Geflaggte Messwerte anzeigen (${flaggedSamples.length})`}
			</button>
			{#if flagsOpen}
				<table style="margin-top: 0.8rem">
					<thead>
						<tr>
							<th>Zeit</th>
							<th>Art</th>
							<th>Flags</th>
						</tr>
					</thead>
					<tbody>
						{#each flaggedSamples as s (s.id)}
							<tr>
								<td>{new Date(s.ts).toLocaleString('de-DE')}</td>
								<td>{s.kind}</td>
								<td>{s.flags.join(', ')}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
{/if}
