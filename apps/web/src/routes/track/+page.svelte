<script lang="ts">
	// Fahrt-Modus: Herzstück der App. Login nötig; vor dem Start Zugtyp/Nummer wählen,
	// während der Fahrt Vollbild-Dark-Layout mit Live-Zahlen (siehe PLANUNG.md 6.9).
	import { TRAIN_TYPE_LABELS, TRAIN_TYPES, type TrainType } from '@bahn/shared';
	import Sparkline from '#lib/components/Sparkline.svelte';
	import { auth } from '#lib/auth.svelte.js';
	import { tracker } from '#lib/tracker/tracker.svelte.js';

	let trainType = $state<TrainType>('ice');
	let trainNumber = $state('');
	let starting = $state(false);
	let startError = $state<string | null>(null);

	const insecure = typeof window !== 'undefined' && !window.isSecureContext;

	async function handleStart(): Promise<void> {
		starting = true;
		startError = null;
		try {
			await tracker.start(trainType, trainNumber.trim());
		} catch (err) {
			const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
			startError = `Fahrt konnte nicht gestartet werden${detail}. Bitte erneut versuchen.`;
		} finally {
			starting = false;
		}
	}

	async function handleResume(): Promise<void> {
		starting = true;
		try {
			await tracker.resume();
		} finally {
			starting = false;
		}
	}

	async function handleStop(): Promise<void> {
		if (!confirm('Fahrt wirklich beenden?')) return;
		await tracker.stop();
	}

	function fmt(value: number | null, digits = 0, suffix = ''): string {
		return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
	}

	function mbit(bps: number | null): string {
		return bps === null ? '–' : `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
	}

	const cooldownSecLeft = $derived(
		tracker.speedtestCooldownUntil ? Math.max(0, Math.round((tracker.speedtestCooldownUntil - Date.now()) / 1000)) : 0,
	);
	const speedKmh = $derived(tracker.geo.speedMps !== null ? tracker.geo.speedMps * 3.6 : null);
</script>

<svelte:head>
	<title>Fahrt-Modus</title>
</svelte:head>

{#if auth.loading}
	<p>Lade…</p>
{:else if !auth.me}
	<div class="notice warn">
		Für den Fahrt-Modus ist eine Anmeldung nötig. <a href="/">Jetzt anmelden</a>.
	</div>
{:else if tracker.active}
	<div class="track-mode">
		<div class="track-actions">
			<button class="btn secondary" onclick={handleStop}>Fahrt beenden</button>
			<button
				class="btn"
				onclick={() => tracker.runSpeedtest()}
				disabled={tracker.speedtestProgress?.phase === 'download' ||
					tracker.speedtestProgress?.phase === 'upload' ||
					cooldownSecLeft > 0}
			>
				{#if tracker.speedtestProgress?.phase === 'download' || tracker.speedtestProgress?.phase === 'upload'}
					Speedtest läuft…
				{:else if cooldownSecLeft > 0}
					Speedtest ({cooldownSecLeft}s Pause)
				{:else}
					Speedtest
				{/if}
			</button>
		</div>

		{#if tracker.wsState !== 'open'}
			<div class="notice warn">Verbindung zum Server: {tracker.wsState === 'connecting' ? 'verbinde…' : 'getrennt, versuche erneut'}</div>
		{/if}
		{#if tracker.captive}
			<div class="notice error">Captive Portal erkannt – bitte im WLAN anmelden/durchklicken.</div>
		{/if}
		{#if tracker.outboxStatus.needsLogin}
			<div class="notice error">Sitzung abgelaufen, Upload pausiert. <a href="/">Bitte erneut anmelden</a>.</div>
		{/if}
		{#each tracker.errors as err (err)}
			<div class="notice error">{err}</div>
		{/each}

		<div class="card">
			<div class="stat__label">RTT (letzte 5 min)</div>
			<Sparkline points={tracker.rttHistory} />
		</div>

		<div class="track-stats">
			<div class="stat">
				<div class="stat__label">RTT aktuell</div>
				<div class="stat__value big">{fmt(tracker.currentRtt, 0, ' ms')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Jitter</div>
				<div class="stat__value">{fmt(tracker.jitterMs, 1, ' ms')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Verlust (60s)</div>
				<div class="stat__value">{fmt(tracker.lossPct60s, 0, ' %')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Verfügbarkeit</div>
				<div class="stat__value">{fmt(tracker.availabilityPct, 0, ' %')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Geschwindigkeit</div>
				<div class="stat__value">{fmt(speedKmh, 0, ' km/h')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">GPS-Genauigkeit</div>
				<div class="stat__value">{fmt(tracker.geo.accuracyM, 0, ' m')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Netz</div>
				<div class="stat__value" style="font-size: 1.1rem">{tracker.net.label ?? '–'}</div>
				<div style="font-size: 0.8rem; color: var(--fg-dim)">
					{#if tracker.net.asn !== null}
						AS{tracker.net.asn}{tracker.net.asName ? ` · ${tracker.net.asName}` : ''}
					{/if}
					{#if tracker.net.ipVersion !== null}
						· IPv{tracker.net.ipVersion}
					{/if}
				</div>
			</div>
			<div class="stat">
				<div class="stat__label">Letzter Speedtest</div>
				<div class="stat__value" style="font-size: 1rem">
					{#if tracker.lastSpeedtest}
						↓ {mbit(tracker.lastSpeedtest.downBps)} / ↑ {mbit(tracker.lastSpeedtest.upBps)}
					{:else}
						noch keiner
					{/if}
				</div>
			</div>
			<div class="stat">
				<div class="stat__label">Puffer / Upload</div>
				<div class="stat__value" style="font-size: 1rem">
					{tracker.outboxStatus.pending} wartend
					{#if tracker.outboxStatus.lastError}<br /><span style="color: var(--danger)">{tracker.outboxStatus.lastError}</span>{/if}
				</div>
			</div>
		</div>

		{#if tracker.netHistory.length > 0}
			<div class="card">
				<div class="stat__label">Netz-Verlauf (letzte {tracker.netHistory.length})</div>
				<ul style="margin: 0.4rem 0 0; padding-left: 1.2rem">
					{#each tracker.netHistory as entry (entry.asn)}
						<li>
							AS{entry.asn}{entry.asName ? ` · ${entry.asName}` : ''}
							– seit {new Date(entry.firstSeenAt).toLocaleTimeString('de-DE')}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if tracker.geo.error}
			<div class="notice warn">Standort: {tracker.geo.error}</div>
		{/if}
	</div>
{:else}
	<h1>Fahrt-Modus</h1>

	{#if tracker.lastEndedTripId}
		<div class="notice success">
			Fahrt beendet. <a href={`/trips/${tracker.lastEndedTripId}`}>Fahrt ansehen</a>
		</div>
	{/if}

	{#if tracker.resumeAvailable}
		<div class="card">
			<p>Es gibt noch eine unterbrochene Fahrt. Fortsetzen?</p>
			<div class="track-actions">
				<button class="btn" onclick={handleResume} disabled={starting}>Fahrt fortsetzen</button>
				<button class="btn secondary" onclick={() => tracker.discardResume()}>Verwerfen</button>
			</div>
		</div>
	{:else}
		{#if insecure}
			<div class="notice warn">Standort und Wake Lock benötigen HTTPS oder localhost.</div>
		{/if}
		<div class="notice warn">
			Der Bildschirm bleibt während der Fahrt an, und der Standort wird laufend erfasst. Handy am
			besten mit Ladekabel verwenden.
		</div>

		<form
			class="card"
			onsubmit={(e) => {
				e.preventDefault();
				void handleStart();
			}}
		>
			{#if startError}<div class="notice error">{startError}</div>{/if}
			<div class="field">
				<label for="trainType">Zugtyp</label>
				<select id="trainType" bind:value={trainType}>
					{#each TRAIN_TYPES as t (t)}
						<option value={t}>{TRAIN_TYPE_LABELS[t]}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="trainNumber">Zugnummer (optional)</label>
				<input id="trainNumber" bind:value={trainNumber} maxlength="20" placeholder="z. B. ICE 123" />
			</div>
			<button class="btn" type="submit" disabled={starting}>{starting ? 'Starte…' : 'Fahrt starten'}</button>
		</form>
	{/if}
{/if}
