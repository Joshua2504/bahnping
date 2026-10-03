/**
 * Minimale IP-Hilfsfunktionen. Es wird bewusst keine IP jemals geloggt oder dauerhaft
 * gespeichert – diese Funktionen werden nur lokal innerhalb eines Request-Handlers benutzt.
 */

export type ParsedIp = { version: 4; value: number } | { version: 6; value: bigint };

/** Parst eine IPv4-Punktnotation in eine 32-Bit-Zahl, oder `null` bei ungültiger Eingabe. */
export function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

/** Parst eine IPv6-Adresse (inkl. `::`-Kompression) in eine 128-Bit `bigint`. */
export function ipv6ToBigInt(ip: string): bigint | null {
  let head = ip;
  let tail = '';
  const doubleColon = ip.indexOf('::');
  if (doubleColon !== -1) {
    head = ip.slice(0, doubleColon);
    tail = ip.slice(doubleColon + 2);
    if (ip.indexOf('::', doubleColon + 1) !== -1) return null; // mehr als ein "::"
  }
  const headParts = head.length ? head.split(':') : [];
  const tailParts = tail.length ? tail.split(':') : [];

  // Eingebettetes IPv4 am Ende (z.B. "::ffff:127.0.0.1")
  let tailLast: string[] = [];
  if (tailParts.length && tailParts[tailParts.length - 1].includes('.')) {
    const v4 = ipv4ToNumber(tailParts[tailParts.length - 1]);
    if (v4 === null) return null;
    tailLast = [((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16)];
    tailParts.pop();
  }
  const presentCount = headParts.length + tailParts.length + tailLast.length;
  if (doubleColon === -1 && presentCount !== 8) return null;
  const fillCount = doubleColon !== -1 ? 8 - presentCount : 0;
  if (fillCount < 0) return null;
  const full =
    doubleColon !== -1
      ? [...headParts, ...Array(fillCount).fill('0'), ...tailParts, ...tailLast]
      : [...headParts, ...tailParts, ...tailLast];
  if (full.length !== 8) return null;
  let out = 0n;
  for (const g of full) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

/** Erkennt IPv4-gemappte IPv6-Adressen (`::ffff:a.b.c.d`) und liefert die eingebettete IPv4 zurück. */
export function unwrapMappedIpv4(ip: string): string | null {
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  return m ? m[1] : null;
}

export function parseIp(raw: string): ParsedIp | null {
  const ip = raw.trim();
  if (ip.includes(':')) {
    const mapped = unwrapMappedIpv4(ip);
    if (mapped) {
      const v4 = ipv4ToNumber(mapped);
      return v4 === null ? null : { version: 4, value: v4 };
    }
    const v6 = ipv6ToBigInt(ip);
    return v6 === null ? null : { version: 6, value: v6 };
  }
  const v4 = ipv4ToNumber(ip);
  return v4 === null ? null : { version: 4, value: v4 };
}

/** Private/Loopback/Link-Local-Bereiche (RFC 1918, RFC 4193, RFC 3927/4291). */
export function isPrivateIp(parsed: ParsedIp): boolean {
  if (parsed.version === 4) {
    const ip = parsed.value;
    const a = (ip >>> 24) & 0xff;
    const b = (ip >>> 16) & 0xff;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (ip === 0) return true;
    return false;
  }
  const ip = parsed.value;
  if (ip === 1n) return true; // ::1
  const top16 = ip >> 112n;
  if (top16 === 0n) return true; // "::" bzw. v4-kompatibel/leer
  const top8 = ip >> 120n;
  if (top8 >= 0xfcn && top8 <= 0xfdn) return true; // fc00::/7 (ULA)
  if (top16 >= 0xfe80n && top16 <= 0xfebfn) return true; // fe80::/10 (link-local)
  return false;
}
