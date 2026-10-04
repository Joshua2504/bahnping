import { describe, expect, it } from 'vitest';
import { normalizeTrainNumber } from './trainNumber.js';

describe('normalizeTrainNumber', () => {
  it('entfernt Gattungskürzel', () => {
    expect(normalizeTrainNumber('ICE 1077')).toBe('1077');
    expect(normalizeTrainNumber('ice1077')).toBe('1077');
    expect(normalizeTrainNumber('RE 7')).toBe('7');
    expect(normalizeTrainNumber('S 8')).toBe('8');
  });
  it('lässt reine Nummern und Linien ohne Ziffer unverändert', () => {
    expect(normalizeTrainNumber('1077')).toBe('1077');
    expect(normalizeTrainNumber('S-Bahn')).toBe('S-Bahn');
  });
  it('liefert null für leere Werte', () => {
    expect(normalizeTrainNumber('  ')).toBeNull();
    expect(normalizeTrainNumber(undefined)).toBeNull();
  });
});
