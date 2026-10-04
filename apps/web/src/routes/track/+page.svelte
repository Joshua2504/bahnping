<script lang="ts">
	// Fahrt-Modus: Herzstück der App. Login nötig; vor dem Start Zugtyp/Nummer wählen,
	// während der Fahrt Vollbild-Dark-Layout mit Live-Zahlen (siehe PLANUNG.md 6.9).
	import { TRAIN_TYPES, type TrainType, type Trip } from '@bahn/shared';
	import Sparkline from '#lib/components/Sparkline.svelte';
	import TrackMap from '#lib/components/TrackMap.svelte';
	import { api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import { tracker } from '#lib/tracker/tracker.svelte.js';
	import { fmtTime, i18n, trainTypeLabel } from '#lib/i18n.svelte.js';

	let trainType = $state<TrainType>('ice');
	let trainNumber = $state('');
	let starting = $state(false);
	let startError = $state<string | null>(null);

	/** Aktive Fahrt desselben Nutzers auf einem anderen Gerät (z.B. CLI), siehe `otherDeviceTrip`. */
	let otherDeviceTrip = $state<Trip | null>(null);

	const insecure = typeof window !== 'undefined' && !window.isSecureContext;

	// Läuft im Browser gerade keine eigene Fahrt und auch keine lokal fortsetzbare, aber der Server
	// kennt eine aktive Fahrt (z.B. von der CLI) -> Hinweis mit Link zur Live-Ansicht.
	$effect(() => {
		if (!auth.me || tracker.active || tracker.resumeAvailable) {
			otherDeviceTrip = null;
			return;
		}
		void (async () => {
			try {
				const trips = await api.listTrips();
				otherDeviceTrip = trips.find((t) => t.status === 'active') ?? null;
			} catch {
				otherDeviceTrip = null;
			}
		})();
	});

	const de = {
		title: 'Fahrt-Modus',
		loading: 'Lade…',
		loginRequired: 'Für den Fahrt-Modus ist eine Anmeldung nötig.',
		loginNow: 'Jetzt anmelden',
		stopRide: 'Fahrt beenden',
		speedtestRunning: 'Speedtest läuft…',
		continuous: 'Dauer-Speedtest',
		continuousHint: 'Testet ohne Unterbrechung (5 s Pause). Bis zu ~100 MB pro Test, verbraucht viel Datenvolumen.',
		speedtest: 'Speedtest',
		connPrefix: 'Verbindung zum Server:',
		connConnecting: 'verbinde…',
		connDisconnected: 'getrennt, versuche erneut',
		captive: 'Captive Portal erkannt – bitte im WLAN anmelden/durchklicken.',
		sessionExpired: 'Sitzung abgelaufen, Upload pausiert.',
		signInAgain: 'Bitte erneut anmelden',
		rttLabel: 'RTT (letzte 5 min)',
		rttCurrent: 'RTT aktuell',
		jitter: 'Jitter',
		loss60s: 'Verlust (60s)',
		availability: 'Verfügbarkeit',
		speed: 'Geschwindigkeit',
		gpsAccuracy: 'GPS-Genauigkeit',
		net: 'Netz',
		lastSpeedtest: 'Letzter Speedtest',
		noneYet: 'noch keiner',
		buffer: 'Puffer / Upload',
		pending: (n: number) => `${n} wartend`,
		netHistory: (n: number) => `Netz-Verlauf (letzte ${n})`,
		since: 'seit',
		location: 'Standort:',
		heading: 'Fahrt-Modus',
		rideEnded: 'Fahrt beendet.',
		viewRide: 'Fahrt ansehen',
		otherDevice: (platform: string, type: string, number: string) =>
			`Du hast eine laufende Fahrt auf einem anderen Gerät (${platform}, ${type}${number}).`,
		liveView: 'Live ansehen',
		resumeAvailable: 'Es gibt noch eine unterbrochene Fahrt. Fortsetzen?',
		resumeRide: 'Fahrt fortsetzen',
		discard: 'Verwerfen',
		insecureWarning: 'Standort und Wake Lock benötigen HTTPS oder localhost.',
		screenOnWarning:
			'Der Bildschirm bleibt während der Fahrt an, und der Standort wird laufend erfasst. Handy am besten mit Ladekabel verwenden.',
		trainType: 'Zugtyp',
		trainNumber: 'Zugnummer (optional)',
		trainNumberPlaceholder: 'z. B. ICE 123',
		startRide: 'Fahrt starten',
		starting: 'Starte…',
		startError: (detail: string) => `Fahrt konnte nicht gestartet werden${detail}. Bitte erneut versuchen.`,
		confirmStop: 'Fahrt wirklich beenden?',
	};
	const en: typeof de = {
		title: 'Ride mode',
		loading: 'Loading…',
		loginRequired: 'Signing in is required for ride mode.',
		loginNow: 'Sign in now',
		stopRide: 'End ride',
		speedtestRunning: 'Speedtest running…',
		continuous: 'Continuous speedtest',
		continuousHint: 'Tests back to back (5 s pause). Up to ~100 MB per test, uses a lot of data.',
		speedtest: 'Speedtest',
		connPrefix: 'Connection to server:',
		connConnecting: 'connecting…',
		connDisconnected: 'disconnected, retrying',
		captive: 'Captive portal detected – please sign in via the Wi-Fi network.',
		sessionExpired: 'Session expired, upload paused.',
		signInAgain: 'Please sign in again',
		rttLabel: 'RTT (last 5 min)',
		rttCurrent: 'Current RTT',
		jitter: 'Jitter',
		loss60s: 'Loss (60s)',
		availability: 'Availability',
		speed: 'Speed',
		gpsAccuracy: 'GPS accuracy',
		net: 'Network',
		lastSpeedtest: 'Last speedtest',
		noneYet: 'none yet',
		buffer: 'Buffer / upload',
		pending: (n: number) => `${n} pending`,
		netHistory: (n: number) => `Network history (last ${n})`,
		since: 'since',
		location: 'Location:',
		heading: 'Ride mode',
		rideEnded: 'Ride ended.',
		viewRide: 'View ride',
		otherDevice: (platform: string, type: string, number: string) =>
			`You have a ride running on another device (${platform}, ${type}${number}).`,
		liveView: 'View live',
		resumeAvailable: 'There is an interrupted ride. Resume it?',
		resumeRide: 'Resume ride',
		discard: 'Discard',
		insecureWarning: 'Location and wake lock need HTTPS or localhost.',
		screenOnWarning:
			'The screen stays on during the ride, and location is tracked continuously. Best to keep the phone plugged in.',
		trainType: 'Train type',
		trainNumber: 'Train number (optional)',
		trainNumberPlaceholder: 'e.g. ICE 123',
		startRide: 'Start ride',
		starting: 'Starting…',
		startError: (detail: string) => `Ride could not be started${detail}. Please try again.`,
		confirmStop: 'End the ride?',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	async function handleStart(): Promise<void> {
		starting = true;
		startError = null;
		try {
			await tracker.start(trainType, trainNumber.trim());
		} catch (err) {
			const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
			startError = m.startError(detail);
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
		if (!confirm(m.confirmStop)) return;
		await tracker.stop();
	}

	function fmt(value: number | null, digits = 0, suffix = ''): string {
		return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
	}

	function mbit(bps: number | null): string {
		return bps === null ? '–' : `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
	}

	const speedKmh = $derived(tracker.geo.speedMps !== null ? tracker.geo.speedMps * 3.6 : null);
</script>

<svelte:head>
	<title>{m.title}</title>
</svelte:head>

{#if auth.loading}
	<p>{m.loading}</p>
{:else if !auth.me}
	<div class="notice warn">
		{m.loginRequired} <a href="/">{m.loginNow}</a>.
	</div>
{:else if tracker.active}
	<div class="track-mode">
		<div class="track-actions">
			<button class="btn secondary" onclick={handleStop}>{m.stopRide}</button>
			<button
				class="btn"
				onclick={() => tracker.runSpeedtest()}
				disabled={tracker.speedtestRunning || tracker.speedtestContinuous}
			>
				{tracker.speedtestRunning ? m.speedtestRunning : m.speedtest}
			</button>
			<label class="track-continuous" title={m.continuousHint}>
				<input
					type="checkbox"
					checked={tracker.speedtestContinuous}
					onchange={(e) => tracker.setSpeedtestContinuous(e.currentTarget.checked)}
					style="width: auto; min-height: auto"
				/>
				{m.continuous}
			</label>
		</div>
		{#if tracker.speedtestContinuous}
			<div class="notice">{m.continuousHint}</div>
		{/if}

		{#if tracker.wsState !== 'open'}
			<div class="notice warn">{m.connPrefix} {tracker.wsState === 'connecting' ? m.connConnecting : m.connDisconnected}</div>
		{/if}
		{#if tracker.captive}
			<div class="notice error">{m.captive}</div>
		{/if}
		{#if tracker.outboxStatus.needsLogin}
			<div class="notice error">{m.sessionExpired} <a href="/">{m.signInAgain}</a>.</div>
		{/if}
		{#each tracker.errors as err (err)}
			<div class="notice error">{err}</div>
		{/each}

		<div class="card">
			<div class="stat__label">{m.rttLabel}</div>
			<Sparkline points={tracker.rttHistory} />
		</div>

		<TrackMap />

		<div class="track-stats">
			<div class="stat">
				<div class="stat__label">{m.rttCurrent}</div>
				<div class="stat__value big">{fmt(tracker.currentRtt, 0, ' ms')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.jitter}</div>
				<div class="stat__value">{fmt(tracker.jitterMs, 1, ' ms')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.loss60s}</div>
				<div class="stat__value">{fmt(tracker.lossPct60s, 0, ' %')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.availability}</div>
				<div class="stat__value">{fmt(tracker.availabilityPct, 0, ' %')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.speed}</div>
				<div class="stat__value">{fmt(speedKmh, 0, ' km/h')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.gpsAccuracy}</div>
				<div class="stat__value">{fmt(tracker.geo.accuracyM, 0, ' m')}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.net}</div>
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
				<div class="stat__label">{m.lastSpeedtest}</div>
				<div class="stat__value" style="font-size: 1rem">
					{#if tracker.lastSpeedtest}
						↓ {mbit(tracker.lastSpeedtest.downBps)} / ↑ {mbit(tracker.lastSpeedtest.upBps)}
					{:else}
						{m.noneYet}
					{/if}
				</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.buffer}</div>
				<div class="stat__value" style="font-size: 1rem">
					{m.pending(tracker.outboxStatus.pending)}
					{#if tracker.outboxStatus.lastError}<br /><span style="color: var(--danger)">{tracker.outboxStatus.lastError}</span>{/if}
				</div>
			</div>
		</div>

		{#if tracker.netHistory.length > 0}
			<div class="card">
				<div class="stat__label">{m.netHistory(tracker.netHistory.length)}</div>
				<ul style="margin: 0.4rem 0 0; padding-left: 1.2rem">
					{#each tracker.netHistory as entry (entry.asn)}
						<li>
							AS{entry.asn}{entry.asName ? ` · ${entry.asName}` : ''}
							– {m.since} {fmtTime(entry.firstSeenAt)}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if tracker.geo.error}
			<div class="notice warn">{m.location} {tracker.geo.error}</div>
		{/if}
	</div>
{:else}
	<h1>{m.heading}</h1>

	{#if tracker.lastEndedTripId}
		<div class="notice success">
			{m.rideEnded} <a href={`/trips/${tracker.lastEndedTripId}`}>{m.viewRide}</a>
		</div>
	{/if}

	{#if otherDeviceTrip}
		<div class="notice warn">
			{m.otherDevice(
				otherDeviceTrip.platform,
				trainTypeLabel(otherDeviceTrip.trainType),
				otherDeviceTrip.trainNumber ? ` ${otherDeviceTrip.trainNumber}` : '',
			)}
			<div class="track-actions" style="margin-top: 0.5rem">
				<a class="btn" href={`/trips/${otherDeviceTrip.id}`}>{m.liveView}</a>
			</div>
		</div>
	{/if}

	{#if tracker.resumeAvailable}
		<div class="card">
			<p>{m.resumeAvailable}</p>
			<div class="track-actions">
				<button class="btn" onclick={handleResume} disabled={starting}>{m.resumeRide}</button>
				<button class="btn secondary" onclick={() => tracker.discardResume()}>{m.discard}</button>
			</div>
		</div>
	{:else}
		{#if insecure}
			<div class="notice warn">{m.insecureWarning}</div>
		{/if}
		<div class="notice warn">
			{m.screenOnWarning}
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
				<label for="trainType">{m.trainType}</label>
				<select id="trainType" bind:value={trainType}>
					{#each TRAIN_TYPES as t (t)}
						<option value={t}>{trainTypeLabel(t)}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="trainNumber">{m.trainNumber}</label>
				<input id="trainNumber" bind:value={trainNumber} maxlength="20" placeholder={m.trainNumberPlaceholder} />
			</div>
			<button class="btn" type="submit" disabled={starting}>{starting ? m.starting : m.startRide}</button>
		</form>
	{/if}
{/if}
