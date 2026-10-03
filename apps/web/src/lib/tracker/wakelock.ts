// Screen Wake Lock während der Fahrt; fordert den Lock bei Rückkehr aus dem Hintergrund neu an.

export class WakeLockManager {
	private sentinel: WakeLockSentinel | null = null;
	private active = false;
	private readonly onVisibility = (): void => {
		if (this.active && document.visibilityState === 'visible') void this.acquire();
	};

	get supported(): boolean {
		return 'wakeLock' in navigator;
	}

	async start(): Promise<void> {
		this.active = true;
		document.addEventListener('visibilitychange', this.onVisibility);
		await this.acquire();
	}

	async stop(): Promise<void> {
		this.active = false;
		document.removeEventListener('visibilitychange', this.onVisibility);
		await this.sentinel?.release();
		this.sentinel = null;
	}

	private async acquire(): Promise<void> {
		if (!('wakeLock' in navigator)) return;
		try {
			this.sentinel = await navigator.wakeLock.request('screen');
		} catch {
			// z. B. Tab nicht sichtbar oder Berechtigung verweigert; beim nächsten visibilitychange erneut versuchen.
			this.sentinel = null;
		}
	}
}
