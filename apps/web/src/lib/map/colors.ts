// Gemeinsame Farbskalen für Karten (/map, /trips/[id], /track), damit RTT/Verlust überall gleich
// aussehen. `step`-Ausdrücke erwarten das Property "rtt" bzw. "value" je nach Aufrufer, siehe unten.
import type { ExpressionSpecification } from 'maplibre-gl';

/** RTT in ms → Farbe, als MapLibre-Expression über ein beliebiges numerisches Property. */
export function rttColorExpression(property: string): ExpressionSpecification {
	return ['step', ['get', property], '#22c55e', 80, '#eab308', 200, '#f97316', 500, '#ef4444'];
}

/** Feste Stufen für die RTT-Legende (ms, Farbe), konsistent mit {@link rttColorExpression}. */
export const RTT_LEGEND: { color: string; label: string }[] = [
	{ color: '#22c55e', label: '< 80 ms' },
	{ color: '#eab308', label: '< 200 ms' },
	{ color: '#f97316', label: '< 500 ms' },
	{ color: '#ef4444', label: '≥ 500 ms' },
];

/** Farbe für 100% Paketverlust (schwarz/rot), unabhängig von der RTT-Farbe. */
export const FULL_LOSS_COLOR = '#ef4444';
export const FULL_LOSS_STROKE = '#000000';

/** Einfache RTT-Farbe als Hex-String für Nicht-MapLibre-Kontexte (z.B. Marker-Styling). */
export function rttColor(rttMs: number | null): string {
	if (rttMs === null) return '#64748b';
	if (rttMs < 80) return '#22c55e';
	if (rttMs < 200) return '#eab308';
	if (rttMs < 500) return '#f97316';
	return '#ef4444';
}

/**
 * Tempo-Skala (km/h): kühl (langsam) → hell (schnell). Bewusst andere Farben als die RTT-Ampel,
 * damit beide Kartenmodi nicht verwechselt werden.
 */
const SPEED_STOPS: [number, string][] = [
	[0, '#64748b'],
	[60, '#a855f7'],
	[140, '#3b82f6'],
	[220, '#06b6d4'],
	[300, '#a7f3d0'],
];

/** km/h → Farbe als MapLibre-Expression (lineare Interpolation über {@link SPEED_STOPS}). */
export function speedColorExpression(property: string): ExpressionSpecification {
	return ['interpolate', ['linear'], ['get', property], ...SPEED_STOPS.flat()] as unknown as ExpressionSpecification;
}

/** CSS-Verlauf für die Tempo-Legende, konsistent mit {@link speedColorExpression}. */
export const SPEED_GRADIENT = `linear-gradient(90deg, ${SPEED_STOPS.map(([v, c]) => `${c} ${(v / 300) * 100}%`).join(', ')})`;

/** Farbe der Speedtest-Markierungen (Ring an der Strecke, Badge daneben). */
export const SPEEDTEST_COLOR = '#38bdf8';
