// Download-/Upload-Durchsatztest gegen /api/speed/* (siehe docs/API.md, PLANUNG.md 6.4).
// RTT (idle/loaded) wird NICHT hier gemessen, sondern vom Aufrufer aus der WS-RTT-Historie
// anhand von startedAt/endedAt berechnet.
import {
	SPEEDTEST_DURATION_MS,
	SPEEDTEST_MAX_BYTES,
	SPEEDTEST_STREAMS,
	SPEEDTEST_UP_CHUNK_MAX_BYTES,
	SPEEDTEST_UP_CHUNK_MIN_BYTES,
	SPEEDTEST_UP_CHUNK_START_BYTES,
	SPEEDTEST_UP_TARGET_MS,
} from '@bahn/shared';
import { api } from '../api.js';

export type SpeedtestPhase = 'quota' | 'download' | 'upload' | 'done' | 'error';

export interface SpeedtestProgress {
	phase: SpeedtestPhase;
	downBps?: number | null;
	upBps?: number | null;
	error?: string;
}

export interface SpeedtestResult {
	downBps: number | null;
	upBps: number | null;
	startedAt: number;
	endedAt: number;
}

/** Erste Sekunde (Verbindungsaufbau/Ramp-up) wird aus der Durchsatzberechnung ausgeschlossen. */
const RAMP_UP_MS = 1000;
/** Größe je Download-Request. Streams fordern so lange neue Blöcke an, bis die Testdauer um ist. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** Zählt Bytes getrennt nach Anlaufphase und Messphase und merkt sich den Zeitpunkt des letzten Bytes. */
class Counter {
	total = 0;
	measured = 0;
	lastByteAt = 0;
	constructor(readonly startTime: number) {}
	add(bytes: number): void {
		const now = performance.now();
		this.total += bytes;
		if (now - this.startTime >= RAMP_UP_MS) this.measured += bytes;
		this.lastByteAt = now;
	}
	/** Durchsatz in bit/s. Fällt auf die Gesamtzeit zurück, wenn nach der Anlaufphase nichts mehr kam. */
	bps(now = this.lastByteAt): number | null {
		const measuredS = (now - this.startTime - RAMP_UP_MS) / 1000;
		if (this.measured > 0 && measuredS > 0.2) return (this.measured * 8) / measuredS;
		const totalS = (now - this.startTime) / 1000;
		if (this.total > 0 && totalS > 0) return (this.total * 8) / totalS;
		return null;
	}
}

export class SpeedtestRunner {
	private uploadBlob: Blob | null = null;

	/** Wirft ApiError, wenn /api/speed/start fehlschlägt (z. B. nicht angemeldet). */
	async run(onProgress: (p: SpeedtestProgress) => void): Promise<SpeedtestResult> {
		onProgress({ phase: 'quota' });
		await api.speedStart();

		const startedAt = Date.now();
		onProgress({ phase: 'download' });
		const downBps = await this.measure('download', (bps) => onProgress({ phase: 'download', downBps: bps }));

		onProgress({ phase: 'upload', downBps });
		const upBps = await this.measure('upload', (bps) => onProgress({ phase: 'upload', downBps, upBps: bps }));

		const endedAt = Date.now();
		onProgress({ phase: 'done', downBps, upBps });
		return { downBps, upBps, startedAt, endedAt };
	}

	private async measure(direction: 'download' | 'upload', onBps: (bps: number | null) => void): Promise<number | null> {
		const counter = new Counter(performance.now());
		const deadline = counter.startTime + SPEEDTEST_DURATION_MS;
		/** Obergrenze je Richtung, damit ein Test nie mehr als SPEEDTEST_MAX_BYTES überträgt. */
		const budget = { left: SPEEDTEST_MAX_BYTES };
		const reportTimer = setInterval(() => onBps(counter.bps(performance.now())), 500);
		try {
			const streams = Array.from({ length: SPEEDTEST_STREAMS }, () =>
				direction === 'download' ? this.downloadLoop(counter, deadline, budget) : this.uploadLoop(counter, deadline, budget),
			);
			await Promise.allSettled(streams);
		} finally {
			clearInterval(reportTimer);
		}
		// Upload zählt nur bestätigte Blöcke; Zeitbasis ist die volle Testdauer, nicht der letzte Block.
		const bps = direction === 'upload' ? counter.bps(Math.min(performance.now(), deadline)) : counter.bps();
		onBps(bps);
		return bps;
	}

	private take(budget: { left: number }, size = CHUNK_BYTES): number {
		const n = Math.min(size, budget.left);
		budget.left -= n;
		return n;
	}

	private async downloadLoop(counter: Counter, deadline: number, budget: { left: number }): Promise<void> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()));
		try {
			while (performance.now() < deadline) {
				const n = this.take(budget);
				if (n <= 0) break;
				const res = await fetch(`/api/speed/down?bytes=${n}`, { cache: 'no-store', signal: controller.signal });
				const reader = res.body?.getReader();
				if (!reader) return;
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) counter.add(value.byteLength);
				}
			}
		} catch {
			// Abbruch nach Testdauer ist erwartet.
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Zählt nur Blöcke, die der Server bestätigt hat. xhr.upload.onprogress meldet, was im Puffer
	 * des Browsers/Betriebssystems liegt, nicht was angekommen ist – bei langsamem Uplink stark
	 * überhöht. Die Blockgröße passt sich an, damit ein Block etwa SPEEDTEST_UP_TARGET_MS dauert.
	 */
	private async uploadLoop(counter: Counter, deadline: number, budget: { left: number }): Promise<void> {
		let size = SPEEDTEST_UP_CHUNK_START_BYTES;
		while (performance.now() < deadline) {
			const n = this.take(budget, size);
			if (n <= 0) break;
			const reqStart = performance.now();
			if (!(await this.uploadOnce(deadline, this.blob().slice(0, n)))) break;
			counter.add(n);
			size = nextUpChunk(size, performance.now() - reqStart);
		}
	}

	/** true, wenn der Server den Block vollständig angenommen hat. */
	private uploadOnce(deadline: number, body: Blob): Promise<boolean> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			const timeout = setTimeout(() => {
				try {
					xhr.abort();
				} catch {
					// bereits beendet
				}
			}, Math.max(0, deadline - performance.now()));
			xhr.addEventListener('loadend', () => {
				clearTimeout(timeout);
				resolve(xhr.status >= 200 && xhr.status < 300);
			});
			xhr.open('POST', '/api/speed/up');
			xhr.setRequestHeader('content-type', 'application/octet-stream');
			xhr.send(body);
		});
	}

	/** Ein Blob (SPEEDTEST_UP_CHUNK_MAX_BYTES) aus wiederholten 256-KiB-Zufallsblöcken, einmal pro Runner erzeugt. */
	private blob(): Blob {
		if (!this.uploadBlob) {
			const piece = new Uint8Array(256 * 1024);
			for (let o = 0; o < piece.length; o += 65_536) crypto.getRandomValues(piece.subarray(o, o + 65_536));
			this.uploadBlob = new Blob(Array.from({ length: SPEEDTEST_UP_CHUNK_MAX_BYTES / piece.length }, () => piece));
		}
		return this.uploadBlob;
	}
}

/** Skaliert die Upload-Blockgröße Richtung SPEEDTEST_UP_TARGET_MS, höchstens Faktor 2 je Schritt. */
export function nextUpChunk(size: number, tookMs: number): number {
	let next = tookMs > 0 ? Math.min(Math.round((size * SPEEDTEST_UP_TARGET_MS) / tookMs), size * 2) : size * 2;
	next = Math.max(next, Math.floor(size / 2));
	return Math.min(Math.max(next, SPEEDTEST_UP_CHUNK_MIN_BYTES), SPEEDTEST_UP_CHUNK_MAX_BYTES);
}
