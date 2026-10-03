// Verdichtet Server-Pings zu WINDOW_MS-Fenstern (siehe docs/API.md / PLANUNG.md 6.3).
// Läuft unabhängig vom WS-Status weiter: ohne empfangene RTTs gilt ein Fenster als komplett verloren.
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

/** Erwartete Anzahl Pings je Fenster (WINDOW_MS / PING_INTERVAL_MS = 5). */
export const EXPECTED_PINGS_PER_WINDOW = Math.round(WINDOW_MS / PING_INTERVAL_MS);

export class PingWindowAggregator {
	private rtts: number[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly onWindow: (result: WindowResult) => void) {}

	start(): void {
		this.rtts = [];
		this.timer = setInterval(() => this.flush(), WINDOW_MS);
	}

	/** Beendet das letzte (ggf. unvollständige) Fenster sofort. */
	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		this.flush();
	}

	addRtt(rttMs: number): void {
		this.rtts.push(rttMs);
	}

	private flush(): void {
		const rtts = this.rtts;
		this.rtts = [];
		const n = EXPECTED_PINGS_PER_WINDOW;
		const lost = Math.max(0, n - rtts.length);

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
