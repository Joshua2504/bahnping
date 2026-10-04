// Orchestriert die gesamte Mess-Engine für den Fahrt-Modus und hält den Live-Zustand (Runes).
import {
	SPEEDTEST_CONTINUOUS_PAUSE_MS,
	WINDOW_MS,
	type NetToken,
	type PingWindowSample,
	type ProbeSample,
	type Sample,
	type SpeedtestSample,
	type TrainType,
} from '@bahn/shared';
import { api, type TripSampleExt } from '../api.js';
import { i18n } from '../i18n.svelte.js';
import { GeoTracker, type GeoState } from './geo.js';
import { NetWhoami } from './net.js';
import { Outbox, type OutboxStatus } from './outbox.js';
import { detectPlatform } from './platform.js';
import { ProbeRunner } from './probe.js';
import { SpeedtestRunner, type SpeedtestProgress } from './speedtest.js';
import { median } from './util.js';
import { WakeLockManager } from './wakelock.js';
import { PingWindowAggregator, type WindowResult } from './windows.js';
import { TrackerSocket, type WsConnectionState } from './ws.js';

const STORAGE_KEY = 'bahn-tracker:activeTrip';
/** ~5 Minuten Verlauf bei 2s-Pings, für die Sparkline. */
const RTT_HISTORY_MAX = 150;
const WINDOWS_PER_60S = Math.round(60_000 / WINDOW_MS);

interface StoredTrip {
	tripId: string;
	trainType: TrainType;
	trainNumber: string | null;
	platform: string;
	startedAt: number;
	clockOffsetMs: number;
}

export interface RttPoint {
	t: number;
	rtt: number | null;
}

interface NetDisplay {
	label: string | null;
	asName: string | null;
	asn: number | null;
	ipVersion: 4 | 6 | null;
	connType: string | null;
	effectiveType: string | null;
}

/** Ein Eintrag im Netz-Verlauf: ASN mit Zeitpunkt des ersten Auftretens in dieser Fahrt. */
export interface NetHistoryEntry {
	asn: number;
	asName: string | null;
	firstSeenAt: number;
}

const NET_HISTORY_MAX = 5;

interface SpeedtestEntry {
	downBps: number | null;
	upBps: number | null;
	at: number;
}

/** Reduziertes Sample für die Live-Karte im Fahrt-Modus (siehe `lib/components/TrackMap.svelte`). */
export interface LiveTripSample {
	id: string;
	ts: number;
	lat: number | null;
	lon: number | null;
	kind: Sample['kind'];
	rttMedian: number | null;
	n: number | null;
	lost: number | null;
}

function liveSampleFromClient(s: Sample): LiveTripSample {
	return {
		id: s.id,
		ts: s.ts,
		lat: s.lat,
		lon: s.lon,
		kind: s.kind,
		rttMedian: s.kind === 'ping_window' ? s.rttMedian : null,
		n: s.kind === 'ping_window' ? s.n : null,
		lost: s.kind === 'ping_window' ? s.lost : null,
	};
}

function liveSampleFromServer(s: TripSampleExt): LiveTripSample {
	return {
		id: s.id,
		ts: new Date(s.ts).getTime(),
		lat: s.lat,
		lon: s.lon,
		kind: s.kind,
		rttMedian: s.rttMedian,
		n: s.n,
		lost: s.lost,
	};
}

const EMPTY_GEO: GeoState = {
	lat: null,
	lon: null,
	accuracyM: null,
	speedMps: null,
	heading: null,
	lastFixAt: null,
	error: null,
};

const EMPTY_NET: NetDisplay = { label: null, asName: null, asn: null, ipVersion: null, connType: null, effectiveType: null };

// Nutzersichtbare Statustexte, sprachabhängig (siehe `msg()`).
const de = {
	endTripFailed: 'Fahrt konnte nicht serverseitig beendet werden, Daten sind lokal gepuffert.',
	speedtestFailed: 'Speedtest fehlgeschlagen',
};
const en: typeof de = {
	endTripFailed: 'Ride could not be ended on the server, data is buffered locally.',
	speedtestFailed: 'Speedtest failed',
};
function msg(): typeof de {
	return i18n.locale === 'de' ? de : en;
}

class Tracker {
	active = $state(false);
	tripId = $state<string | null>(null);
	trainType = $state<TrainType | null>(null);
	trainNumber = $state<string | null>(null);
	startedAt = $state<number | null>(null);
	clockOffsetMs = $state<number | null>(null);

	wsState = $state<WsConnectionState>('closed');
	currentRtt = $state<number | null>(null);
	jitterMs = $state<number | null>(null);
	/** Paketverlust der letzten 60s in Prozent. */
	lossPct60s = $state<number | null>(null);
	/** Verfügbarkeit über die gesamte Fahrt (Anteil Fenster mit n > lost). */
	availabilityPct = $state<number | null>(null);
	rttHistory = $state<RttPoint[]>([]);

	geo = $state<GeoState>(EMPTY_GEO);
	net = $state<NetDisplay>(EMPTY_NET);
	/** Die letzten bis zu 5 unterschiedlichen ASNs dieser Fahrt, nur im Client-Zustand (nicht persistiert). */
	netHistory = $state<NetHistoryEntry[]>([]);
	captive = $state(false);
	/** Fahrt-ID der zuletzt beendeten Fahrt, für den „Fahrt ansehen“-Link. */
	lastEndedTripId = $state<string | null>(null);

	lastSpeedtest = $state<SpeedtestEntry | null>(null);
	speedtestProgress = $state<SpeedtestProgress | null>(null);
	/** Dauer-Speedtest: Tests laufen in Schleife mit SPEEDTEST_CONTINUOUS_PAUSE_MS Pause, bis abgeschaltet. */
	speedtestContinuous = $state(false);
	speedtestRunning = $state(false);
	/** Erhöht sich bei jedem Ein-/Ausschalten, damit eine alte Schleife sich selbst beendet. */
	private continuousGen = 0;

	outboxStatus = $state<OutboxStatus>({ pending: 0, lastUploadAt: null, lastError: null, needsLogin: false });
	errors = $state<string[]>([]);
	resumeAvailable = $state(false);

	/** Alle Samples der laufenden Fahrt (nur im RAM), für die Live-Karte im Fahrt-Modus. */
	tripSamples = $state<LiveTripSample[]>([]);

	private socket: TrackerSocket | null = null;
	private windowAgg: PingWindowAggregator | null = null;
	private geoTracker: GeoTracker | null = null;
	private wakeLock: WakeLockManager | null = null;
	private netWhoami: NetWhoami | null = null;
	private probeRunner: ProbeRunner | null = null;
	private readonly outbox: Outbox;
	private recentNetToken: NetToken | null = null;
	private windowResults: WindowResult[] = [];

	constructor() {
		this.outbox = new Outbox((s) => (this.outboxStatus = s));
		void this.outbox.start();
		this.resumeAvailable = this.readStorage() !== null;
	}

	async start(trainType: TrainType, trainNumber: string): Promise<void> {
		this.clockOffsetMs = null;
		await this.connectSocketAndSync();
		const platform = detectPlatform();
		const trip = await api.createTrip({
			trainType,
			trainNumber: trainNumber || undefined,
			platform,
			clockOffsetMs: this.clockOffsetMs ?? undefined,
		});
		this.beginLocalState({
			tripId: trip.id,
			trainType,
			trainNumber: trainNumber || null,
			platform,
			startedAt: Date.now(),
			clockOffsetMs: this.clockOffsetMs ?? 0,
		});
	}

	async resume(): Promise<void> {
		const stored = this.readStorage();
		if (!stored) return;
		this.clockOffsetMs = null;
		await this.connectSocketAndSync();
		this.beginLocalState(stored);
		void this.loadResumedSamples(stored.tripId);
	}

	/** Nach „Fahrt fortsetzen“ (z.B. nach Reload) die Live-Karte aus Server + Outbox-Resten befüllen. */
	private async loadResumedSamples(tripId: string): Promise<void> {
		const pending = await this.outbox.getPendingSamples(tripId);
		const byId = new Map<string, LiveTripSample>();
		for (const s of pending) byId.set(s.id, liveSampleFromClient(s));
		try {
			const serverData = await api.getTripSamples(tripId);
			for (const s of serverData.samples) byId.set(s.id, liveSampleFromServer(s));
		} catch {
			// Offline: wenigstens die Outbox-Reste anzeigen.
		}
		if (this.tripId !== tripId) return;
		this.tripSamples = [...byId.values()].sort((a, b) => a.ts - b.ts);
	}

	discardResume(): void {
		this.writeStorage(null);
		this.resumeAvailable = false;
	}

	async stop(): Promise<void> {
		const tripId = this.tripId;
		if (!tripId) return;

		this.windowAgg?.stop();
		this.geoTracker?.stop();
		void this.wakeLock?.stop();
		this.netWhoami?.stop();
		this.probeRunner?.stop();
		this.socket?.close();
		window.removeEventListener('beforeunload', this.onBeforeUnload);

		this.setSpeedtestContinuous(false);
		this.active = false;
		this.writeStorage(null);

		try {
			await this.outbox.flushTrip(tripId);
			await api.endTrip(tripId, { clockOffsetMs: this.clockOffsetMs ?? undefined });
		} catch {
			this.errors = [...this.errors, msg().endTripFailed];
		}

		this.lastEndedTripId = tripId;
		this.tripId = null;
	}

	setSpeedtestContinuous(on: boolean): void {
		if (on === this.speedtestContinuous) return;
		this.speedtestContinuous = on;
		const gen = ++this.continuousGen;
		if (on) void this.continuousLoop(gen);
	}

	private async continuousLoop(gen: number): Promise<void> {
		while (gen === this.continuousGen && this.active) {
			await this.runSpeedtest();
			if (gen !== this.continuousGen || !this.active) return;
			await new Promise((resolve) => setTimeout(resolve, SPEEDTEST_CONTINUOUS_PAUSE_MS));
		}
	}

	async runSpeedtest(): Promise<void> {
		// Taste, Dauer-Modus und eine noch laufende alte Schleife dürfen sich nicht überlappen.
		if (this.speedtestRunning) return;
		this.speedtestRunning = true;
		const runner = new SpeedtestRunner();
		try {
			const result = await runner.run((p) => (this.speedtestProgress = p));
			this.lastSpeedtest = { downBps: result.downBps, upBps: result.upBps, at: result.endedAt };

			const idleValues = this.rttHistory
				.filter((p) => p.t < result.startedAt && p.rtt !== null)
				.slice(-5)
				.map((p) => p.rtt as number);
			const loadedValues = this.rttHistory
				.filter((p) => p.t >= result.startedAt && p.t <= result.endedAt && p.rtt !== null)
				.map((p) => p.rtt as number);

			const sample: SpeedtestSample = {
				...this.makeBase(),
				kind: 'speedtest',
				downBps: result.downBps,
				upBps: result.upBps,
				rttIdleMs: median(idleValues),
				rttLoadedMs: median(loadedValues),
				durationMs: result.endedAt - result.startedAt,
			};
			void this.pushSample(sample);
		} catch {
			this.speedtestProgress = { phase: 'error', error: msg().speedtestFailed };
			// Im Dauer-Modus scheitern Tests bei Funklöchern oft mehrfach; Meldung nur einmal anzeigen.
			if (!this.errors.includes(msg().speedtestFailed)) this.errors = [...this.errors, msg().speedtestFailed];
		} finally {
			this.speedtestRunning = false;
		}
	}

	private readStorage(): StoredTrip | null {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			return raw ? (JSON.parse(raw) as StoredTrip) : null;
		} catch {
			return null;
		}
	}

	private writeStorage(data: StoredTrip | null): void {
		if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		else localStorage.removeItem(STORAGE_KEY);
	}

	private connectSocketAndSync(): Promise<void> {
		return new Promise((resolve) => {
			let resolved = false;
			const finish = () => {
				if (resolved) return;
				resolved = true;
				resolve();
			};
			this.socket = new TrackerSocket({
				onStateChange: (s) => (this.wsState = s),
				onRtt: (rtt, seq) => this.handleRtt(rtt, seq),
				onClockOffset: (offset) => {
					this.clockOffsetMs = offset;
					finish();
				},
			});
			this.socket.connect();
			// Ohne Zeit-Sync innerhalb von 5s trotzdem starten (Offset 0, kein Blockieren der Fahrt).
			setTimeout(finish, 5000);
		});
	}

	private beginLocalState(stored: StoredTrip): void {
		const clockOffsetMs = this.clockOffsetMs ?? stored.clockOffsetMs;
		this.clockOffsetMs = clockOffsetMs;

		this.tripId = stored.tripId;
		this.trainType = stored.trainType;
		this.trainNumber = stored.trainNumber;
		this.startedAt = stored.startedAt;
		this.active = true;
		this.resumeAvailable = false;
		this.windowResults = [];
		this.rttHistory = [];
		this.lossPct60s = null;
		this.availabilityPct = null;
		this.errors = [];
		this.netHistory = [];
		this.lastEndedTripId = null;
		this.tripSamples = [];
		this.writeStorage({ ...stored, clockOffsetMs });

		this.windowAgg = new PingWindowAggregator((w) => this.handleWindow(w));
		this.windowAgg.start();

		this.geoTracker = new GeoTracker((s) => (this.geo = s));
		this.geoTracker.start();

		this.wakeLock = new WakeLockManager();
		void this.wakeLock.start();

		this.netWhoami = new NetWhoami((s) => {
			this.net = {
				label: s.label,
				asName: s.asName,
				asn: s.token?.asn ?? null,
				ipVersion: s.token?.ipVersion ?? null,
				connType: s.connType,
				effectiveType: s.effectiveType,
			};
			this.recentNetToken = s.token;
			this.recordNetHistory(s.token?.asn ?? null, s.asName);
		});
		this.netWhoami.start();

		this.probeRunner = new ProbeRunner((r) => {
			this.captive = r.captive;
			void this.pushSample(this.makeProbeSample(r));
		});
		this.probeRunner.start();

		window.addEventListener('beforeunload', this.onBeforeUnload);
	}

	private readonly onBeforeUnload = (e: BeforeUnloadEvent): void => {
		if (this.active) {
			e.preventDefault();
			e.returnValue = '';
		}
	};

	private handleRtt(rttMs: number, seq: number): void {
		this.currentRtt = rttMs;
		this.windowAgg?.addRtt(rttMs, seq);
		this.rttHistory = [...this.rttHistory.slice(-(RTT_HISTORY_MAX - 1)), { t: Date.now(), rtt: rttMs }];
	}

	private handleWindow(w: WindowResult): void {
		this.windowResults.push(w);
		this.jitterMs = w.jitterMs;

		const recent = this.windowResults.slice(-WINDOWS_PER_60S);
		const n = recent.reduce((a, r) => a + r.n, 0);
		const lost = recent.reduce((a, r) => a + r.lost, 0);
		this.lossPct60s = n > 0 ? (100 * lost) / n : null;

		const withData = this.windowResults.filter((r) => r.n > r.lost).length;
		this.availabilityPct = this.windowResults.length > 0 ? (100 * withData) / this.windowResults.length : null;

		void this.pushSample(this.makePingSample(w));
	}

	/** Hält die letzten NET_HISTORY_MAX unterschiedlichen ASNs mit Erstauftreten fest (nur im RAM). */
	private recordNetHistory(asn: number | null, asName: string | null): void {
		if (asn === null) return;
		if (this.netHistory.some((e) => e.asn === asn)) return;
		this.netHistory = [...this.netHistory, { asn, asName, firstSeenAt: Date.now() }].slice(-NET_HISTORY_MAX);
	}

	private makeBase() {
		const pos = this.geoTracker?.samplePosition() ?? null;
		return {
			id: crypto.randomUUID(),
			ts: Date.now(),
			lat: pos?.lat ?? null,
			lon: pos?.lon ?? null,
			accuracyM: pos?.accuracyM ?? null,
			speedMps: pos?.speedMps ?? null,
			heading: pos?.heading ?? null,
			net: this.recentNetToken,
		};
	}

	private makePingSample(w: WindowResult): PingWindowSample {
		return {
			...this.makeBase(),
			kind: 'ping_window',
			n: w.n,
			lost: w.lost,
			rttMin: w.rttMin,
			rttMedian: w.rttMedian,
			rttP90: w.rttP90,
			rttMax: w.rttMax,
			jitterMs: w.jitterMs,
		};
	}

	private makeProbeSample(r: { httpMs: number | null; ok: boolean; captive: boolean }): ProbeSample {
		return { ...this.makeBase(), kind: 'probe', httpMs: r.httpMs, ok: r.ok, captive: r.captive };
	}

	private async pushSample(sample: Sample): Promise<void> {
		if (!this.tripId) return;
		this.tripSamples = [...this.tripSamples, liveSampleFromClient(sample)];
		await this.outbox.add(this.tripId, sample);
	}
}

export const tracker = new Tracker();
