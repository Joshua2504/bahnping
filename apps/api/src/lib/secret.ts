import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from './hmac.js';

const IV_LENGTH = 12;

/**
 * Verschlüsselt ein Geheimnis (z.B. SMTP-Passwort) mit AES-256-GCM. Der Schlüssel wird
 * zweckgebunden aus APP_SECRET abgeleitet (siehe `deriveKey`), damit ein Leak dieses
 * Zwecks nicht automatisch andere HMAC-Verwendungen (ALTCHA, net-token, ...) kompromittiert.
 * Format der Rückgabe: `base64url(iv).base64url(authTag).base64url(ciphertext)`.
 */
export function encryptSecret(appSecret: string, plain: string): string {
  const key = deriveKey(appSecret, 'smtp-password');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/** Entschlüsselt ein mit `encryptSecret` erzeugtes Geheimnis. Wirft bei Manipulation/falschem Schlüssel. */
export function decryptSecret(appSecret: string, encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 3) throw new Error('Ungültiges Geheimnis-Format');
  const [ivPart, tagPart, ciphertextPart] = parts;
  const key = deriveKey(appSecret, 'smtp-password');
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(ciphertextPart, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
