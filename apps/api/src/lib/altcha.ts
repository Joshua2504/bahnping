import { createChallenge, verifySolution } from 'altcha-lib';
import type { Challenge } from 'altcha-lib/types';
import { deriveKeyHex } from './hmac.js';

const CHALLENGE_TTL_MS = 10 * 60_000;

/** Verbrauchte Challenges (Replay-Schutz), Ablauf über `expires`-Timestamp. */
const usedChallenges = new Map<string, number>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [challenge, expires] of usedChallenges) {
    if (expires < now) usedChallenges.delete(challenge);
  }
}

export async function createAltchaChallenge(appSecret: string): Promise<Challenge> {
  const hmacKey = deriveKeyHex(appSecret, 'altcha');
  return createChallenge({
    hmacKey,
    maxNumber: 100_000,
    expires: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/** Prüft Signatur/Lösung sowie Ablauf und verhindert Mehrfachverwendung derselben Challenge. */
export async function verifyAltchaSolution(appSecret: string, payload: string): Promise<boolean> {
  const hmacKey = deriveKeyHex(appSecret, 'altcha');
  let ok: boolean;
  try {
    ok = await verifySolution(payload, hmacKey, true);
  } catch {
    return false;
  }
  if (!ok) return false;

  let challengeId: string;
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) : payload;
    challengeId = String(parsed.challenge);
  } catch {
    return false;
  }
  sweepExpired();
  if (usedChallenges.has(challengeId)) return false;
  usedChallenges.set(challengeId, Date.now() + CHALLENGE_TTL_MS);
  return true;
}
