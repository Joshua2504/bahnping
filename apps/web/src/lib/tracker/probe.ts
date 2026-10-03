// Captive-Portal-Erkennung über GET /api/net/probe (fester erwarteter Body).
import { PROBE_BODY, PROBE_INTERVAL_MS } from '@bahn/shared';

export interface ProbeResult {
	httpMs: number | null;
	ok: boolean;
	captive: boolean;
}

export class ProbeRunner {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly onResult: (result: ProbeResult) => void) {}

	start(): void {
		void this.probe();
		this.timer = setInterval(() => void this.probe(), PROBE_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
	}

	private async probe(): Promise<void> {
		const t0 = performance.now();
		try {
			// Cache-Buster per Query, der Server antwortet ohnehin mit Cache-Control: no-store.
			const res = await fetch(`/api/net/probe?t=${Date.now()}`, { cache: 'no-store', redirect: 'manual' });
			const httpMs = performance.now() - t0;

			if (res.type === 'opaqueredirect') {
				// Redirect auf eine Portal-Login-Seite ist das typische Captive-Portal-Verhalten.
				this.onResult({ httpMs, ok: false, captive: true });
				return;
			}

			const text = await res.text();
			const ok = res.status === 200 && text === PROBE_BODY;
			this.onResult({ httpMs, ok, captive: !ok });
		} catch {
			this.onResult({ httpMs: null, ok: false, captive: false });
		}
	}
}
