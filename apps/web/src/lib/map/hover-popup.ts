// Gemeinsames Hover-Popup für Karten-Layer: zeigt Details sofort beim Überfahren mit der Maus,
// auf Touch-Geräten per Tippen (Tippen ins Leere schließt es wieder).
import maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl';

export interface HoverPopupOptions {
	maxWidth?: string;
}

/**
 * Hängt ein Hover-Popup an die angegebenen Layer (oberster Treffer gewinnt).
 * `render` liefert das HTML für ein Feature. Gibt eine Aufräumfunktion zurück.
 */
export function attachHoverPopup(
	map: maplibregl.Map,
	layers: string[],
	render: (feature: MapGeoJSONFeature) => string,
	opts: HoverPopupOptions = {},
): () => void {
	const popup = new maplibregl.Popup({
		closeButton: false,
		closeOnClick: false,
		className: 'map-hover-popup',
		maxWidth: opts.maxWidth ?? '260px',
		offset: 10,
	});
	let currentKey: string | null = null;

	function hit(e: MapMouseEvent): MapGeoJSONFeature | null {
		// Nach setStyle() (Farbmodus) sind Layer kurz nicht vorhanden; dann nichts abfragen.
		const present = layers.filter((id) => map.getLayer(id));
		if (present.length === 0) return null;
		return map.queryRenderedFeatures(e.point, { layers: present })[0] ?? null;
	}

	function show(e: MapMouseEvent): void {
		const f = hit(e);
		if (!f) {
			hide();
			return;
		}
		map.getCanvas().style.cursor = 'pointer';
		// Punkte: Popup am Punkt verankern, Flächen: an der Mausposition.
		const lngLat =
			f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : ([e.lngLat.lng, e.lngLat.lat] as [number, number]);
		popup.setLngLat(lngLat);
		const key = `${f.layer.id}:${f.id ?? JSON.stringify(f.properties)}`;
		if (key !== currentKey) {
			currentKey = key;
			popup.setHTML(render(f));
		}
		if (!popup.isOpen()) popup.addTo(map);
	}

	function hide(): void {
		if (currentKey === null && !popup.isOpen()) return;
		map.getCanvas().style.cursor = '';
		currentKey = null;
		popup.remove();
	}

	map.on('mousemove', show);
	map.on('click', show);
	map.on('mouseout', hide);
	return () => {
		map.off('mousemove', show);
		map.off('click', show);
		map.off('mouseout', hide);
		popup.remove();
	};
}
