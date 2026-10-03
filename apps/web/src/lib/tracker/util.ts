// Kleine Statistik-Helfer für Ping-Fenster und Speedtest-Auswertung.

/** Median einer Zahlenliste, `null` wenn leer. */
export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Perzentil (0–100) einer Zahlenliste, `null` wenn leer. */
export function percentile(values: readonly number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[idx];
}

/** Mittlere absolute Differenz aufeinanderfolgender Werte (RFC-3550-Jitter-Stil). */
export function meanAbsDiff(values: readonly number[]): number | null {
	if (values.length < 2) return null;
	let sum = 0;
	for (let i = 1; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
	return sum / (values.length - 1);
}
