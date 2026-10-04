// Sprache der Oberfläche (Deutsch/Englisch). Deutsch ist Standard; ohne gespeicherte Wahl entscheidet
// die Browsersprache. Texte liegen je Komponente als zwei Objekte `de`/`en` (gleiche Form), die
// Komponente wählt per `$derived(i18n.locale === 'de' ? de : en)`. Hier liegen nur die geteilten
// Beschriftungen (Netzklassen, Zuggattungen, ICE-Status) und Formatierungshelfer.
import {
	ICE_STATE_LABELS,
	NET_CLASS_LABELS,
	TRAIN_TYPE_LABELS,
	type NetClass,
	type TrainType,
} from '@bahn/shared';

export type Locale = 'de' | 'en';

const STORAGE_KEY = 'bahnping-lang';

function readLocale(): Locale {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === 'de' || v === 'en') return v;
	} catch {
		// localStorage nicht verfügbar: Browsersprache nehmen.
	}
	return (navigator.languages?.[0] ?? navigator.language ?? 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
}

class I18nState {
	locale = $state<Locale>('de');
	/** BCP-47-Tag für Intl/toLocale*-Formatierung. */
	intl = $derived(this.locale === 'de' ? 'de-DE' : 'en-GB');

	constructor() {
		if (typeof window === 'undefined') return;
		this.locale = readLocale();
	}

	set(locale: Locale): void {
		this.locale = locale;
		try {
			localStorage.setItem(STORAGE_KEY, locale);
		} catch {
			// Ohne Speicher gilt die Wahl nur bis zum Neuladen.
		}
	}

	toggle(): void {
		this.set(this.locale === 'de' ? 'en' : 'de');
	}

	/** Überträgt die Sprache auf <html lang> (aus einem $effect im Layout aufgerufen). */
	apply(): void {
		document.documentElement.lang = this.locale;
	}
}

export const i18n = new I18nState();

const NET_CLASS_LABELS_EN: Record<NetClass, string> = {
	db_wlan: 'DB Wi-Fi',
	mobile_telekom: 'Mobile Telekom',
	mobile_vodafone: 'Mobile Vodafone',
	mobile_o2: 'Mobile O2',
	mobile_other: 'Mobile (other)',
	vpn_hosting: 'VPN / data centre',
	private: 'Local / private',
	unknown: 'Unknown',
};

const TRAIN_TYPE_LABELS_EN: Record<TrainType, string> = {
	ice: 'ICE',
	ic: 'IC / EC',
	regio: 'RE / RB',
	sbahn: 'S-Bahn',
	other: 'Other',
};

const ICE_STATE_LABELS_EN: Record<string, string> = {
	HIGH: 'good',
	MIDDLE: 'medium',
	WEAK: 'weak',
	LOW: 'weak',
	UNSTABLE: 'unstable',
	NO_INTERNET: 'dead zone',
	NO_INFO: 'no info',
};

export function netClassLabel(c: NetClass | string): string {
	const map: Record<string, string> = i18n.locale === 'de' ? NET_CLASS_LABELS : NET_CLASS_LABELS_EN;
	return map[c] ?? c;
}

export function trainTypeLabel(t: TrainType | string): string {
	const map: Record<string, string> = i18n.locale === 'de' ? TRAIN_TYPE_LABELS : TRAIN_TYPE_LABELS_EN;
	return map[t] ?? t;
}

export function iceStateLabel(s: string): string {
	const map = i18n.locale === 'de' ? ICE_STATE_LABELS : ICE_STATE_LABELS_EN;
	return map[s] ?? s;
}

/** Zahl in der aktuellen Sprache (Tausendertrennzeichen, Dezimalkomma/-punkt). */
export function fmtNumber(value: number, digits = 0): string {
	return value.toLocaleString(i18n.intl, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtTime(value: string | number | Date, seconds = false): string {
	return new Date(value).toLocaleTimeString(i18n.intl, {
		hour: '2-digit',
		minute: '2-digit',
		...(seconds ? { second: '2-digit' } : {}),
	});
}

export function fmtDateTime(value: string | number | Date): string {
	return new Date(value).toLocaleString(i18n.intl, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtDate(value: string | number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
	return new Date(value).toLocaleDateString(i18n.intl, opts);
}
