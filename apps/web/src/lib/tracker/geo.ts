// Standortverfolgung über watchPosition (siehe PLANUNG.md 6.2). Kein Hintergrundbetrieb in der PWA.
import { MAX_ACCURACY_M } from '@bahn/shared';
import { i18n } from '../i18n.svelte.js';

// Nutzersichtbare Fehlertexte, sprachabhängig (siehe `msg()`).
const de = {
	noGeolocation: 'Geolocation nicht verfügbar',
	permissionDenied: 'Standortzugriff verweigert',
	positionUnavailable: 'Standort nicht verfügbar',
	timeout: 'Standortabfrage hat zu lange gedauert',
	unknown: 'Unbekannter Standortfehler',
};
const en: typeof de = {
	noGeolocation: 'Geolocation unavailable',
	permissionDenied: 'Location access denied',
	positionUnavailable: 'Location unavailable',
	timeout: 'Location request timed out',
	unknown: 'Unknown location error',
};
function msg(): typeof de {
	return i18n.locale === 'de' ? de : en;
}

export interface GeoState {
	lat: number | null;
	lon: number | null;
	accuracyM: number | null;
	speedMps: number | null;
	heading: number | null;
	lastFixAt: number | null;
	error: string | null;
}

export interface GeoSample {
	lat: number;
	lon: number;
	accuracyM: number | null;
	speedMps: number | null;
	heading: number | null;
}

/** Positions-Samples älter als dies werden nicht mehr an Messwerte angehängt. */
const MAX_FIX_AGE_MS = 15_000;

function emptyState(): GeoState {
	return {
		lat: null,
		lon: null,
		accuracyM: null,
		speedMps: null,
		heading: null,
		lastFixAt: null,
		error: null,
	};
}

export class GeoTracker {
	state: GeoState = emptyState();
	private watchId: number | null = null;

	constructor(private readonly onUpdate: (state: GeoState) => void) {}

	start(): void {
		if (!('geolocation' in navigator)) {
			this.state = { ...this.state, error: msg().noGeolocation };
			this.onUpdate(this.state);
			return;
		}
		this.watchId = navigator.geolocation.watchPosition(
			(pos) => {
				if (pos.coords.accuracy > MAX_ACCURACY_M) return;
				this.state = {
					lat: pos.coords.latitude,
					lon: pos.coords.longitude,
					accuracyM: pos.coords.accuracy,
					speedMps: pos.coords.speed,
					heading: pos.coords.heading,
					lastFixAt: Date.now(),
					error: null,
				};
				this.onUpdate(this.state);
			},
			(err) => {
				this.state = { ...this.state, error: geoErrorMessage(err) };
				this.onUpdate(this.state);
			},
			{ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
		);
	}

	stop(): void {
		if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
		this.watchId = null;
	}

	/** Position für ein Sample: letzter Fix, wenn jünger als 15s, sonst `null`. */
	samplePosition(): GeoSample | null {
		const s = this.state;
		if (s.lat === null || s.lon === null || s.lastFixAt === null) return null;
		if (Date.now() - s.lastFixAt > MAX_FIX_AGE_MS) return null;
		return { lat: s.lat, lon: s.lon, accuracyM: s.accuracyM, speedMps: s.speedMps, heading: s.heading };
	}
}

function geoErrorMessage(err: GeolocationPositionError): string {
	switch (err.code) {
		case err.PERMISSION_DENIED:
			return msg().permissionDenied;
		case err.POSITION_UNAVAILABLE:
			return msg().positionUnavailable;
		case err.TIMEOUT:
			return msg().timeout;
		default:
			return msg().unknown;
	}
}
