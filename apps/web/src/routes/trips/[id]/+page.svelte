<script lang="ts">
	// Fahrtdetail (öffentlich per Link): Kopf, Kennzahlen, Karte der Strecke (eingefärbt nach RTT),
	// darunter der ICE-Portal-Status als Zeitleiste, Zeitverlauf (RTT/Verlust/Geschwindigkeit) und
	// Netzliste. Nutzt dieselbe Basemap wie `/map` (siehe #lib/map/basemap.js), hell oder dunkel je
	// nach Farbmodus. Bei laufender Fahrt (status 'active') wird alle LIVE_POLL_MS inkrementell
	// nachgeladen (nur bei sichtbarem Tab), bis die Fahrt endet.
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { fmtDate, fmtNumber, fmtTime, i18n, iceStateLabel, netClassLabel, trainTypeLabel } from '#lib/i18n.svelte.js';
	import { ApiError, api, type TripSampleExt, type TripSamplesExt } from '#lib/api.js';
	import type { TripStop } from '@bahn/shared';
	import { createBaseStyle, DEFAULT_CENTER, DEFAULT_ZOOM, ensurePmtilesProtocol } from '#lib/map/basemap.js';
	import { RTT_LEGEND, rttColor, rttColorExpression, SPEED_GRADIENT, SPEEDTEST_COLOR, speedColorExpression } from '#lib/map/colors.js';
	import { attachHoverPopup } from '#lib/map/hover-popup.js';
	import { mapPrefs, speedtestVisibility } from '#lib/map/prefs.svelte.js';
	import { median, percentile } from '#lib/tracker/util.js';
	import { theme } from '#lib/theme.svelte.js';

	const tripId = page.params.id as string;
	const LIVE_POLL_MS = 5000;
	/** Bis zu dieser Anzahl Abschnitte wird die ICE-Liste komplett gezeigt, darüber eingeklappt. */
	const ICE_LIST_COLLAPSED = 6;

	let data = $state<TripSamplesExt | null>(null);
	let loadError = $state<string | null>(null);
	let iceListOpen = $state(false);
	let shareState = $state<'idle' | 'copied'>('idle');
	/** Karte folgt der letzten Position einer laufenden Fahrt; aus bei manuellem Ziehen. */
	let follow = $state(true);
	/** Aktualisiert sich jede Sekunde, damit "vor X s" ohne erneuten Request mitläuft. */
	let nowTick = $state(Date.now());
	let livePollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;

	let mapContainer: HTMLDivElement | undefined = $state(undefined);
	let chartContainer: HTMLDivElement | undefined = $state(undefined);
	let map: maplibregl.Map | null = null;
	let mapTheme: string | null = null;
	// Färbung der Streckenpunkte: Latenz (Standard) oder Tempo.
	let mapMode = $state<'rtt' | 'speed'>('rtt');
	let chart: uPlot | null = null;
	let chartObserver: ResizeObserver | null = null;
	let chartWidth = $state(0);

	const RTT_COLOR = rttColorExpression('rtt');
	const SPEED_COLOR = speedColorExpression('speedKmh');

	const de = {
		pageTitle: 'Fahrtdetail',
		tripSuffix: 'Fahrt',
		loadFailed: 'Fahrt konnte nicht geladen werden',
		notFound: 'Fahrt nicht gefunden',
		toMap: 'Zur Karte',
		loading: 'Lade Fahrt',
		flagged: 'markiert',
		ended: 'beendet',
		now: 'jetzt',
		share: 'Teilen',
		copied: 'Link kopiert',
		liveValues: 'Live-Werte',
		speed: 'Tempo',
		iceStatus: 'ICE-Status',
		network: 'Netz',
		lastMeasurement: 'Letzte Messung',
		keyFigures: 'Kennzahlen',
		rttMedian: 'RTT Median',
		rttP90: 'RTT p90',
		loss: 'Verlust',
		availability: 'Verfügbarkeit',
		bestDownload: 'Bester Download',
		measurements: 'Messwerte',
		following: 'Folgt',
		follow: 'Folgen',
		route: 'Strecke',
		toggleSpeedtests: 'Speedtests auf der Karte ein-/ausblenden',
		iceTitle: 'ICE-Portal-Status',
		iceTimeline: 'Zeitleiste des ICE-Portal-Status',
		sections: (n: number) => `${n} ${n === 1 ? 'Abschnitt' : 'Abschnitte'}`,
		showAll: (n: number) => `Alle ${n} Abschnitte anzeigen`,
		showLess: 'Weniger anzeigen',
		timeline: 'Zeitverlauf',
		noPings: 'Keine Ping-Messwerte vorhanden.',
		networks: 'Gesehene Netze',
		noNetworks: 'Keine Netzinformationen vorhanden.',
		speedtests: 'Speedtests',
		speedtest: 'Speedtest',
		noSpeedtests: 'Keine Speedtests auf dieser Fahrt.',
		flaggedSamples: 'Geflaggte Messwerte',
		ago: (sec: number) =>
			sec < 60 ? `vor ${sec} s` : sec < 3600 ? `vor ${Math.floor(sec / 60)} min` : `vor ${Math.floor(sec / 3600)} h`,
		noLatency: 'keine Latenz',
		popupLoss: 'Verlust',
		popupSpeed: 'Tempo',
		popupNet: 'Netz',
		popupIce: 'ICE',
		popupDown: 'Download',
		popupUp: 'Upload',
		modeLatency: 'Latenz',
		modeSpeed: 'Tempo',
		mapModeLabel: 'Kartenfärbung',
		noSpeed: 'kein Tempo',
		unitChip: (v: string) => `Tz ${v}`,
		classChip: (v: string) => `BR ${v}`,
		inLabel: 'in',
		stopsTitle: 'Halte',
		stopsCount: (n: number) => `${n} ${n === 1 ? 'Halt' : 'Halte'}`,
		arr: 'An',
		dep: 'Ab',
		onTime: 'pünktlich',
		platformPrefix: 'Gl.',
	};
	const en: typeof de = {
		pageTitle: 'Trip details',
		tripSuffix: 'trip',
		loadFailed: 'Could not load trip',
		notFound: 'Trip not found',
		toMap: 'Go to map',
		loading: 'Loading trip',
		flagged: 'flagged',
		ended: 'ended',
		now: 'now',
		share: 'Share',
		copied: 'Link copied',
		liveValues: 'Live values',
		speed: 'Speed',
		iceStatus: 'ICE status',
		network: 'Network',
		lastMeasurement: 'Last measurement',
		keyFigures: 'Key figures',
		rttMedian: 'RTT median',
		rttP90: 'RTT p90',
		loss: 'Loss',
		availability: 'Availability',
		bestDownload: 'Best download',
		measurements: 'Measurements',
		following: 'Following',
		follow: 'Follow',
		route: 'Route',
		toggleSpeedtests: 'Show/hide speed tests on the map',
		iceTitle: 'ICE portal status',
		iceTimeline: 'Timeline of the ICE portal status',
		sections: (n: number) => `${n} ${n === 1 ? 'section' : 'sections'}`,
		showAll: (n: number) => `Show all ${n} sections`,
		showLess: 'Show less',
		timeline: 'Timeline',
		noPings: 'No ping measurements.',
		networks: 'Networks seen',
		noNetworks: 'No network information.',
		speedtests: 'Speed tests',
		speedtest: 'Speed test',
		noSpeedtests: 'No speed tests on this trip.',
		flaggedSamples: 'Flagged measurements',
		ago: (sec: number) =>
			sec < 60 ? `${sec} s ago` : sec < 3600 ? `${Math.floor(sec / 60)} min ago` : `${Math.floor(sec / 3600)} h ago`,
		noLatency: 'no latency',
		popupLoss: 'Loss',
		popupSpeed: 'Speed',
		popupNet: 'Network',
		popupIce: 'ICE',
		popupDown: 'Download',
		popupUp: 'Upload',
		modeLatency: 'Latency',
		modeSpeed: 'Speed',
		mapModeLabel: 'Map colouring',
		noSpeed: 'no speed',
		unitChip: (v: string) => `Unit ${v}`,
		classChip: (v: string) => `Class ${v}`,
		inLabel: 'in',
		stopsTitle: 'Stops',
		stopsCount: (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`,
		arr: 'Arr',
		dep: 'Dep',
		onTime: 'on time',
		platformPrefix: 'Pl.',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	/** Farben je ICE-Portal-Status (gleiche Ampellogik wie RTT). */
	const ICE_STATE_COLORS: Record<string, string> = {
		HIGH: '#22c55e',
		MIDDLE: '#a3e635',
		WEAK: '#f97316',
		LOW: '#f97316',
		UNSTABLE: '#eab308',
		NO_INTERNET: '#ef4444',
		NO_INFO: '#64748b',
	};

	async function load(): Promise<void> {
		try {
			data = await api.getTripSamples(tripId);
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : m.loadFailed;
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
			data = { trip: res.trip, samples: merged, asns: res.asns, stops: res.stops, serverTime: res.serverTime };
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

	async function share(): Promise<void> {
		const url = location.href;
		const title = data ? `${trainTitle} – BahnPing` : 'BahnPing';
		if (navigator.share) {
			try {
				await navigator.share({ title, url });
			} catch {
				// Abgebrochen: nichts zu tun.
			}
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			shareState = 'copied';
			setTimeout(() => (shareState = 'idle'), 2000);
		} catch {
			// Kein Clipboard-Zugriff (z.B. unsicherer Kontext): stillschweigend ignorieren.
		}
	}

	const isLive = $derived(data?.trip.status === 'active');
	/** Kurzes Gattungskürzel für die Überschrift ("ICE 578"); ohne eindeutiges Kürzel das volle Label. */
	const SHORT_TYPE: Partial<Record<string, string>> = { ice: 'ICE', ic: 'IC', sbahn: 'S' };
	const trainTitle = $derived.by(() => {
		if (!data) return '';
		const prefix = SHORT_TYPE[data.trip.trainType] ?? trainTypeLabel(data.trip.trainType);
		return data.trip.trainNumber ? `${prefix} ${data.trip.trainNumber}` : trainTypeLabel(data.trip.trainType);
	});

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

	/** Prognose des ICE-Portals (nächster Status + verbleibende Sekunden) aus dem jüngsten Sample, das sie liefert. */
	type IceForecast = { nextState: string; remainingS: number; sampleTs: string };
	const iceForecast = $derived.by<IceForecast | null>(() => {
		for (let i = (data?.samples.length ?? 0) - 1; i >= 0; i -= 1) {
			const s = data!.samples[i];
			if (s.iceNextState && s.iceRemainingS !== null && s.iceRemainingS !== undefined) {
				return { nextState: s.iceNextState, remainingS: s.iceRemainingS, sampleTs: s.ts };
			}
		}
		return null;
	});
	/** Verbleibende Sekunden der Prognose, läuft mit `nowTick` runter (nie unter 0). */
	const iceForecastRemainingSec = $derived.by(() => {
		if (!iceForecast) return null;
		const elapsed = (nowTick - new Date(iceForecast.sampleTs).getTime()) / 1000;
		return Math.max(0, Math.round(iceForecast.remainingS - elapsed));
	});

	/** Sekunden → "1:30". */
	function fmtCountdown(sec: number): string {
		const min = Math.floor(sec / 60);
		const rest = sec % 60;
		return `${min}:${String(rest).padStart(2, '0')}`;
	}

	function fmt(value: number | null, digits = 0): string {
		return value === null ? '–' : fmtNumber(value, digits);
	}

	function mbit(bps: number | null): string {
		return bps === null ? '–' : fmtNumber(bps / 1_000_000, 1);
	}

	const timeLabel = fmtTime;

	/** Dauer in ms → "45 s", "12 min", "1 h 05 min". */
	function durationMs(ms: number): string {
		const sec = Math.max(0, Math.round(ms / 1000));
		if (sec < 60) return `${sec} s`;
		const min = Math.round(sec / 60);
		if (min < 60) return `${min} min`;
		return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
	}

	const tripEndMs = $derived.by(() => {
		if (!data) return 0;
		if (data.trip.endedAt) return new Date(data.trip.endedAt).getTime();
		return isLive ? nowTick : lastSample ? new Date(lastSample.ts).getTime() : Date.now();
	});
	const tripDurationMs = $derived(data ? tripEndMs - new Date(data.trip.startedAt).getTime() : 0);

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
	const bestDown = $derived(
		speedtestSamples.reduce<number | null>((a, s) => (s.downBps !== null && (a === null || s.downBps > a) ? s.downBps : a), null),
	);

	/** Ampelfarbe für Prozentwerte (Verlust: niedrig gut; Verfügbarkeit: hoch gut). */
	function lossColor(v: number | null): string {
		if (v === null) return 'var(--fg-faint)';
		return v < 1 ? '#22c55e' : v < 5 ? '#eab308' : v < 15 ? '#f97316' : '#ef4444';
	}
	function availColor(v: number | null): string {
		if (v === null) return 'var(--fg-faint)';
		return v >= 99 ? '#22c55e' : v >= 95 ? '#eab308' : v >= 80 ? '#f97316' : '#ef4444';
	}

	const totalAsnSamples = $derived((data?.asns ?? []).reduce((a, r) => a + r.samples, 0));

	type IceSegment = { state: string; label: string; color: string; from: number; to: number };

	/**
	 * Zeitlicher Verlauf des ICE-Portal-Status als zusammenhängende Abschnitte. Gleich beschriftete
	 * Zustände (WEAK/LOW) werden zusammengefasst; ein Abschnitt endet beim nächsten Wechsel bzw. beim
	 * Fahrtende (laufend: jetzt).
	 */
	const iceSegments = $derived.by(() => {
		const out: IceSegment[] = [];
		for (const s of data?.samples ?? []) {
			if (!s.iceState) continue;
			const label = iceStateLabel(s.iceState);
			const at = new Date(s.ts).getTime();
			const prev = out[out.length - 1];
			if (prev && prev.label === label) continue;
			if (prev) prev.to = at;
			out.push({ state: s.iceState, label, color: ICE_STATE_COLORS[s.iceState] ?? '#64748b', from: at, to: at });
		}
		const last = out[out.length - 1];
		if (last) last.to = Math.max(last.from, tripEndMs);
		return out;
	});
	const iceRange = $derived.by(() => {
		if (iceSegments.length === 0) return null;
		const from = iceSegments[0].from;
		const to = iceSegments[iceSegments.length - 1].to;
		return { from, to, span: Math.max(1, to - from) };
	});
	/** Gesamtdauer je Zustand, absteigend sortiert. */
	const iceTotals = $derived.by(() => {
		const totals = new Map<string, { label: string; color: string; ms: number }>();
		for (const seg of iceSegments) {
			const t = totals.get(seg.label) ?? { label: seg.label, color: seg.color, ms: 0 };
			t.ms += seg.to - seg.from;
			totals.set(seg.label, t);
		}
		return [...totals.values()].sort((a, b) => b.ms - a.ms);
	});
	const iceListVisible = $derived(
		iceListOpen || iceSegments.length <= ICE_LIST_COLLAPSED ? [...iceSegments].reverse() : [...iceSegments].reverse().slice(0, ICE_LIST_COLLAPSED),
	);

	const stops = $derived(data?.stops ?? []);
	/** Index des nächsten (noch nicht passierten) Halts, -1 wenn keiner. */
	const nextStopIndex = $derived(stops.findIndex((s) => s.passed !== true));

	/**
	 * Verspätung eines Halts in Minuten (Ist − Plan), gerundet. Normalerweise anhand der Ankunft,
	 * beim ersten Halt (keine Ankunft geplant) anhand der Abfahrt. `null`, solange der Ist-Wert fehlt.
	 */
	function stopDelayMin(s: TripStop): number | null {
		const scheduled = s.scheduledArrival ?? s.scheduledDeparture;
		const actual = s.scheduledArrival !== null ? s.actualArrival : s.actualDeparture;
		if (scheduled === null || actual === null) return null;
		return Math.round((new Date(actual).getTime() - new Date(scheduled).getTime()) / 60_000);
	}
	const nextStopDelayMin = $derived(nextStopIndex >= 0 ? stopDelayMin(stops[nextStopIndex]) : null);

	/** Ampelfarbe für eine Verspätung (<=0 pünktlich/grün, 1-5 gelb, ab 6 rot). */
	function delayColor(min: number | null): string {
		if (min === null) return 'var(--fg-dim)';
		if (min <= 0) return 'var(--accent)';
		return min <= 5 ? 'var(--warn)' : 'var(--danger)';
	}
	function delayLabel(min: number | null): string {
		if (min === null) return '';
		return min <= 0 ? m.onTime : `+${min} min`;
	}

	/** Gleis-Text, bei Wechsel zwischen geplant/aktuell hervorgehoben ("Gl. 7 → 9"). */
	function trackLabel(s: TripStop): string | null {
		if (s.trackActual && s.trackScheduled && s.trackActual !== s.trackScheduled) {
			return `${m.platformPrefix} ${s.trackScheduled} → ${s.trackActual}`;
		}
		const track = s.trackActual ?? s.trackScheduled;
		return track ? `${m.platformPrefix} ${track}` : null;
	}
	function trackChanged(s: TripStop): boolean {
		return !!(s.trackActual && s.trackScheduled && s.trackActual !== s.trackScheduled);
	}

	/** GeoJSON der Halte (nur mit Position) für die Bahnhofs-Marker auf der Karte. */
	function stopsGeoJson() {
		const withPos = stops.filter((s) => s.lat !== null && s.lon !== null);
		return {
			type: 'FeatureCollection' as const,
			features: withPos.map((s) => ({
				type: 'Feature' as const,
				properties: { name: s.name, passed: s.passed === true },
				geometry: { type: 'Point' as const, coordinates: [s.lon as number, s.lat as number] },
			})),
		};
	}

	function speedtestLabel(down: number | null, up: number | null): string {
		const parts: string[] = [];
		if (down !== null) parts.push(`↓ ${fmtNumber(down / 1_000_000, 1)}`);
		if (up !== null) parts.push(`↑ ${fmtNumber(up / 1_000_000, 1)}`);
		return parts.length > 0 ? `${parts.join('  ')} Mbit/s` : '–';
	}

	/** Farbe der Streckenpunkte je Kartenmodus; Punkte ohne Wert werden grau. */
	function pointColor(mode: 'rtt' | 'speed'): maplibregl.ExpressionSpecification {
		if (mode === 'speed') return ['case', ['==', ['typeof', ['get', 'speedKmh']], 'number'], SPEED_COLOR, '#94a3b8'];
		return ['case', ['get', 'fullLoss'], '#ef4444', ['==', ['typeof', ['get', 'rtt']], 'number'], RTT_COLOR, '#94a3b8'];
	}

	function pointGeoJson() {
		const samples = (data?.samples ?? []).filter((s) => s.lat !== null && s.lon !== null);
		return {
			type: 'FeatureCollection' as const,
			features: samples.map((s, i) => ({
				type: 'Feature' as const,
				properties: {
					id: s.id,
					ts: s.ts,
					// Probes (HTTP-Checks) haben kein Ping-RTT; dann die HTTP-Latenz für die Farbe nehmen.
					rtt: s.rttMedian ?? s.httpMs,
					latencyKind: s.rttMedian !== null ? 'RTT' : s.httpMs !== null ? 'HTTP' : null,
					loss: s.n !== null && s.n > 0 ? (100 * (s.lost ?? 0)) / s.n : null,
					speedKmh: s.speedMps !== null ? s.speedMps * 3.6 : null,
					netClass: s.netClass,
					asn: s.asn,
					kind: s.kind,
					iceState: s.iceState,
					fullLoss: (s.n !== null && s.n > 0 && s.lost === s.n) || s.ok === false,
					last: i === samples.length - 1,
					downBps: s.downBps,
					upBps: s.upBps,
					// Badge-Text neben der Strecke, z.B. "↓ 4,3  ↑ 1,2".
					dlLabel: s.kind === 'speedtest' ? speedtestLabel(s.downBps, s.upBps) : null,
				},
				geometry: { type: 'Point' as const, coordinates: [s.lon as number, s.lat as number] },
			})),
		};
	}

	function fitToRoute(animate = false): void {
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
			{ padding: { top: 56, bottom: 56, left: 32, right: 32 }, maxZoom: 12, animate },
		);
	}

	function mapStyle(): maplibregl.StyleSpecification {
		const dark = theme.resolved === 'dark';
		const stroke = dark ? '#0a0c10' : '#ffffff';
		return createBaseStyle(
			{
				route: { type: 'geojson', data: pointGeoJson() },
				stops: { type: 'geojson', data: stopsGeoJson() },
			},
			[
				{
					id: 'stops-points',
					type: 'circle',
					source: 'stops',
					paint: {
						'circle-radius': 4,
						'circle-color': dark ? '#ffffff' : '#111418',
						'circle-stroke-color': ['case', ['get', 'passed'], '#64748b', '#38bdf8'],
						'circle-stroke-width': 2,
					},
				},
				{
					id: 'stops-labels',
					type: 'symbol',
					source: 'stops',
					minzoom: 7,
					layout: {
						'text-field': ['get', 'name'],
						'text-font': ['Noto Sans Regular'],
						'text-size': 11,
						'text-offset': [0, 0.9],
						'text-anchor': 'top',
						'text-optional': true,
					},
					paint: {
						'text-color': dark ? '#e9ecf1' : '#111418',
						'text-halo-color': dark ? '#0a0c10' : '#ffffff',
						'text-halo-width': 1.2,
					},
				},
				{
					id: 'route-points',
					type: 'circle',
					source: 'route',
					filter: ['!=', ['get', 'kind'], 'speedtest'],
					paint: {
						'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 5, 16, 7],
						'circle-color': pointColor(mapMode),
						'circle-stroke-color': ['case', ['get', 'fullLoss'], dark ? '#000000' : '#7f1d1d', stroke],
						'circle-stroke-width': ['case', ['get', 'fullLoss'], 1.5, 0.75],
					},
				},
				{
					// Speedtests: dezenter Ring auf der Strecke, Werte als Badge daneben.
					id: 'route-speedtests',
					type: 'circle',
					source: 'route',
					filter: ['==', ['get', 'kind'], 'speedtest'],
					layout: { visibility: speedtestVisibility() },
					paint: {
						'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 6, 16, 8],
						'circle-color': 'rgba(0, 0, 0, 0)',
						'circle-stroke-color': SPEEDTEST_COLOR,
						'circle-stroke-width': 2.5,
					},
				},
				{
					id: 'route-speedtest-badges',
					type: 'symbol',
					source: 'route',
					filter: ['==', ['get', 'kind'], 'speedtest'],
					layout: {
						visibility: speedtestVisibility(),
						'text-field': ['get', 'dlLabel'],
						'text-font': ['Noto Sans Medium'],
						'text-size': 11.5,
						// Links oder rechts neben dem Punkt, je nachdem, wo Platz ist.
						'text-variable-anchor': ['left', 'right'],
						'text-radial-offset': 1.3,
						'text-justify': 'auto',
						'icon-image': 'speedtest-badge',
						'icon-text-fit': 'both',
						'icon-text-fit-padding': [3, 7, 3, 7],
						// Bei Platzmangel zuerst die schnellsten Tests zeigen.
						'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'downBps'], 0]],
					},
					paint: { 'text-color': '#ffffff' },
				},
				...(isLive
					? ([
							{
								id: 'route-current-halo',
								type: 'circle',
								source: 'route',
								filter: ['==', ['get', 'last'], true],
								paint: { 'circle-radius': 16, 'circle-color': '#38bdf8', 'circle-opacity': 0.25 },
							},
							{
								id: 'route-current',
								type: 'circle',
								source: 'route',
								filter: ['==', ['get', 'last'], true],
								paint: {
									'circle-radius': 7,
									'circle-color': '#38bdf8',
									'circle-stroke-color': '#ffffff',
									'circle-stroke-width': 2.5,
								},
							},
						] satisfies maplibregl.LayerSpecification[])
					: []),
			],
			dark ? 'black' : 'light',
		);
	}

	function setupMap(): void {
		if (!mapContainer || !data) return;
		ensurePmtilesProtocol();
		mapTheme = theme.resolved;
		const m = new maplibregl.Map({
			container: mapContainer,
			center: DEFAULT_CENTER,
			zoom: DEFAULT_ZOOM,
			style: mapStyle(),
			attributionControl: { compact: true },
			cooperativeGestures: false,
		});
		map = m;
		m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
		m.on('load', () => {
			fitToRoute();
			// Kompakte Quellenangabe eingeklappt starten, sonst verdeckt sie auf dem Handy die Legende.
			mapContainer?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
		});
		m.on('dragstart', () => (follow = false));
		// Badge-Hintergrund für Speedtests; nach setStyle() (Farbmodus) erneut angefordert.
		m.on('styleimagemissing', (e) => {
			if (e.id === 'speedtest-badge' && !m.hasImage(e.id)) addBadgeImage(m);
		});
		attachHoverPopup(m, ['route-speedtest-badges', 'route-speedtests', 'route-points'], (f) => {
			const p = f.properties as Record<string, unknown>;
			// `m` ist hier die Karte; Texte daher über `txt`.
			const txt = i18n.locale === 'de' ? de : en;
			if (p.kind === 'speedtest') return speedtestPopupHtml(p, txt);
			const rtt = p.rtt === null || p.rtt === undefined || p.rtt === 'null' ? null : Number(p.rtt);
			const ice = typeof p.iceState === 'string' && p.iceState !== 'null' ? iceStateLabel(p.iceState) : null;
			return `
				<div class="trip-popup">
					<div class="trip-popup__time">${timeLabel(p.ts as string, true)}</div>
					<div class="trip-popup__rtt"><span style="background:${rttColor(rtt)}"></span>${rtt !== null ? `${fmtNumber(rtt)} ms` : txt.noLatency}${rtt !== null && p.latencyKind === 'HTTP' ? ' <em>HTTP</em>' : ''}</div>
					<dl>
						<dt>${txt.popupLoss}</dt><dd>${p.loss !== null && p.loss !== undefined && p.loss !== 'null' ? fmtNumber(Number(p.loss)) : '–'} %</dd>
						<dt>${txt.popupSpeed}</dt><dd>${p.speedKmh !== null && p.speedKmh !== undefined && p.speedKmh !== 'null' ? fmtNumber(Number(p.speedKmh)) : '–'} km/h</dd>
						<dt>${txt.popupNet}</dt><dd>${netClassLabel(p.netClass as string)}${p.asn && p.asn !== 'null' ? ` · AS${p.asn}` : ''}</dd>
						${ice ? `<dt>${txt.popupIce}</dt><dd>${ice}</dd>` : ''}
					</dl>
				</div>
			`;
		});
	}

	/** Abgerundetes, dehnbares Badge als Hintergrund der Speedtest-Werte (per Canvas, keine externen Bilder). */
	function addBadgeImage(m: maplibregl.Map): void {
		const ratio = 2;
		const r = 8 * ratio;
		const size = 2 * r + 2 * ratio;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#0369a1';
		ctx.beginPath();
		ctx.roundRect(0, 0, size, size, r);
		ctx.fill();
		m.addImage('speedtest-badge', ctx.getImageData(0, 0, size, size), {
			pixelRatio: ratio,
			stretchX: [[r, size - r]],
			stretchY: [[r, size - r]],
		});
	}

	function speedtestPopupHtml(p: Record<string, unknown>, txt: typeof de): string {
		const val = (v: unknown) => (typeof v === 'number' ? `${fmtNumber(v / 1_000_000, 1)} Mbit/s` : '–');
		return `
			<div class="trip-popup">
				<div class="trip-popup__time">${timeLabel(p.ts as string, true)}</div>
				<div class="trip-popup__rtt"><span style="background:${SPEEDTEST_COLOR}"></span>${txt.speedtest}</div>
				<dl>
					<dt>${txt.popupDown}</dt><dd>${val(p.downBps)}</dd>
					<dt>${txt.popupUp}</dt><dd>${val(p.upBps)}</dd>
					<dt>${txt.popupNet}</dt><dd>${netClassLabel(p.netClass as string)}${p.asn && p.asn !== 'null' ? ` · AS${p.asn}` : ''}</dd>
				</dl>
			</div>
		`;
	}

	/** Aktualisiert die Streckenpunkte einer bereits erzeugten Karte (nach inkrementellem Nachladen). */
	function updateRoute(): void {
		if (!map) return;
		const source = map.getSource('route');
		if (source && source.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(pointGeoJson());
		// Halte können sich beim Live-Nachladen ändern (z.B. tatsächliche Zeiten/Gleise).
		const stopsSource = map.getSource('stops');
		if (stopsSource && stopsSource.type === 'geojson') (stopsSource as maplibregl.GeoJSONSource).setData(stopsGeoJson());
		if (isLive && follow && lastSample && lastSample.lat !== null && lastSample.lon !== null) {
			map.easeTo({ center: [lastSample.lon, lastSample.lat], duration: 400 });
		}
	}

	function recenter(): void {
		if (isLive && lastSample && lastSample.lat !== null && lastSample.lon !== null) {
			follow = true;
			map?.easeTo({ center: [lastSample.lon, lastSample.lat], zoom: Math.max(map.getZoom(), 11), duration: 500 });
		} else {
			fitToRoute(true);
		}
	}

	function cssVar(name: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	function setupChart(): void {
		if (!chartContainer || pingSamples.length === 0) return;
		const width = chartContainer.clientWidth || 600;
		const narrow = width < 560;
		const t = pingSamples.map((s) => new Date(s.ts).getTime() / 1000);
		const rttMed = pingSamples.map((s) => s.rttMedian);
		const rttP90 = pingSamples.map((s) => s.rttP90);
		const loss = pingSamples.map((s) => (s.n ? (100 * (s.lost ?? 0)) / s.n : null));
		const speedKmh = pingSamples.map((s) => (s.speedMps !== null ? s.speedMps * 3.6 : null));

		const axisStroke = cssVar('--fg-dim');
		const gridStroke = cssVar('--border');
		const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString(i18n.intl, { maximumFractionDigits: 1 })} s` : `${v} ms`);
		const axisBase = {
			stroke: axisStroke,
			grid: { stroke: gridStroke, width: 1 },
			ticks: { stroke: gridStroke, width: 1 },
			font: '11px system-ui, sans-serif',
			labelFont: '11px system-ui, sans-serif',
		};

		chart?.destroy();
		chart = new uPlot(
			{
				width,
				height: narrow ? 200 : 260,
				padding: [12, narrow ? 4 : 8, 0, 0],
				cursor: { drag: { x: true, y: false }, points: { size: 6 } },
				legend: { show: false },
				scales: { y: { range: [0, null] }, loss: { range: [0, 100] }, speed: { range: [0, null] } },
				axes: [
					{
						...axisBase,
						space: narrow ? 60 : 80,
						values: (_u: uPlot, splits: number[]) => splits.map((v) => timeLabel(v * 1000)),
					},
					{ ...axisBase, scale: 'y', size: 52, values: (_u: uPlot, splits: number[]) => splits.map(fmtMs) },
					{
						...axisBase,
						scale: 'loss',
						side: 1,
						size: 44,
						grid: { show: false },
						show: !narrow,
						values: (_u: uPlot, splits: number[]) => splits.map((v) => `${v} %`),
					},
					{
						...axisBase,
						scale: 'speed',
						side: 1,
						size: 62,
						grid: { show: false },
						show: !narrow,
						values: (_u: uPlot, splits: number[]) => splits.map((v) => `${v} km/h`),
					},
				],
				series: [
					{},
					{
						label: 'RTT Median',
						stroke: '#4ade80',
						fill: 'rgba(74, 222, 128, 0.12)',
						width: 2,
						scale: 'y',
						points: { show: false },
					},
					{ label: 'RTT p90', stroke: '#fbbf24', width: 1.25, scale: 'y', points: { show: false }, dash: [4, 3] },
					{ label: 'Verlust', stroke: '#f87171', width: 1.25, scale: 'loss', points: { show: false } },
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

	// Farbmodus gewechselt: Basiskarte neu setzen (Quellen/Layer werden mit dem Style mitgegeben).
	$effect(() => {
		const t = theme.resolved;
		untrack(() => {
			if (map && mapTheme !== t) {
				mapTheme = t;
				map.setStyle(mapStyle(), { diff: false });
			}
		});
	});

	// Speedtests ein-/ausgeblendet: nur die Sichtbarkeit der beiden Layer umschalten.
	$effect(() => {
		const visibility = speedtestVisibility();
		untrack(() => {
			for (const id of ['route-speedtests', 'route-speedtest-badges']) {
				if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
			}
		});
	});

	// Kartenmodus (Latenz/Tempo) umgeschaltet: nur die Punktfarbe tauschen, kein neuer Style.
	$effect(() => {
		const mode = mapMode;
		untrack(() => {
			if (map?.getLayer('route-points')) map.setPaintProperty('route-points', 'circle-color', pointColor(mode));
		});
	});

	// Nach dem ersten Aufbau: neue Samples (z.B. durch Live-Nachladen) in die bestehende Karte übernehmen.
	$effect(() => {
		void data?.samples.length;
		if (map) updateRoute();
	});

	// Breite des Diagramms beobachten (Drehen des Handys, Fenstergröße).
	$effect(() => {
		if (!chartContainer) return;
		chartObserver?.disconnect();
		chartObserver = new ResizeObserver((entries) => {
			const w = Math.round(entries[0].contentRect.width);
			if (w > 0 && Math.abs(w - chartWidth) > 4) chartWidth = w;
		});
		chartObserver.observe(chartContainer);
		return () => chartObserver?.disconnect();
	});

	$effect(() => {
		void chartWidth;
		void theme.resolved;
		void i18n.locale;
		void pingSamples.length;
		if (data && chartContainer && pingSamples.length > 0) setupChart();
	});

	onDestroy(() => {
		stopLivePolling();
		chartObserver?.disconnect();
		map?.remove();
		chart?.destroy();
	});
</script>

<svelte:head>
	<title>{data ? `${trainTitle} – ${m.tripSuffix}` : m.pageTitle} · BahnPing</title>
</svelte:head>

{#if loadError && !data}
	<div class="empty">
		<div class="empty__icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM4 11h16M8 21l1.5-3M16 21l-1.5-3" /><circle cx="8.5" cy="14.5" r="1" /><circle cx="15.5" cy="14.5" r="1" /></svg>
		</div>
		<h1>{m.notFound}</h1>
		<p>{loadError}</p>
		<a class="btn secondary" href="/map">{m.toMap}</a>
	</div>
{:else if !data}
	<div class="skeleton" aria-busy="true" aria-label={m.loading}>
		<div class="skeleton__line" style="width: 40%; height: 2rem"></div>
		<div class="skeleton__line" style="width: 65%"></div>
		<div class="skeleton__grid">
			{#each Array(4) as _, i (i)}<div class="skeleton__tile"></div>{/each}
		</div>
		<div class="skeleton__tile" style="height: 50vh"></div>
	</div>
{:else}
	<header class="hero">
		<div class="hero__main">
			<div class="hero__eyebrow">
				<span class="chip chip--type">{trainTypeLabel(data.trip.trainType)}</span>
				{#if data.trip.iceTzn}
					<span class="chip">{m.unitChip(data.trip.iceTzn)}</span>
				{/if}
				{#if data.trip.iceSeries}
					<span class="chip">{m.classChip(data.trip.iceSeries)}</span>
				{/if}
				{#if isLive}
					<span class="live-badge" style="margin-left: 0">LIVE</span>
				{:else if data.trip.status === 'flagged'}
					<span class="chip chip--warn">{m.flagged}</span>
				{:else}
					<span class="chip">{m.ended}</span>
				{/if}
			</div>
			<h1 class="hero__title">
				{trainTitle}
			</h1>
			{#if data.trip.originName && data.trip.destinationName}
				<p class="hero__route">{data.trip.originName} → {data.trip.destinationName}</p>
			{/if}
			<p class="hero__meta">
				<span>{fmtDate(data.trip.startedAt, { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })}</span>
				<span class="dot" aria-hidden="true"></span>
				<span>
					{timeLabel(data.trip.startedAt)}–{data.trip.endedAt ? timeLabel(data.trip.endedAt) : isLive ? m.now : lastSample ? timeLabel(lastSample.ts) : '…'}
				</span>
				<span class="dot" aria-hidden="true"></span>
				<span>{durationMs(tripDurationMs)}</span>
				<span class="dot" aria-hidden="true"></span>
				<span>{data.trip.platform}</span>
			</p>
		</div>
		<button class="btn secondary hero__share" onclick={share}>
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" /></svg>
			{shareState === 'copied' ? m.copied : m.share}
		</button>
	</header>

	{#if loadError}
		<div class="notice error">{loadError}</div>
	{/if}

	{#if isLive}
		<section class="live-strip" aria-label={m.liveValues}>
			<div class="live-tile">
				<span class="live-tile__label">{m.speed}</span>
				<span class="live-tile__value">{currentSpeedKmh !== null ? fmtNumber(currentSpeedKmh) : '–'}<small>km/h</small></span>
			</div>
			<div class="live-tile">
				<span class="live-tile__label">{m.iceStatus}</span>
				<span class="live-tile__value live-tile__value--text">
					{#if currentIceState}
						<span class="state-dot" style="background: {ICE_STATE_COLORS[currentIceState] ?? '#64748b'}"></span>
						{iceStateLabel(currentIceState)}
					{:else}–{/if}
				</span>
				{#if iceForecast && iceForecastRemainingSec !== null}
					<span class="live-tile__forecast">
						<span class="state-dot" style="background: {ICE_STATE_COLORS[iceForecast.nextState] ?? '#64748b'}"></span>
						→ {iceStateLabel(iceForecast.nextState)} {m.inLabel} {fmtCountdown(iceForecastRemainingSec)}
					</span>
				{/if}
			</div>
			<div class="live-tile">
				<span class="live-tile__label">{m.network}</span>
				<span class="live-tile__value live-tile__value--text">{lastSample ? netClassLabel(lastSample.netClass) : '–'}</span>
			</div>
			<div class="live-tile">
				<span class="live-tile__label">{m.lastMeasurement}</span>
				<span class="live-tile__value live-tile__value--text" class:stale={lastSeenSecLive !== null && lastSeenSecLive > 60}>
					{lastSeenSecLive !== null ? m.ago(lastSeenSecLive) : '–'}
				</span>
			</div>
		</section>
	{/if}

	<section class="kpis" aria-label={m.keyFigures}>
		<div class="kpi">
			<span class="kpi__label">{m.rttMedian}</span>
			<span class="kpi__value">
				<span class="kpi__bar" style="background: {rttColor(rttMedianOverall)}"></span>
				{fmt(rttMedianOverall)}<small>ms</small>
			</span>
		</div>
		<div class="kpi">
			<span class="kpi__label">{m.rttP90}</span>
			<span class="kpi__value">
				<span class="kpi__bar" style="background: {rttColor(rttP90Overall)}"></span>
				{fmt(rttP90Overall)}<small>ms</small>
			</span>
		</div>
		<div class="kpi">
			<span class="kpi__label">{m.loss}</span>
			<span class="kpi__value">
				<span class="kpi__bar" style="background: {lossColor(lossPct)}"></span>
				{fmt(lossPct, lossPct !== null && lossPct < 10 ? 1 : 0)}<small>%</small>
			</span>
		</div>
		<div class="kpi">
			<span class="kpi__label">{m.availability}</span>
			<span class="kpi__value">
				<span class="kpi__bar" style="background: {availColor(availPct)}"></span>
				{fmt(availPct)}<small>%</small>
			</span>
		</div>
		<div class="kpi">
			<span class="kpi__label">{m.bestDownload}</span>
			<span class="kpi__value">
				<span class="kpi__bar" style="background: var(--info)"></span>
				{mbit(bestDown)}<small>Mbit/s</small>
			</span>
		</div>
		<div class="kpi">
			<span class="kpi__label">{m.measurements}</span>
			<span class="kpi__value">
				<span class="kpi__bar" style="background: var(--fg-faint)"></span>
				{fmtNumber(data.samples.length)}
			</span>
		</div>
	</section>

	<section class="map-card">
		<div bind:this={mapContainer} class="map-card__map"></div>
		<div class="map-card__overlay map-card__overlay--top">
			{#if isLive}
				<button class="map-chip" class:on={follow} onclick={() => (follow ? (follow = false) : recenter())} aria-pressed={follow}>
					<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
					{follow ? m.following : m.follow}
				</button>
			{:else}
				<button class="map-chip" onclick={recenter}>
					<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" /></svg>
					{m.route}
				</button>
			{/if}
			<div class="map-switch" role="group" aria-label={m.mapModeLabel}>
				<button class:on={mapMode === 'rtt'} aria-pressed={mapMode === 'rtt'} onclick={() => (mapMode = 'rtt')}>{m.modeLatency}</button>
				<button class:on={mapMode === 'speed'} aria-pressed={mapMode === 'speed'} onclick={() => (mapMode = 'speed')}>{m.modeSpeed}</button>
			</div>
		</div>
		<div class="map-card__overlay map-card__overlay--bottom">
			<div class="legend">
				{#if mapMode === 'speed'}
					<span class="legend__item legend__scale">
						0<span class="legend__bar" style="background: {SPEED_GRADIENT}"></span>300 km/h
					</span>
				{:else}
					{#each RTT_LEGEND as l (l.label)}
						<span class="legend__item"><span class="legend__swatch" style="background: {l.color}"></span>{l.label}</span>
					{/each}
				{/if}
				<button
					type="button"
					class="legend__item legend__toggle"
					class:off={!mapPrefs.showSpeedtests}
					aria-pressed={mapPrefs.showSpeedtests}
					title={m.toggleSpeedtests}
					onclick={() => mapPrefs.setShowSpeedtests(!mapPrefs.showSpeedtests)}
				>
					<span class="legend__swatch legend__swatch--ring" style="border-color: {SPEEDTEST_COLOR}"></span>{m.speedtest}
				</button>
			</div>
		</div>
	</section>

	{#if iceSegments.length > 0 && iceRange}
		<section class="card section">
			<div class="section__head">
				<h2>{m.iceTitle}</h2>
				<span class="section__hint">{m.sections(iceSegments.length)}</span>
			</div>

			<div class="ice-bar" role="img" aria-label={m.iceTimeline}>
				{#each iceSegments as seg (seg.from)}
					<span
						class="ice-bar__seg"
						style="left: {((seg.from - iceRange.from) / iceRange.span) * 100}%; width: {Math.max(0.4, ((seg.to - seg.from) / iceRange.span) * 100)}%; background: {seg.color}"
						title="{seg.label}: {timeLabel(seg.from)}–{timeLabel(seg.to)} ({durationMs(seg.to - seg.from)})"
					></span>
				{/each}
			</div>
			<div class="ice-bar__axis">
				<span>{timeLabel(iceRange.from)}</span>
				<span>{isLive ? m.now : timeLabel(iceRange.to)}</span>
			</div>

			<div class="ice-totals">
				{#each iceTotals as t (t.label)}
					<div class="ice-total">
						<span class="state-dot" style="background: {t.color}"></span>
						<span class="ice-total__label">{t.label}</span>
						<span class="ice-total__value">{durationMs(t.ms)}</span>
						<span class="ice-total__pct">{Math.round((100 * t.ms) / iceRange.span)} %</span>
					</div>
				{/each}
			</div>

			<ol class="timeline">
				{#each iceListVisible as seg (seg.from)}
					<li class="timeline__item" class:current={isLive && seg === iceSegments[iceSegments.length - 1]}>
						<span class="timeline__dot" style="--c: {seg.color}"></span>
						<span class="timeline__label">{seg.label}</span>
						<span class="timeline__time">{timeLabel(seg.from, true)}</span>
						<span class="timeline__dur">{durationMs(seg.to - seg.from)}</span>
					</li>
				{/each}
			</ol>
			{#if iceSegments.length > ICE_LIST_COLLAPSED}
				<button class="link-btn" onclick={() => (iceListOpen = !iceListOpen)}>
					{iceListOpen ? m.showLess : m.showAll(iceSegments.length)}
				</button>
			{/if}
		</section>
	{/if}

	{#if stops.length > 0}
		<section class="card section">
			<div class="section__head">
				<h2>{m.stopsTitle}</h2>
				<div class="section__head-right">
					<span class="section__hint">{m.stopsCount(stops.length)}</span>
					{#if nextStopDelayMin !== null}
						<span class="delay-badge" style="color: {delayColor(nextStopDelayMin)}">{delayLabel(nextStopDelayMin)}</span>
					{/if}
				</div>
			</div>
			<ol class="stops">
				{#each stops as s, i (s.seq)}
					{@const delay = stopDelayMin(s)}
					<li class="stop" class:stop--passed={s.passed === true} class:stop--next={i === nextStopIndex}>
						<span class="stop__dot"></span>
						<div class="stop__main">
							<span class="stop__name">{s.name}</span>
							<span class="stop__times">
								{#if s.scheduledArrival}<span>{m.arr} {fmtTime(s.scheduledArrival)}</span>{/if}
								{#if s.scheduledDeparture}<span>{m.dep} {fmtTime(s.scheduledDeparture)}</span>{/if}
								{#if trackLabel(s)}<span class="stop__track" class:stop__track--changed={trackChanged(s)}>{trackLabel(s)}</span>{/if}
							</span>
						</div>
						{#if delay !== null}
							<span class="delay-badge" style="color: {delayColor(delay)}">{delayLabel(delay)}</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<section class="card section">
		<div class="section__head">
			<h2>{m.timeline}</h2>
		</div>
		{#if pingSamples.length === 0}
			<p class="muted">{m.noPings}</p>
		{:else}
			<div class="chart-legend">
				<span><i style="background: #4ade80"></i>{m.rttMedian}</span>
				<span><i class="dashed" style="border-color: #fbbf24"></i>RTT p90</span>
				<span><i style="background: #f87171"></i>{m.loss}</span>
				<span><i style="background: #38bdf8"></i>{m.speed}</span>
			</div>
			<div bind:this={chartContainer} class="chart"></div>
		{/if}
	</section>

	<div class="two-col">
		<section class="card section">
			<div class="section__head">
				<h2>{m.networks}</h2>
			</div>
			{#if data.asns.length === 0}
				<p class="muted">{m.noNetworks}</p>
			{:else}
				<ul class="nets">
					{#each data.asns as a (a.asn)}
						{@const pct = totalAsnSamples > 0 ? (100 * a.samples) / totalAsnSamples : 0}
						<li class="net">
							<div class="net__row">
								<span class="net__name">{a.name}</span>
								<span class="net__pct">{fmtNumber(pct)} %</span>
							</div>
							<div class="net__meter"><span style="width: {pct}%"></span></div>
							<div class="net__meta">AS{a.asn} · {netClassLabel(a.netClass)}</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="card section">
			<div class="section__head">
				<h2>{m.speedtests}</h2>
				{#if speedtestSamples.length > 0}<span class="section__hint">{speedtestSamples.length}</span>{/if}
			</div>
			{#if speedtestSamples.length === 0}
				<p class="muted">{m.noSpeedtests}</p>
			{:else}
				<ul class="speedtests">
					{#each speedtestSamples as s (s.id)}
						<li>
							<span class="speedtests__time">{timeLabel(s.ts)}</span>
							<span class="speedtests__val"><span class="arrow">↓</span>{mbit(s.downBps)}<small>Mbit/s</small></span>
							<span class="speedtests__val"><span class="arrow">↑</span>{mbit(s.upBps)}<small>Mbit/s</small></span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	{#if flaggedSamples.length > 0}
		<details class="card section flagged">
			<summary>{m.flaggedSamples} <span class="section__hint">{flaggedSamples.length}</span></summary>
			<ul class="flagged__list">
				{#each flaggedSamples as s (s.id)}
					<li>
						<span class="flagged__time">{timeLabel(s.ts, true)}</span>
						<span class="flagged__kind">{s.kind}</span>
						<span class="flagged__flags">{s.flags.join(', ')}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
{/if}

<style>
	/* ---------- Kopf ---------- */
	.hero {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin: 0.25rem 0 1.1rem;
		flex-wrap: wrap;
	}

	.hero__main {
		min-width: 0;
	}

	.hero__eyebrow {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.4rem;
	}

	.hero__title {
		font-size: clamp(1.9rem, 7vw, 2.8rem);
		font-weight: 800;
		letter-spacing: -0.035em;
		margin: 0 0 0.35rem;
		font-variant-numeric: tabular-nums;
	}

	.hero__route {
		margin: 0 0 0.35rem;
		color: var(--fg-dim);
		font-size: 0.95rem;
		font-weight: 600;
	}

	.hero__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		color: var(--fg-dim);
		font-size: 0.92rem;
		margin: 0;
	}

	.dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--fg-faint);
	}

	.hero__share {
		min-height: 40px;
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
	}

	@media (max-width: 559px) {
		.hero {
			align-items: flex-start;
			position: relative;
		}

		.hero__share {
			position: absolute;
			top: 0;
			right: 0;
			padding: 0.4rem 0.7rem;
			min-height: 36px;
			font-size: 0.85rem;
		}
	}

	.chip {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: var(--bg-subtle);
		color: var(--fg-dim);
		border: 1px solid var(--border);
	}

	.chip--type {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: transparent;
	}

	.chip--warn {
		color: var(--warn);
	}

	/* ---------- Live-Werte ---------- */
	.live-strip {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	@media (min-width: 720px) {
		.live-strip {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.live-tile {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.85rem;
		border-radius: var(--radius-sm);
		background: linear-gradient(180deg, rgba(56, 189, 248, 0.09), transparent), var(--bg-card);
		border: 1px solid var(--border);
		min-width: 0;
	}

	.live-tile__label,
	.kpi__label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--fg-dim);
		font-weight: 600;
	}

	.live-tile__value {
		font-size: 1.5rem;
		font-weight: 750;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.live-tile__value--text {
		font-size: 1rem;
		font-weight: 650;
		min-height: 2.15rem;
	}

	.live-tile__forecast {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--fg-dim);
	}

	.live-tile__value.stale {
		color: var(--warn);
	}

	small {
		font-size: 0.6em;
		font-weight: 600;
		color: var(--fg-dim);
		margin-left: 0.2em;
		letter-spacing: 0;
	}

	/* ---------- Kennzahlen ---------- */
	.kpis {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	@media (min-width: 640px) {
		.kpis {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (min-width: 960px) {
		.kpis {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
	}

	.kpi {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.75rem 0.85rem;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		min-width: 0;
	}

	.kpi__value {
		display: flex;
		align-items: baseline;
		gap: 0.1rem;
		font-size: 1.55rem;
		font-weight: 750;
		letter-spacing: -0.025em;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.kpi__bar {
		align-self: center;
		width: 4px;
		height: 1.1em;
		border-radius: 2px;
		margin-right: 0.45rem;
		flex-shrink: 0;
	}

	/* ---------- Karte ---------- */
	.map-card {
		position: relative;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
		margin-bottom: 1rem;
		background: var(--bg-inset);
	}

	.map-card__map {
		width: 100%;
		height: clamp(340px, 58vh, 640px);
	}

	@media (max-width: 559px) {
		.map-card {
			margin-inline: -0.85rem;
			border-radius: 0;
			border-inline: none;
		}

		.map-card__map {
			height: 62vh;
			height: 62svh;
		}
	}

	.map-card__overlay {
		position: absolute;
		left: 0.6rem;
		right: 0.6rem;
		display: flex;
		pointer-events: none;
		z-index: 2;
	}

	.map-card__overlay--top {
		top: 0.6rem;
		right: 3.5rem;
	}

	.map-card__overlay--bottom {
		bottom: 0.6rem;
		right: 4.5rem;
	}

	.map-chip,
	.legend {
		pointer-events: auto;
		background: var(--bg-elevated);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		color: var(--fg);
		box-shadow: var(--shadow);
	}

	.map-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		min-height: 36px;
	}

	.map-chip.on {
		background: #0284c7;
		border-color: #0284c7;
		color: #fff;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
		padding: 0.4rem 0.65rem;
		border-radius: var(--radius-sm);
		font-size: 0.72rem;
		color: var(--fg-dim);
	}

	.legend__item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}

	/* Legenden-Eintrag als Schalter (Speedtests ein-/ausblenden). */
	.legend__toggle {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		padding: 0;
		min-height: auto;
		cursor: pointer;
	}

	.legend__toggle.off {
		opacity: 0.45;
		text-decoration: line-through;
	}

	.legend__swatch {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
	}

	.legend__swatch--ring {
		border: 2px solid;
		background: transparent;
	}

	.legend__bar {
		display: inline-block;
		width: 5rem;
		height: 0.45rem;
		border-radius: 999px;
	}

	.map-switch {
		pointer-events: auto;
		display: inline-flex;
		margin-left: 0.4rem;
		padding: 0.2rem;
		gap: 0.15rem;
		border-radius: 999px;
		background: var(--bg-elevated);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
	}

	.map-switch button {
		border: 0;
		background: transparent;
		color: var(--fg-dim);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		cursor: pointer;
		min-height: 28px;
	}

	.map-switch button.on {
		background: #0284c7;
		color: #fff;
	}

	.map-card :global(.maplibregl-ctrl-group) {
		background: var(--bg-elevated);
		backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		overflow: hidden;
	}

	.map-card :global(.maplibregl-ctrl-group button) {
		width: 36px;
		height: 36px;
	}

	.map-card :global(.maplibregl-ctrl-group button + button) {
		border-top: 1px solid var(--border);
	}

	:global([data-theme='dark']) .map-card :global(.maplibregl-ctrl-icon) {
		filter: invert(1);
	}

	.map-card :global(.maplibregl-ctrl-attrib) {
		background: var(--bg-elevated);
		color: var(--fg-dim);
	}

	.map-card :global(.maplibregl-ctrl-attrib a) {
		color: var(--fg-dim);
	}

	:global(.trip-popup__time) {
		font-size: 0.75rem;
		color: var(--fg-dim);
	}

	:global(.trip-popup__rtt) {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 1.15rem;
		font-weight: 750;
		margin: 0.1rem 0 0.4rem;
	}

	:global(.trip-popup__rtt span) {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
	}

	:global(.trip-popup__rtt em) {
		font-style: normal;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--fg-dim);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 0.25rem;
	}

	:global(.trip-popup dl) {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.7rem;
		margin: 0;
	}

	:global(.trip-popup dt) {
		color: var(--fg-dim);
	}

	:global(.trip-popup dd) {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	/* ---------- Abschnitte ---------- */
	.section {
		padding: 1rem 1rem 1.1rem;
	}

	.section__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
	}

	.section__head h2 {
		margin: 0;
	}

	.section__hint {
		font-size: 0.78rem;
		color: var(--fg-dim);
		background: var(--bg-subtle);
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.section__head-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.muted {
		color: var(--fg-dim);
		margin: 0;
	}

	.state-dot {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	/* ---------- ICE-Portal-Status ---------- */
	.ice-bar {
		position: relative;
		height: 14px;
		border-radius: 999px;
		background: var(--bg-subtle);
		overflow: hidden;
	}

	.ice-bar__seg {
		position: absolute;
		top: 0;
		bottom: 0;
	}

	.ice-bar__axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.72rem;
		color: var(--fg-faint);
		margin: 0.3rem 0 0.9rem;
		font-variant-numeric: tabular-nums;
	}

	.ice-totals {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.4rem;
		margin-bottom: 1rem;
	}

	.ice-total {
		display: grid;
		grid-template-columns: auto 1fr auto;
		grid-template-rows: auto auto;
		align-items: center;
		column-gap: 0.45rem;
		padding: 0.55rem 0.7rem;
		background: var(--bg-inset);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.ice-total__label {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.ice-total__value {
		grid-column: 2;
		font-size: 0.8rem;
		color: var(--fg-dim);
		font-variant-numeric: tabular-nums;
	}

	.ice-total__pct {
		grid-column: 3;
		grid-row: 1 / span 2;
		font-weight: 750;
		font-variant-numeric: tabular-nums;
	}

	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		position: relative;
	}

	.timeline::before {
		content: '';
		position: absolute;
		left: 0.3rem;
		top: 0.9rem;
		bottom: 0.9rem;
		width: 2px;
		background: var(--border);
	}

	.timeline__item {
		position: relative;
		display: grid;
		grid-template-columns: 1.4rem 1fr auto auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0;
		font-size: 0.92rem;
	}

	.timeline__item + .timeline__item {
		border-top: 1px dashed var(--border);
	}

	.timeline__dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 0 3px var(--bg-card);
		position: relative;
		z-index: 1;
	}

	.timeline__item.current .timeline__dot {
		box-shadow:
			0 0 0 3px var(--bg-card),
			0 0 0 6px color-mix(in srgb, var(--c) 35%, transparent);
	}

	.timeline__label {
		font-weight: 600;
	}

	.timeline__time {
		color: var(--fg-dim);
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	.timeline__dur {
		min-width: 4.6rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.link-btn {
		margin-top: 0.6rem;
		background: none;
		border: none;
		padding: 0.4rem 0;
		color: var(--accent);
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}

	/* ---------- Halte ---------- */
	.stops {
		list-style: none;
		margin: 0;
		padding: 0;
		position: relative;
	}

	.stops::before {
		content: '';
		position: absolute;
		left: 0.3rem;
		top: 0.9rem;
		bottom: 0.9rem;
		width: 2px;
		background: var(--border);
	}

	.stop {
		position: relative;
		display: grid;
		grid-template-columns: 1.4rem 1fr auto;
		align-items: start;
		gap: 0.6rem;
		padding: 0.6rem 0;
	}

	.stop + .stop {
		border-top: 1px dashed var(--border);
	}

	.stop__dot {
		width: 0.75rem;
		height: 0.75rem;
		margin-top: 0.2rem;
		border-radius: 50%;
		background: var(--bg-card);
		border: 2px solid var(--fg-faint);
		box-sizing: border-box;
		position: relative;
		z-index: 1;
	}

	.stop--passed .stop__dot {
		background: var(--fg-faint);
		border-color: var(--fg-faint);
	}

	.stop--next .stop__dot {
		background: var(--info);
		border-color: var(--info);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--info) 30%, transparent);
	}

	.stop__main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.stop__name {
		font-weight: 650;
		overflow-wrap: anywhere;
	}

	.stop--passed .stop__name,
	.stop--passed .stop__times {
		color: var(--fg-dim);
	}

	.stop__times {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.6rem;
		margin-top: 0.15rem;
		font-size: 0.85rem;
		color: var(--fg-dim);
		font-variant-numeric: tabular-nums;
	}

	.stop__track--changed {
		color: var(--warn);
		font-weight: 700;
	}

	.delay-badge {
		align-self: start;
		font-size: 0.78rem;
		font-weight: 700;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1px solid currentColor;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 380px) {
		.stop {
			grid-template-columns: 1.4rem 1fr;
		}

		.stop .delay-badge {
			grid-column: 2;
			justify-self: start;
			margin-top: 0.3rem;
		}
	}

	/* ---------- Diagramm ---------- */
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		font-size: 0.78rem;
		color: var(--fg-dim);
		margin: -0.3rem 0 0.6rem;
	}

	.chart-legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.chart-legend i {
		display: inline-block;
		width: 0.9rem;
		height: 3px;
		border-radius: 2px;
	}

	.chart-legend i.dashed {
		height: 0;
		border-top: 2px dashed;
	}

	.chart {
		width: 100%;
		min-height: 200px;
	}

	.chart :global(.u-select) {
		background: var(--accent-soft);
	}

	/* ---------- Netze & Speedtests ---------- */
	.two-col {
		display: grid;
		gap: 0 1rem;
	}

	@media (min-width: 820px) {
		.two-col {
			grid-template-columns: 3fr 2fr;
			align-items: start;
		}
	}

	.nets,
	.speedtests,
	.flagged__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.net + .net {
		margin-top: 0.85rem;
	}

	.net__row {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		font-weight: 600;
		font-size: 0.92rem;
	}

	.net__name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.net__pct {
		font-variant-numeric: tabular-nums;
	}

	.net__meter {
		height: 6px;
		border-radius: 999px;
		background: var(--bg-subtle);
		margin: 0.35rem 0 0.3rem;
		overflow: hidden;
	}

	.net__meter span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--accent), var(--info));
	}

	.net__meta {
		font-size: 0.78rem;
		color: var(--fg-dim);
	}

	.speedtests li {
		display: grid;
		grid-template-columns: auto 1fr 1fr;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.55rem 0;
		font-variant-numeric: tabular-nums;
	}

	.speedtests li + li {
		border-top: 1px solid var(--border);
	}

	.speedtests__time {
		color: var(--fg-dim);
		font-size: 0.85rem;
	}

	.speedtests__val {
		font-weight: 700;
		font-size: 1.1rem;
		white-space: nowrap;
	}

	.arrow {
		color: var(--info);
		margin-right: 0.2rem;
	}

	/* ---------- Geflaggt ---------- */
	.flagged summary {
		cursor: pointer;
		font-weight: 650;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		list-style: none;
	}

	.flagged summary::-webkit-details-marker {
		display: none;
	}

	.flagged summary::before {
		content: '›';
		display: inline-block;
		font-size: 1.2rem;
		line-height: 1;
		color: var(--fg-dim);
		transition: transform 0.15s;
	}

	.flagged[open] summary::before {
		transform: rotate(90deg);
	}

	.flagged__list {
		margin-top: 0.75rem;
	}

	.flagged__list li {
		display: grid;
		grid-template-columns: auto auto 1fr;
		gap: 0.75rem;
		padding: 0.45rem 0;
		font-size: 0.85rem;
		border-top: 1px solid var(--border);
	}

	.flagged__time {
		font-variant-numeric: tabular-nums;
		color: var(--fg-dim);
	}

	.flagged__kind {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}

	.flagged__flags {
		color: var(--warn);
		overflow-wrap: anywhere;
	}

	/* ---------- Laden / Fehler ---------- */
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.skeleton__line,
	.skeleton__tile {
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, var(--bg-card), var(--bg-subtle), var(--bg-card));
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
		height: 1rem;
	}

	.skeleton__grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}

	.skeleton__tile {
		height: 4.5rem;
	}

	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton__line,
		.skeleton__tile {
			animation: none;
		}
	}

	.empty {
		text-align: center;
		padding: 4rem 1rem;
		color: var(--fg-dim);
	}

	.empty h1 {
		color: var(--fg);
	}

	.empty__icon {
		width: 3.5rem;
		height: 3.5rem;
		margin: 0 auto 1rem;
		border-radius: 1rem;
		display: grid;
		place-items: center;
		background: var(--bg-card);
		border: 1px solid var(--border);
		color: var(--fg-dim);
	}

	.empty__icon svg {
		width: 1.8rem;
		height: 1.8rem;
	}

	@media (max-width: 380px) {
		.kpi__value {
			font-size: 1.3rem;
		}

		.timeline__item {
			grid-template-columns: 1.4rem 1fr auto;
		}

		.timeline__time {
			display: none;
		}
	}
</style>
