import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AsnService } from './asn.js';
import { ipv4ToNumber, ipv6ToBigInt, isPrivateIp, parseIp } from './ip.js';

const SAMPLE_TSV = [
  ['1.1.1.0', '1.1.1.255', '13335', 'US', 'Cloudflare, Inc.'],
  ['3.0.0.0', '3.255.255.255', '16509', 'US', 'Amazon.com, Inc.'],
  ['2606:4700::', '2606:4700:ffff:ffff:ffff:ffff:ffff:ffff', '13335', 'US', 'Cloudflare, Inc.'],
]
  .map((cols) => cols.join('\t'))
  .join('\n');

describe('ip-Parsing', () => {
  it('parst IPv4', () => {
    expect(ipv4ToNumber('1.1.1.1')).toBe((1 << 24) + (1 << 16) + (1 << 8) + 1);
    expect(ipv4ToNumber('999.1.1.1')).toBeNull();
  });

  it('parst IPv6 inkl. "::"-Kompression', () => {
    expect(ipv6ToBigInt('::1')).toBe(1n);
    expect(ipv6ToBigInt('2606:4700::1')).not.toBeNull();
  });

  it('erkennt IPv4-gemappte IPv6-Adressen', () => {
    const parsed = parseIp('::ffff:127.0.0.1');
    expect(parsed).toEqual({ version: 4, value: ipv4ToNumber('127.0.0.1') });
  });

  it('erkennt private/loopback/link-local Adressen', () => {
    expect(isPrivateIp(parseIp('10.1.2.3')!)).toBe(true);
    expect(isPrivateIp(parseIp('192.168.1.1')!)).toBe(true);
    expect(isPrivateIp(parseIp('127.0.0.1')!)).toBe(true);
    expect(isPrivateIp(parseIp('8.8.8.8')!)).toBe(false);
    expect(isPrivateIp(parseIp('::1')!)).toBe(true);
    expect(isPrivateIp(parseIp('fe80::1')!)).toBe(true);
    expect(isPrivateIp(parseIp('2606:4700::1')!)).toBe(false);
  });
});

describe('AsnService.lookupRange', () => {
  let dir: string;
  let cachePath: string;
  let asn: AsnService;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'asn-test-'));
    cachePath = path.join(dir, 'ranges.tsv.gz');
    writeFileSync(cachePath, gzipSync(Buffer.from(SAMPLE_TSV, 'utf8')));
    asn = new AsnService();
    await asn.loadRanges(undefined, cachePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lädt die Bereichstabelle aus dem Cache', () => {
    expect(asn.rangeCount).toBe(3);
  });

  it('findet die passende ASN per binärer Suche (IPv4)', () => {
    expect(asn.lookupRange('1.1.1.1')).toEqual({ asn: 13335, ipVersion: 4, asName: 'Cloudflare, Inc.', isPrivate: false });
    expect(asn.lookupRange('3.3.3.3')).toEqual({ asn: 16509, ipVersion: 4, asName: 'Amazon.com, Inc.', isPrivate: false });
  });

  it('findet die passende ASN per binärer Suche (IPv6)', () => {
    expect(asn.lookupRange('2606:4700::1234')).toMatchObject({ asn: 13335, ipVersion: 6 });
  });

  it('liefert asn=0 für Adressen außerhalb aller Bereiche', () => {
    expect(asn.lookupRange('9.9.9.9')).toEqual({ asn: 0, ipVersion: 4, asName: '', isPrivate: false });
  });

  it('liefert asn=0 und isPrivate=true für private Adressen, ohne die Tabelle zu befragen', () => {
    expect(asn.lookupRange('192.168.0.1')).toEqual({ asn: 0, ipVersion: 4, asName: '', isPrivate: true });
  });

  it('classify() liefert "unknown" ohne geladene Klassen-Map', () => {
    expect(asn.classify(13335)).toEqual({ netClass: 'unknown', name: '' });
  });
});

describe('AsnService ohne Cache/URL', () => {
  it('startet mit leerer Tabelle, wenn weder Download noch Cache verfügbar sind', async () => {
    const asn = new AsnService();
    await asn.loadRanges(undefined, path.join(tmpdir(), 'nicht-vorhanden-' + Date.now() + '.gz'));
    expect(asn.rangeCount).toBe(0);
  });
});
