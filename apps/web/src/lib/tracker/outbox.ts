// Offline-Warteschlange für Samples (Dexie/IndexedDB), siehe PLANUNG.md 6.8.
import Dexie, { type Table } from 'dexie';
import { BATCH_FLUSH_MS, BATCH_MAX_SAMPLES, type Sample } from '@bahn/shared';
import { api, ApiError } from '../api.js';

export interface OutboxEntry {
	id: string;
	tripId: string;
	sample: Sample;
	createdAt: number;
}

class TrackerDb extends Dexie {
	outbox!: Table<OutboxEntry, string>;

	constructor() {
		super('bahn-tracker');
		this.version(1).stores({ outbox: 'id, tripId, createdAt' });
	}
}

const db = new TrackerDb();

export interface OutboxStatus {
	pending: number;
	lastUploadAt: number | null;
	lastError: string | null;
	needsLogin: boolean;
}

function emptyStatus(): OutboxStatus {
	return { pending: 0, lastUploadAt: null, lastError: null, needsLogin: false };
}

/** Puffert Samples lokal und lädt sie in Batches (bis BATCH_MAX_SAMPLES) hoch, idempotent über die Sample-UUID. */
export class Outbox {
	private status: OutboxStatus = emptyStatus();
	private timer: ReturnType<typeof setInterval> | null = null;
	private flushing = false;

	constructor(private readonly onUpdate: (status: OutboxStatus) => void) {}

	/** Startet den periodischen Flush und sendet beim App-Start übrig gebliebene Einträge nach. */
	async start(): Promise<void> {
		this.timer = setInterval(() => void this.flushAll(), BATCH_FLUSH_MS);
		await this.reportPending();
		await this.flushAll();
	}

	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
	}

	async add(tripId: string, sample: Sample): Promise<void> {
		await db.outbox.put({ id: sample.id, tripId, sample, createdAt: Date.now() });
		await this.reportPending();
	}

	/** Alle Fahrten mit ausstehenden Samples hochladen, auch bereits beendete. */
	async flushAll(): Promise<void> {
		if (this.flushing) return;
		this.flushing = true;
		try {
			const tripIds = await db.outbox.orderBy('tripId').uniqueKeys();
			for (const tripId of tripIds) await this.flushTrip(String(tripId));
		} finally {
			this.flushing = false;
		}
	}

	/** Noch nicht hochgeladene Samples einer Fahrt, z.B. um nach einem Reload die Live-Karte zu befüllen. */
	async getPendingSamples(tripId: string): Promise<Sample[]> {
		const entries = await db.outbox.where('tripId').equals(tripId).toArray();
		return entries.map((e) => e.sample);
	}

	async flushTrip(tripId: string): Promise<void> {
		if (this.status.needsLogin) return;
		for (;;) {
			const batch = await db.outbox.where('tripId').equals(tripId).limit(BATCH_MAX_SAMPLES).toArray();
			if (batch.length === 0) return;
			try {
				await api.uploadSamples(tripId, batch.map((e) => e.sample));
				await db.outbox.bulkDelete(batch.map((e) => e.id));
				this.status = { ...this.status, lastUploadAt: Date.now(), lastError: null, needsLogin: false };
				await this.reportPending();
			} catch (err) {
				if (err instanceof ApiError && err.status === 401) {
					this.status = { ...this.status, needsLogin: true, lastError: 'Bitte erneut anmelden, Upload pausiert.' };
				} else {
					this.status = {
						...this.status,
						lastError: err instanceof ApiError ? err.title : 'Upload fehlgeschlagen',
					};
				}
				await this.reportPending();
				return;
			}
		}
	}

	private async reportPending(): Promise<void> {
		this.status = { ...this.status, pending: await db.outbox.count() };
		this.onUpdate(this.status);
	}
}
