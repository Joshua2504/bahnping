// Download-/Upload-Durchsatztest gegen /api/speed/* (siehe docs/API.md, PLANUNG.md 6.4).
// RTT (idle/loaded) wird NICHT hier gemessen, sondern vom Aufrufer aus der WS-RTT-Historie
// anhand von startedAt/endedAt berechnet.
import { SPEEDTEST_DURATION_MS, SPEEDTEST_MAX_BYTES, SPEEDTEST_STREAMS } from '@bahn/shared';
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
/** Größe je Request. Streams fordern so lange neue Blöcke an, bis die Testdauer um ist. */
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
		const bps = counter.bps();
		onBps(bps);
		return bps;
	}

	private take(budget: { left: number }): number {
		const n = Math.min(CHUNK_BYTES, budget.left);
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

	private async uploadLoop(counter: Counter, deadline: number, budget: { left: number }): Promise<void> {
		while (performance.now() < deadline) {
			const n = this.take(budget);
			if (n <= 0) break;
			await this.uploadOnce(counter, deadline, this.blob().slice(0, n));
		}
	}

	private uploadOnce(counter: Counter, deadline: number, body: Blob): Promise<void> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			let previousLoaded = 0;
			const timeout = setTimeout(() => {
				try {
					xhr.abort();
				} catch {
					// bereits beendet
				}
			}, Math.max(0, deadline - performance.now()));
			xhr.upload.addEventListener('progress', (e) => {
				counter.add(e.loaded - previousLoaded);
				previousLoaded = e.loaded;
			});
			xhr.addEventListener('loadend', () => {
				clearTimeout(timeout);
				resolve();
			});
			xhr.open('POST', '/api/speed/up');
			xhr.setRequestHeader('content-type', 'application/octet-stream');
			xhr.send(body);
		});
	}

	/** Ein 4-MiB-Blob aus wiederholten 256-KiB-Zufallsblöcken, einmal pro Runner erzeugt. */
	private blob(): Blob {
		if (!this.uploadBlob) {
			const piece = new Uint8Array(256 * 1024);
			for (let o = 0; o < piece.length; o += 65_536) crypto.getRandomValues(piece.subarray(o, o + 65_536));
			this.uploadBlob = new Blob(Array.from({ length: CHUNK_BYTES / piece.length }, () => piece));
		}
		return this.uploadBlob;
	}
}
