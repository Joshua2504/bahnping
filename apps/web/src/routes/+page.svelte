<script lang="ts">
	// Deutsche Übersetzung für das ALTCHA-Widget registrieren; Englisch ist im Kernpaket bereits
	// enthalten. Die Sprache wird anhand von <html lang> automatisch erkannt (siehe +layout.svelte).
	import 'altcha/i18n/de';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import { i18n } from '#lib/i18n.svelte.js';
	import LiveMap from '#lib/components/LiveMap.svelte';

	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let error = $state<string | null>(null);
	let formEl: HTMLFormElement | undefined = $state(undefined);

	const de = {
		intro1:
			'Dieses Projekt misst, wie gut das Netz in Zügen tatsächlich ist – getrennt nach DB-WLAN und eigenem Mobilfunk. Während einer Fahrt werden Latenz, Paketverlust, Standort und auf Wunsch die Durchsatzgeschwindigkeit erfasst und ohne Personenbezug als Heatmap und Fahrtliste veröffentlicht.',
		privacyLabel: 'Datenschutz:',
		intro2:
			'IP-Adressen werden nie gespeichert, sondern nur für den Moment der Anfrage im Arbeitsspeicher verwendet, um grob den Netzbetreiber zu bestimmen. Solange die Datenbasis klein ist, sind alle Messungen sofort öffentlich, auch einzelne Fahrten mit Strecke und Zeitpunkten, aber ohne Namen oder Konto. Die Positionen liegen auf den Bahngleisen.',
		loading: 'Lade…',
		trackTitle: 'Fahrt starten',
		trackDesc: 'Live-Messung während der Zugfahrt.',
		mapTitle: 'Karte',
		mapDesc: 'Öffentliche Heatmap aller Messungen.',
		accountTitle: 'Konto',
		accountDesc: 'Eigene Fahrten, Export, Einstellungen.',
		sentNotice: 'Mail geschickt. Bitte den Bestätigungslink darin öffnen. In der Testversion:',
		openMailpit: 'Mailpit öffnen',
		loginTitle: 'Anmelden',
		emailLabel: 'E-Mail',
		sending: 'Sende…',
		submit: 'Anmeldelink senden',
		waitAltcha: 'Bitte kurz warten, bis die Sicherheitsprüfung abgeschlossen ist.',
		unknownError: 'Unbekannter Fehler',
		privacyHint: 'Wie wir deine Daten verarbeiten, steht in der',
		privacyLink: 'Datenschutzerklärung',
	};
	const en: typeof de = {
		intro1:
			'This project measures how good the network connection on trains actually is — separately for DB Wi-Fi and your own mobile network. During a ride, latency, packet loss, location and, optionally, throughput are recorded and published without personal data as a heatmap and list of rides.',
		privacyLabel: 'Privacy:',
		intro2:
			'IP addresses are never stored — they are only used in memory for the moment of the request to roughly determine the network operator. While the dataset is still small, all measurements are public right away, including individual rides with route and times, but without names or accounts. The positions lie on the railway tracks.',
		loading: 'Loading…',
		trackTitle: 'Start a ride',
		trackDesc: 'Live measurement during the train ride.',
		mapTitle: 'Map',
		mapDesc: 'Public heatmap of all measurements.',
		accountTitle: 'Account',
		accountDesc: 'Your rides, export, settings.',
		sentNotice: 'Email sent. Please open the confirmation link in it. In the test version:',
		openMailpit: 'Open Mailpit',
		loginTitle: 'Sign in',
		emailLabel: 'Email',
		sending: 'Sending…',
		submit: 'Send sign-in link',
		waitAltcha: 'Please wait a moment until the security check has finished.',
		unknownError: 'Unknown error',
		privacyHint: 'How we process your data is described in the',
		privacyLink: 'privacy policy',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	async function submit(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!formEl) return;
		const altcha = String(new FormData(formEl).get('altcha') ?? '');
		if (!altcha) {
			error = m.waitAltcha;
			return;
		}
		error = null;
		sending = true;
		try {
			await api.magicLink({ email, altcha });
			sent = true;
		} catch (err) {
			error = err instanceof ApiError ? (err.detail ?? err.title) : m.unknownError;
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>BahnPing</title>
</svelte:head>

<h1>BahnPing</h1>
<p>{m.intro1}</p>
<p>
	<strong>{m.privacyLabel}</strong>
	{m.intro2}
</p>

<LiveMap />

{#if auth.loading}
	<p>{m.loading}</p>
{:else if auth.me}
	<div class="card-grid">
		<a class="card" href="/track">
			<h2>{m.trackTitle}</h2>
			<p>{m.trackDesc}</p>
		</a>
		<a class="card" href="/map">
			<h2>{m.mapTitle}</h2>
			<p>{m.mapDesc}</p>
		</a>
		<a class="card" href="/account">
			<h2>{m.accountTitle}</h2>
			<p>{m.accountDesc}</p>
		</a>
	</div>
{:else if sent}
	<div class="notice success">
		{m.sentNotice}
		<a href="/mailpit">{m.openMailpit}</a>.
	</div>
{:else}
	<form class="card" bind:this={formEl} onsubmit={submit}>
		<h2>{m.loginTitle}</h2>
		{#if error}
			<div class="notice error">{error}</div>
		{/if}
		<div class="field">
			<label for="email">{m.emailLabel}</label>
			<input id="email" name="email" type="email" required bind:value={email} autocomplete="email" />
		</div>
		<altcha-widget challengeurl="/api/altcha/challenge" hidefooter></altcha-widget>
		<p class="privacy-hint">{m.privacyHint} <a href="/datenschutz">{m.privacyLink}</a>.</p>
		<button class="btn" type="submit" disabled={sending} style="margin-top: 0.8rem">
			{sending ? m.sending : m.submit}
		</button>
	</form>
{/if}

<style>
	.privacy-hint {
		margin: 0.6rem 0 0;
		font-size: 0.85rem;
		color: var(--fg-dim);
	}
</style>
