// Verdichtet Server-Pings zu WINDOW_MS-Fenstern (siehe docs/API.md / PLANUNG.md 6.3).
// Läuft unabhängig vom WS-Status weiter: ohne empfangene RTTs gilt ein Fenster als komplett verloren.
//
// Verlust wird über die Sequenznummern der Server-Pings gezählt, nicht über eine erwartete Anzahl je
// Fenster: Pings kommen jede Sekunde, Fenster werden alle WINDOW_MS geschnitten – durch Timer-Drift
// landen mal 4, mal 6 Antworten in einem Fenster, was fälschlich als Verlust zählen würde. Stattdessen:
// n = Anzahl Sequenznummern, die der Server seit der letzten empfangenen Antwort des Vorfensters
// vergeben hat; lost = n − empfangen. Ein Fenster ganz ohne Antwort zählt als komplett verloren
// (EXPECTED_PINGS_PER_WINDOW) und schiebt den Zähler virtuell weiter, damit die Lücke beim nächsten
// Fenster nicht doppelt zählt. Nach einem Reconnect (Sequenz springt zurück) zählt nur die Lücke
// innerhalb des Fensters. Exakt wie stats.Aggregator in der CLI (tools/cli/internal/stats/window.go).
import { PING_INTERVAL_MS, WINDOW_MS } from '@bahn/shared';
import { meanAbsDiff, median, percentile } from './util.js';

export interface WindowResult {
	n: number;
	lost: number;
	rttMin: number | null;
	rttMedian: number | null;
	rttP90: number | null;
	rttMax: number | null;
	jitterMs: number | null;
}

/** Erwartete Anzahl Pings je Fenster (WINDOW_MS / PING_INTERVAL_MS). */
export const EXPECTED_PINGS_PER_WINDOW = Math.round(WINDOW_MS / PING_INTERVAL_MS);

export class PingWindowAggregator {
	private rtts: number[] = [];
	private minSeq = 0;
	private maxSeq = 0;
	/** Letzte empfangene Sequenznummer des Vorfensters, -1 = keine Vorgeschichte. */
	private prevLast = -1;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly onWindow: (result: WindowResult) => void) {}

	start(): void {
		this.rtts = [];
		this.prevLast = -1;
		this.timer = setInterval(() => this.flush(), WINDOW_MS);
	}

	/**
	 * Beendet das letzte (unvollständige) Fenster sofort. Ohne eine einzige Antwort darin wird es
	 * verworfen – ein Sekundenbruchteil ohne Ping ist kein Verlust.
	 */
	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		if (this.rtts.length > 0) this.flush();
	}

	addRtt(rttMs: number, seq: number): void {
		if (this.rtts.length === 0 || seq < this.minSeq) this.minSeq = seq;
		if (this.rtts.length === 0 || seq > this.maxSeq) this.maxSeq = seq;
		this.rtts.push(rttMs);
	}

	private flush(): void {
		const rtts = this.rtts;
		const { minSeq, maxSeq } = this;
		this.rtts = [];
		const received = rtts.length;
		let n: number;
		if (received === 0) {
			n = EXPECTED_PINGS_PER_WINDOW;
			if (this.prevLast >= 0) this.prevLast += EXPECTED_PINGS_PER_WINDOW;
		} else if (this.prevLast < 0 || maxSeq < this.prevLast) {
			n = maxSeq - minSeq + 1;
			this.prevLast = maxSeq;
		} else {
			n = maxSeq - this.prevLast;
			this.prevLast = maxSeq;
		}
		n = Math.max(n, received);
		const lost = n - received;

		this.onWindow({
			n,
			lost,
			rttMin: rtts.length ? Math.min(...rtts) : null,
			rttMedian: median(rtts),
			rttP90: percentile(rtts, 90),
			rttMax: rtts.length ? Math.max(...rtts) : null,
			jitterMs: meanAbsDiff(rtts),
		});
	}
}
