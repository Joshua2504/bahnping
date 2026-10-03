// Reaktiver Auth-Zustand für die ganze App (Svelte-5-Runes-Klasse, kein Store nötig).
import type { Me } from '@bahn/shared';
import { api, ApiError } from './api.js';

class AuthState {
	me = $state<Me | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);

	/** Lädt den aktuellen Nutzer; 401 wird als „nicht angemeldet“ behandelt, kein Fehler. */
	async load(): Promise<void> {
		this.loading = true;
		try {
			this.me = await api.me();
			this.error = null;
		} catch (err) {
			this.me = null;
			if (!(err instanceof ApiError && err.status === 401)) {
				this.error = err instanceof ApiError ? (err.detail ?? err.title) : 'Unbekannter Fehler';
			}
		} finally {
			this.loading = false;
		}
	}

	async logout(): Promise<void> {
		try {
			await api.logout();
		} finally {
			this.me = null;
		}
	}

	async logoutAll(): Promise<void> {
		try {
			await api.logoutAll();
		} finally {
			this.me = null;
		}
	}
}

export const auth = new AuthState();
