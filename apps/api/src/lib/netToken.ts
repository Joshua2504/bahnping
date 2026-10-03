import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NetClass } from '@bahn/shared';
import { deriveKey } from './hmac.js';

export interface NetTokenPayload {
  asn: number;
  netClass: NetClass;
  ipVersion: 4 | 6 | null;
  exp: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function message(p: Omit<NetTokenPayload, never>): string {
  return `${p.asn}|${p.netClass}|${p.ipVersion ?? ''}|${p.exp}`;
}

/** Signiert die Netz-Klassifizierung mit einem von APP_SECRET abgeleiteten Schlüssel. */
export function signNetToken(appSecret: string, payload: NetTokenPayload): string {
  const key = deriveKey(appSecret, 'net-token');
  const mac = createHmac('sha256', key).update(message(payload)).digest();
  return base64url(mac);
}

/** Verifiziert eine Signatur zeitkonstant. Prüft NICHT, ob `exp` abgelaufen ist (Offline-Uploads sind erlaubt). */
export function verifyNetToken(appSecret: string, payload: NetTokenPayload, sig: string): boolean {
  const expected = signNetToken(appSecret, payload);
  const a = Buffer.from(expected);
  let b: Buffer;
  try {
    b = Buffer.from(sig);
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
