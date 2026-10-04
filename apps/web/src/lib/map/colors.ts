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
