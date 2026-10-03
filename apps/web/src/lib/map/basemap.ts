// Gemeinsames Basemap-Setup (PMTiles + @protomaps/basemaps) für `/map` und `/trips/[id]`.
import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';

let protocolRegistered = false;

/** Registriert das `pmtiles://`-Protokoll bei maplibre-gl (einmalig pro Seite). */
export function ensurePmtilesProtocol(): void {
	if (protocolRegistered) return;
	const protocol = new Protocol();
	maplibregl.addProtocol('pmtiles', protocol.tile);
	protocolRegistered = true;
}

/**
 * Baut die vollständige MapLibre-Style-Definition: Protomaps-Basiskarte (schwarzes Theme, Deutsch)
 * plus optionale zusätzliche Quellen/Layer (z.B. die H3-Zellen auf `/map` oder die Streckenpunkte
 * auf `/trips/[id]`).
 */
export function createBaseStyle(
	extraSources: Record<string, SourceSpecification> = {},
	extraLayers: LayerSpecification[] = [],
): StyleSpecification {
	const tilesUrl = `pmtiles://${location.origin}/tiles/basemap.pmtiles`;
	return {
		version: 8,
		glyphs: '/tiles/fonts/{fontstack}/{range}.pbf',
		sprite: `${location.origin}/tiles/sprites/v4/black`,
		sources: {
			protomaps: { type: 'vector', url: tilesUrl, attribution: '© OpenStreetMap-Mitwirkende' },
			...extraSources,
		},
		layers: [...(layers('protomaps', namedFlavor('black'), { lang: 'de' }) as LayerSpecification[]), ...extraLayers],
	};
}

/** Standard-Kartenmittelpunkt/-zoom (Deutschland). */
export const DEFAULT_CENTER: [number, number] = [10.4, 51.2];
export const DEFAULT_ZOOM = 6;
