import type { FastifyInstance } from 'fastify';
import { NET_CLASS_LABELS, NET_TOKEN_TTL_MS, PROBE_BODY, type NetClass } from '@bahn/shared';
import { signNetToken } from '../lib/netToken.js';

export function registerNetRoutes(app: FastifyInstance): void {
  const { cfg, db, asn } = app.ctx;

  app.get('/api/net/whoami', async (request, reply) => {
    // Die IP wird ausschließlich hier lokal verwendet, nie in einem Objekt abgelegt oder geloggt.
    const lookup = asn.lookupRange(request.ip);
    if (!lookup) {
      reply.send({
        asn: 0,
        netClass: 'unknown' as NetClass,
        ipVersion: null,
        exp: Date.now() + NET_TOKEN_TTL_MS,
        sig: signNetToken(cfg.APP_SECRET, { asn: 0, netClass: 'unknown', ipVersion: null, exp: Date.now() + NET_TOKEN_TTL_MS }),
        asName: '',
        label: NET_CLASS_LABELS.unknown,
      });
      return;
    }

    let netClass: NetClass = 'unknown';
    let asName = lookup.asName;
    if (lookup.isPrivate) {
      netClass = 'private';
      asName = '';
    } else if (lookup.asn !== 0) {
      const entry = asn.classify(lookup.asn);
      netClass = entry.netClass;
      if (entry.name) asName = entry.name;
      void asn.recordSeen(db, lookup.asn, lookup.asName);
    }

    const exp = Date.now() + NET_TOKEN_TTL_MS;
    const sig = signNetToken(cfg.APP_SECRET, { asn: lookup.asn, netClass, ipVersion: lookup.ipVersion, exp });
    const label = asName ? `${NET_CLASS_LABELS[netClass]} (${asName})` : NET_CLASS_LABELS[netClass];
    reply.send({ asn: lookup.asn, netClass, ipVersion: lookup.ipVersion, exp, sig, asName, label });
  });

  app.get('/api/net/probe', async (_request, reply) => {
    reply.header('cache-control', 'no-store').type('text/plain').send(PROBE_BODY);
  });
}
