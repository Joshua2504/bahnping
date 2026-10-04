import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { decryptSmtpPassword, loadSmtpSettings, transportOptionsForSecurity } from './smtpSettings.js';

const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

/**
 * Verwaltet den nodemailer-Transport. Normalerweise werden die SMTP-ENV-Variablen genutzt
 * (in der Testversion: Mailpit); Admins können in der DB-Einstellung "smtp" (`mode='custom'`)
 * einen eigenen SMTP-Server hinterlegen. `reload()` baut den Transport anhand der aktuellen
 * DB-Einstellung bzw. der ENV-Werte neu auf.
 */
export class MailService {
  private transporter: Transporter;
  private from: string;

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
  ) {
    this.transporter = envTransport(cfg);
    this.from = cfg.MAIL_FROM;
  }

  async reload(): Promise<void> {
    const stored = await loadSmtpSettings(this.db);
    if (stored && stored.mode === 'custom') {
      let password: string | null = null;
      try {
        password = decryptSmtpPassword(this.cfg.APP_SECRET, stored);
      } catch {
        // Passwort mit anderem APP_SECRET verschlüsselt (z.B. nach Rotation): nicht abstürzen,
        // sondern ohne Passwort weiter; im Admin-Bereich neu eintragen.
        console.warn('SMTP-Passwort nicht entschlüsselbar (APP_SECRET geändert?) – bitte im Admin-Bereich neu setzen');
      }
      this.transporter = nodemailer.createTransport({
        host: stored.host,
        port: stored.port,
        ...transportOptionsForSecurity(stored.security, stored.rejectUnauthorized),
        auth: stored.user ? { user: stored.user, pass: password ?? '' } : undefined,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
      });
      this.from = stored.from;
      return;
    }
    this.transporter = envTransport(this.cfg);
    this.from = this.cfg.MAIL_FROM;
  }

  getTransporter(): Transporter {
    return this.transporter;
  }

  getFrom(): string {
    return this.from;
  }

  async send(opts: Omit<SendMailOptions, 'from'>): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({ from: this.from, ...opts });
    return { messageId: String(info.messageId) };
  }
}

function envTransport(cfg: Config): Transporter {
  return nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: false,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
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

export async function sendMagicLinkMail(mail: MailService, to: string, confirmUrl: string): Promise<void> {
  const text = `Hallo,\n\nmit diesem Link meldest du dich bei BahnPing an:\n${confirmUrl}\n\nDer Link ist 15 Minuten gültig und kann nur einmal verwendet werden.\nWenn du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.\n`;
  const html = `<p>Hallo,</p><p>mit diesem Link meldest du dich bei BahnPing an:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.</p><p>Wenn du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.</p>`;
  await mail.send({
    to,
    subject: 'Anmeldung bei BahnPing',
    text,
    html,
  });
}
