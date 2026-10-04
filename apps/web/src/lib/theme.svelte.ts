// Reaktiver Farbmodus (hell/dunkel/System). Die Wahl liegt in localStorage, das wirksame Schema als
// `data-theme` auf <html>. Ein Inline-Skript in app.html setzt es vor dem ersten Rendern (kein Flackern).

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bahnping-theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#0a0c10', light: '#f5f6f8' };

function readPref(): ThemePref {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === 'light' || v === 'dark') return v;
	} catch {
		// localStorage nicht verfügbar (z.B. privater Modus): System folgen.
	}
	return 'system';
}

class ThemeState {
	pref = $state<ThemePref>('system');
	systemDark = $state(true);
	/** Wirksames Schema nach Auflösen von „System“. */
	resolved = $derived<Theme>(this.pref === 'system' ? (this.systemDark ? 'dark' : 'light') : this.pref);

	constructor() {
		if (typeof window === 'undefined') return;
		this.pref = readPref();
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		this.systemDark = mq.matches;
		mq.addEventListener('change', (e) => (this.systemDark = e.matches));
	}

	set(pref: ThemePref): void {
		this.pref = pref;
		try {
			if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
			else localStorage.setItem(STORAGE_KEY, pref);
		} catch {
			// Ohne Speicher gilt die Wahl nur bis zum Neuladen.
		}
	}

	/** Reihum System → Hell → Dunkel. */
	cycle(): void {
		this.set(this.pref === 'system' ? 'light' : this.pref === 'light' ? 'dark' : 'system');
	}

	/** Überträgt das wirksame Schema auf das Dokument (aus einem $effect im Layout aufgerufen). */
	apply(): void {
		const root = document.documentElement;
		root.dataset.theme = this.resolved;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[this.resolved]);
	}
}

export const theme = new ThemeState();
