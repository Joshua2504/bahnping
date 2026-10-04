/**
 * Entfernt ein vorangestelltes Gattungskürzel aus der Zugnummer ("ICE 1077" → "1077"), weil die
 * Gattung separat als trainType gespeichert und in der Anzeige wieder vorangestellt wird.
 */
const PREFIX = /^(ICE|ECE|EC|IC|IRE|RE|RB|S|FLX|NJ|EN|RJX?)\s*(?=\d)/i;

export function normalizeTrainNumber(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;
  return trimmed.replace(PREFIX, '');
}
