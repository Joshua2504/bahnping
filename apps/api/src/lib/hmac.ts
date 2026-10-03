import { createHmac } from 'node:crypto';

/**
 * Leitet aus APP_SECRET einen zweckgebundenen Schlüssel ab, damit ein Leak eines
 * Verwendungszwecks (z.B. ALTCHA) nicht automatisch die anderen (z.B. net-token) kompromittiert.
 */
export function deriveKey(appSecret: string, purpose: string): Buffer {
  return createHmac('sha256', appSecret).update(purpose).digest();
}

export function deriveKeyHex(appSecret: string, purpose: string): string {
  return deriveKey(appSecret, purpose).toString('hex');
}
