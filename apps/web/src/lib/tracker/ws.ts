// WebSocket-Verbindung zu /ws: server-getriebene Pings + Zeit-Sync (siehe docs/API.md, WS /ws).
import { WsServerMessage, type WsClientMessage } from '@bahn/shared';
import { median } from './util.js';

export type WsConnectionState = 'connecting' | 'open' | 'closed';

export interface WsCallbacks {
	onStateChange?: (state: WsConnectionState) => void;
	onRtt?: (rttMs: number, seq: number) => void;
	/** Median-Offset aus 3 Zeit-Sync-Antworten (ms, Server minus Client). */
	onClockOffset?: (offsetMs: number) => void;
}

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/** WebSocket-Client mit Reconnect/Backoff (1s → 30s) und NTP-ähnlichem Zeit-Sync. */
export class TrackerSocket {
	private ws: WebSocket | null = null;
	private stopped = true;
	private backoffMs = MIN_BACKOFF_MS;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private nextSyncCid = 1;
	private offsets: number[] = [];

	constructor(private readonly callbacks: WsCallbacks) {}

	connect(): void {
		this.stopped = false;
		this.open();
	}

	close(): void {
		this.stopped = true;
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		this.ws?.close();
		this.ws = null;
	}

	send(msg: WsClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
	}

	private open(): void {
		if (this.stopped) return;
		const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
		this.callbacks.onStateChange?.('connecting');

		const ws = new WebSocket(url);
		this.ws = ws;

		ws.addEventListener('open', () => {
			this.backoffMs = MIN_BACKOFF_MS;
		});
		ws.addEventListener('message', (ev) => this.handleMessage(ev));
		ws.addEventListener('close', () => {
			this.callbacks.onStateChange?.('closed');
			this.scheduleReconnect();
		});
		ws.addEventListener('error', () => {
			// 'close' folgt in jedem Fall danach.
		});
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		this.reconnectTimer = setTimeout(() => this.open(), this.backoffMs);
		this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
	}

	private handleMessage(ev: MessageEvent): void {
		let msg: WsServerMessage;
		try {
			msg = WsServerMessage.parse(JSON.parse(String(ev.data)));
		} catch {
			return;
		}

		switch (msg.t) {
			case 'hello':
				this.callbacks.onStateChange?.('open');
				this.runTimeSync();
				break;
			case 'ping':
				this.send({ t: 'pong', seq: msg.seq });
				break;
			case 'rtt':
				this.callbacks.onRtt?.(msg.rttMs, msg.seq);
				break;
			case 'sync': {
				const t3 = Date.now();
				const offset = (msg.t1 - msg.t0 + (msg.t2 - t3)) / 2;
				this.offsets.push(offset);
				if (this.offsets.length >= 3) {
					this.callbacks.onClockOffset?.(Math.round(median(this.offsets) ?? 0));
				}
				break;
			}
		}
	}

	private runTimeSync(): void {
		this.offsets = [];
		for (let i = 0; i < 3; i++) {
			setTimeout(() => this.send({ t: 'sync', cid: this.nextSyncCid++, t0: Date.now() }), i * 150);
		}
	}
}
