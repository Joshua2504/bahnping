// Periodischer whoami-Abruf (Netzklasse/Provider) + Network-Information-API als Zusatzsignal.
// navigator.connection ist nicht standardisiert (nur Chromium) -> eigenes Interface + Typ-Guards.
import { WHOAMI_INTERVAL_MS, type NetToken } from '@bahn/shared';
import { api } from '../api.js';
import { i18n } from '../i18n.svelte.js';

const de = { whoamiError: 'Fehler bei whoami' };
const en: typeof de = { whoamiError: 'Network check failed' };
function msg(): typeof de {
	return i18n.locale === 'de' ? de : en;
}

interface NetworkInformationLike extends EventTarget {
	readonly type?: string;
	readonly effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
	connection?: NetworkInformationLike;
	mozConnection?: NetworkInformationLike;
	webkitConnection?: NetworkInformationLike;
}

function getConnection(): NetworkInformationLike | undefined {
	const nav = navigator as NavigatorWithConnection;
	return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

export interface NetState {
	token: NetToken | null;
	label: string | null;
	asName: string | null;
	connType: string | null;
	effectiveType: string | null;
	error: string | null;
}

function emptyState(): NetState {
	return { token: null, label: null, asName: null, connType: null, effectiveType: null, error: null };
}

export class NetWhoami {
	state: NetState = emptyState();
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly connection = getConnection();
	private readonly onOnline = (): void => void this.refresh();
	private readonly onConnChange = (): void => void this.refresh();

	constructor(private readonly onUpdate: (state: NetState) => void) {}

	start(): void {
		this.updateConnectionInfo();
		void this.refresh();
		this.timer = setInterval(() => void this.refresh(), WHOAMI_INTERVAL_MS);
		window.addEventListener('online', this.onOnline);
		this.connection?.addEventListener('change', this.onConnChange);
	}

	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		window.removeEventListener('online', this.onOnline);
		this.connection?.removeEventListener('change', this.onConnChange);
	}

	private updateConnectionInfo(): void {
		this.state = {
			...this.state,
			connType: this.connection?.type ?? null,
			effectiveType: this.connection?.effectiveType ?? null,
		};
		this.onUpdate(this.state);
	}

	private async refresh(): Promise<void> {
		this.updateConnectionInfo();
		try {
			const res = await api.whoami();
			this.state = {
				...this.state,
				token: { asn: res.asn, netClass: res.netClass, ipVersion: res.ipVersion, exp: res.exp, sig: res.sig },
				label: res.label,
				asName: res.asName,
				error: null,
			};
		} catch (err) {
			this.state = { ...this.state, error: err instanceof Error ? err.message : msg().whoamiError };
		}
		this.onUpdate(this.state);
	}
}
