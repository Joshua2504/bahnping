import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export function createMailer(cfg: Config): Transporter {
  return nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: false,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
  });
}

const RATE_LIMIT_WINDOW_MS = 60 * 60_000;
const RATE_LIMIT_MAX = 3;
/** E-Mail (lowercased) -> Zeitstempel der letzten Sendeversuche, nur im RAM. */
const sendLog = new Map<string, number[]>();

/** Liefert `true`, wenn für diese Adresse noch eine Mail in dieser Stunde gesendet werden darf. */
export function allowMagicLinkSend(email: string): boolean {
  const key = email.toLowerCase();
  const now = Date.now();
  const recent = (sendLog.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    sendLog.set(key, recent);
    return false;
  }
  recent.push(now);
  sendLog.set(key, recent);
  return true;
}

export async function sendMagicLinkMail(
  mailer: Transporter,
  from: string,
  to: string,
  confirmUrl: string,
): Promise<void> {
  const text = `Hallo,\n\nmit diesem Link meldest du dich beim Bahn-Netzwerk-Tracker an:\n${confirmUrl}\n\nDer Link ist 15 Minuten gültig und kann nur einmal verwendet werden.\nWenn du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.\n`;
  const html = `<p>Hallo,</p><p>mit diesem Link meldest du dich beim Bahn-Netzwerk-Tracker an:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.</p><p>Wenn du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.</p>`;
  await mailer.sendMail({
    from,
    to,
    subject: 'Anmeldung beim Bahn-Netzwerk-Tracker',
    text,
    html,
  });
}
