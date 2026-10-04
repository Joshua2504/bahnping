// Gemeinsame Karten-Einstellungen (Fahrtdetail und Live-Karte im Fahrt-Modus), in localStorage gemerkt.

const SHOW_SPEEDTESTS_KEY = 'bahnping-map-speedtests';

function readShowSpeedtests(): boolean {
	try {
		return localStorage.getItem(SHOW_SPEEDTESTS_KEY) !== 'off';
	} catch {
		// localStorage nicht verfügbar: Standard (eingeblendet).
		return true;
	}
}

class MapPrefs {
	showSpeedtests = $state(true);

	constructor() {
		if (typeof window === 'undefined') return;
		this.showSpeedtests = readShowSpeedtests();
	}

	setShowSpeedtests(on: boolean): void {
		this.showSpeedtests = on;
		try {
			if (on) localStorage.removeItem(SHOW_SPEEDTESTS_KEY);
			else localStorage.setItem(SHOW_SPEEDTESTS_KEY, 'off');
		} catch {
			// Ohne Speicher gilt die Wahl nur bis zum Neuladen.
		}
	}
}

export const mapPrefs = new MapPrefs();

/** MapLibre-Sichtbarkeit für Speedtest-Layer. */
export function speedtestVisibility(): 'visible' | 'none' {
	return mapPrefs.showSpeedtests ? 'visible' : 'none';
}
