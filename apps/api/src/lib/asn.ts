import { gunzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { sql } from 'drizzle-orm';
import { ASN_SEED, type NetClass } from '@bahn/shared';
import type { Db } from '../db/client.js';
import { asnCatalog } from '../db/schema.js';
import { parseIp, isPrivateIp, type ParsedIp } from './ip.js';

interface RangeV4 {
  start: number;
  end: number;
  asn: number;
  name: string;
}
interface RangeV6 {
  start: bigint;
  end: bigint;
  asn: number;
  name: string;
}

export interface AsnLookupResult {
  asn: number;
  ipVersion: 4 | 6;
  asName: string;
  isPrivate: boolean;
}

export interface ClassEntry {
  netClass: NetClass;
  name: string;
}

/**
 * Hält die ASN-Bereichstabellen (aus iptoasn.com, IPv4+IPv6 getrennt, binäre Suche) sowie die
 * ASN→Netzklasse-Zuordnung (aus `asn_catalog`) im Speicher. Die IP selbst wird nirgends abgelegt.
 */
export class AsnService {
  private v4: RangeV4[] = [];
  private v6: RangeV6[] = [];
  private classMap = new Map<number, ClassEntry>();

  get rangeCount(): number {
    return this.v4.length + this.v6.length;
  }

  /** Lädt die iptoasn-TSV (gzip) per HTTP; bei Fehler Fallback auf Cache-Datei; sonst leere Tabelle. */
  async loadRanges(url: string | undefined, cachePath: string, log?: FastifyBaseLogger): Promise<void> {
    let gz: Buffer | undefined;
    if (url) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        gz = Buffer.from(await res.arrayBuffer());
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, gz);
      } catch (err) {
        log?.warn({ err: String(err) }, 'ASN-Download fehlgeschlagen, versuche Cache');
      }
    }
    if (!gz) {
      try {
        gz = await readFile(cachePath);
      } catch {
        log?.warn('Kein ASN-Cache vorhanden, starte mit leerer Tabelle');
        this.v4 = [];
        this.v6 = [];
        return;
      }
    }
    try {
      const tsv = gunzipSync(gz).toString('utf8');
      this.parseTsv(tsv);
      log?.info({ v4: this.v4.length, v6: this.v6.length }, 'ASN-Tabelle geladen');
    } catch (err) {
      log?.warn({ err: String(err) }, 'ASN-Tabelle konnte nicht gelesen werden, bleibt leer');
      this.v4 = [];
      this.v6 = [];
    }
  }

  private parseTsv(tsv: string): void {
    const v4: RangeV4[] = [];
    const v6: RangeV6[] = [];
    for (const line of tsv.split('\n')) {
      if (!line) continue;
      const cols = line.split('\t');
      if (cols.length < 5) continue;
      const [rangeStart, rangeEnd, asStr, , name] = cols;
      const asn = Number(asStr);
      if (!Number.isFinite(asn) || asn === 0) continue;
      if (rangeStart.includes(':')) {
        const start = parseIp(rangeStart);
        const end = parseIp(rangeEnd);
        if (start?.version === 6 && end?.version === 6) {
          v6.push({ start: start.value, end: end.value, asn, name: name?.trim() ?? '' });
        }
      } else {
        const start = parseIp(rangeStart);
        const end = parseIp(rangeEnd);
        if (start?.version === 4 && end?.version === 4) {
          v4.push({ start: start.value, end: end.value, asn, name: name?.trim() ?? '' });
        }
      }
    }
    v4.sort((a, b) => a.start - b.start);
    v6.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    this.v4 = v4;
    this.v6 = v6;
  }

  /** Binäre Suche nach dem Bereich, der `value` enthält (Ranges sind lückenhaft aber sortiert & nicht überlappend). */
  private static search<T extends { start: number | bigint; end: number | bigint }>(
    ranges: T[],
    value: number | bigint,
  ): T | null {
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = ranges[mid];
      if (value < r.start) hi = mid - 1;
      else if (value > r.end) lo = mid + 1;
      else return r;
    }
    return null;
  }

  /** Reiner Range-Lookup ohne Netzklasse (für Tests / Entkopplung von der DB). */
  lookupRange(ip: string): AsnLookupResult | null {
    const parsed = parseIp(ip);
    if (!parsed) return null;
    if (isPrivateIp(parsed)) {
      return { asn: 0, ipVersion: parsed.version, asName: '', isPrivate: true };
    }
    if (parsed.version === 4) {
      const hit = AsnService.search(this.v4, parsed.value);
      return { asn: hit?.asn ?? 0, ipVersion: 4, asName: hit?.name ?? '', isPrivate: false };
    }
    const hit = AsnService.search(this.v6, parsed.value);
    return { asn: hit?.asn ?? 0, ipVersion: 6, asName: hit?.name ?? '', isPrivate: false };
  }

  classify(asn: number): ClassEntry {
    return this.classMap.get(asn) ?? { netClass: 'unknown', name: '' };
  }

  async loadClassMap(db: Db): Promise<void> {
    const rows = await db.select().from(asnCatalog);
    const map = new Map<number, ClassEntry>();
    for (const row of rows) {
      map.set(row.asn, { netClass: row.netClass as NetClass, name: row.name });
    }
    this.classMap = map;
  }

  /** Spielt ASN_SEED + NETCLASS_OVERRIDES (Format "asn:klasse,asn:klasse") in asn_catalog ein. */
  async seedClassMap(db: Db, overridesRaw: string, log?: FastifyBaseLogger): Promise<void> {
    for (const entry of ASN_SEED) {
      await db
        .insert(asnCatalog)
        .values({ asn: entry.asn, name: entry.name, netClass: entry.netClass, source: 'seed' })
        .onConflictDoUpdate({
          target: asnCatalog.asn,
          set: { name: entry.name, netClass: entry.netClass, source: 'seed' },
        });
    }
    const overrides = parseOverrides(overridesRaw, log);
    for (const { asn, netClass } of overrides) {
      await db
        .insert(asnCatalog)
        .values({ asn, name: `ASN ${asn}`, netClass, source: 'override' })
        .onConflictDoUpdate({ target: asnCatalog.asn, set: { netClass, source: 'override' } });
    }
    await this.loadClassMap(db);
  }

  /** Zählt eine Sichtung; legt unbekannte ASNs mit Klasse `unknown` an (für spätere Admin-Review). */
  async recordSeen(db: Db, asn: number, fallbackName: string): Promise<void> {
    if (asn === 0) return;
    await db
      .insert(asnCatalog)
      .values({ asn, name: fallbackName || `ASN ${asn}`, netClass: 'unknown', source: 'auto', seen: 1 })
      .onConflictDoUpdate({ target: asnCatalog.asn, set: { seen: sql`${asnCatalog.seen} + 1` } });
  }
}

function parseOverrides(raw: string, log?: FastifyBaseLogger): { asn: number; netClass: NetClass }[] {
  const out: { asn: number; netClass: NetClass }[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [asnStr, netClass] = trimmed.split(':');
    const asn = Number(asnStr);
    if (!Number.isFinite(asn) || !netClass) {
      log?.warn({ part: trimmed }, 'Ungültiger NETCLASS_OVERRIDES-Eintrag übersprungen');
      continue;
    }
    out.push({ asn, netClass: netClass.trim() as NetClass });
  }
  return out;
}
