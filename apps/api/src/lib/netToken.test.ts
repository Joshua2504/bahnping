import { describe, expect, it } from 'vitest';
import { signNetToken, verifyNetToken } from './netToken.js';

const SECRET = 'a'.repeat(32);

describe('netToken', () => {
  it('signiert und verifiziert ein gültiges Token', () => {
    const payload = { asn: 3320, netClass: 'mobile_telekom' as const, ipVersion: 4 as const, exp: 1_700_000_000_000 };
    const sig = signNetToken(SECRET, payload);
    expect(verifyNetToken(SECRET, payload, sig)).toBe(true);
  });

  it('lehnt eine falsche Signatur ab', () => {
    const payload = { asn: 3320, netClass: 'mobile_telekom' as const, ipVersion: 4 as const, exp: 1_700_000_000_000 };
    expect(verifyNetToken(SECRET, payload, 'Zm9vYmFyYmF6cXV1eA')).toBe(false);
  });

  it('lehnt ein verändertes Payload ab (gleiche Signatur, anderer asn)', () => {
    const payload = { asn: 3320, netClass: 'mobile_telekom' as const, ipVersion: 4 as const, exp: 1_700_000_000_000 };
    const sig = signNetToken(SECRET, payload);
    const tampered = { ...payload, asn: 9999 };
    expect(verifyNetToken(SECRET, tampered, sig)).toBe(false);
  });

  it('ist weiterhin gültig, auch wenn exp in der Vergangenheit liegt (Offline-Upload)', () => {
    const payload = { asn: 0, netClass: 'private' as const, ipVersion: null, exp: 1 };
    const sig = signNetToken(SECRET, payload);
    expect(verifyNetToken(SECRET, payload, sig)).toBe(true);
  });

  it('erzeugt unterschiedliche Signaturen für unterschiedliche Zwecke/Schlüssel', () => {
    const payload = { asn: 1, netClass: 'unknown' as const, ipVersion: null, exp: 0 };
    const sigA = signNetToken(SECRET, payload);
    const sigB = signNetToken('b'.repeat(32), payload);
    expect(sigA).not.toBe(sigB);
  });
});
