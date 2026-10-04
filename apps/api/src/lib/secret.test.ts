import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './secret.js';

const SECRET = 'a'.repeat(32);

describe('secret (AES-256-GCM)', () => {
  it('verschlüsselt und entschlüsselt ein Passwort (Roundtrip)', () => {
    const enc = encryptSecret(SECRET, 'geheimes-passwort');
    expect(enc).not.toContain('geheimes-passwort');
    expect(decryptSecret(SECRET, enc)).toBe('geheimes-passwort');
  });

  it('erzeugt bei jedem Aufruf einen anderen IV (unterschiedliches Ciphertext)', () => {
    const a = encryptSecret(SECRET, 'passwort');
    const b = encryptSecret(SECRET, 'passwort');
    expect(a).not.toBe(b);
  });

  it('erkennt eine Manipulation am Ciphertext (Auth-Tag schlägt fehl)', () => {
    const enc = encryptSecret(SECRET, 'passwort');
    const [iv, tag, ciphertext] = enc.split('.');
    const tampered = `${iv}.${tag}.${ciphertext.slice(0, -2)}${ciphertext.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
    expect(() => decryptSecret(SECRET, tampered)).toThrow();
  });

  it('erkennt eine Manipulation am Auth-Tag', () => {
    const enc = encryptSecret(SECRET, 'passwort');
    const [iv, tag, ciphertext] = enc.split('.');
    const tamperedTag = tag.slice(0, -2) + (tag.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(() => decryptSecret(SECRET, `${iv}.${tamperedTag}.${ciphertext}`)).toThrow();
  });

  it('lehnt ein falsches Geheimnis (anderer APP_SECRET) ab', () => {
    const enc = encryptSecret(SECRET, 'passwort');
    expect(() => decryptSecret('b'.repeat(32), enc)).toThrow();
  });

  it('lehnt ein kaputtes Format ab', () => {
    expect(() => decryptSecret(SECRET, 'nicht-das-richtige-format')).toThrow();
  });
});
