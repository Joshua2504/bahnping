import { z } from 'zod';

export const NET_CLASSES = [
  'db_wlan',
  'mobile_telekom',
  'mobile_vodafone',
  'mobile_o2',
  'mobile_other',
  'vpn_hosting',
  'private',
  'unknown',
] as const;
export const NetClass = z.enum(NET_CLASSES);
export type NetClass = z.infer<typeof NetClass>;

export const NET_CLASS_LABELS: Record<NetClass, string> = {
  db_wlan: 'DB WLAN',
  mobile_telekom: 'Mobilfunk Telekom',
  mobile_vodafone: 'Mobilfunk Vodafone',
  mobile_o2: 'Mobilfunk O2',
  mobile_other: 'Mobilfunk (sonstige)',
  vpn_hosting: 'VPN / Rechenzentrum',
  private: 'Lokal / privat',
  unknown: 'Unbekannt',
};

/**
 * Startzuordnung ASN → Netzklasse. Wird beim API-Start in asn_catalog eingespielt und kann dort
 * (Admin-Review) ergänzt werden. Die ASN des WIFIonICE-Backhauls ist noch zu ermitteln (Probefahrt).
 */
export const ASN_SEED: ReadonlyArray<{ asn: number; name: string; netClass: NetClass }> = [
  { asn: 3320, name: 'Deutsche Telekom AG', netClass: 'mobile_telekom' },
  { asn: 3209, name: 'Vodafone GmbH', netClass: 'mobile_vodafone' },
  { asn: 6805, name: 'Telefonica Germany GmbH & Co. OHG', netClass: 'mobile_o2' },
  { asn: 24940, name: 'Hetzner Online GmbH', netClass: 'vpn_hosting' },
  { asn: 197540, name: 'netcup GmbH', netClass: 'vpn_hosting' },
  { asn: 51167, name: 'Contabo GmbH', netClass: 'vpn_hosting' },
  { asn: 16509, name: 'Amazon.com, Inc.', netClass: 'vpn_hosting' },
  { asn: 14618, name: 'Amazon.com, Inc.', netClass: 'vpn_hosting' },
  { asn: 15169, name: 'Google LLC', netClass: 'vpn_hosting' },
  { asn: 8075, name: 'Microsoft Corporation', netClass: 'vpn_hosting' },
  { asn: 13335, name: 'Cloudflare, Inc.', netClass: 'vpn_hosting' },
  { asn: 14061, name: 'DigitalOcean, LLC', netClass: 'vpn_hosting' },
  { asn: 20473, name: 'The Constant Company (Vultr)', netClass: 'vpn_hosting' },
  { asn: 9009, name: 'M247 Europe SRL', netClass: 'vpn_hosting' },
  { asn: 60068, name: 'Datacamp Limited', netClass: 'vpn_hosting' },
  { asn: 212238, name: 'Datacamp Limited', netClass: 'vpn_hosting' },
  { asn: 16276, name: 'OVH SAS', netClass: 'vpn_hosting' },
];

export const TRAIN_TYPES = ['ice', 'ic', 'regio', 'sbahn', 'other'] as const;
export const TrainType = z.enum(TRAIN_TYPES);
export type TrainType = z.infer<typeof TrainType>;
export const TRAIN_TYPE_LABELS: Record<TrainType, string> = {
  ice: 'ICE',
  ic: 'IC / EC',
  regio: 'RE / RB',
  sbahn: 'S-Bahn',
  other: 'Sonstiges',
};
