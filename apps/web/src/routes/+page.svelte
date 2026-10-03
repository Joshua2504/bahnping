<script lang="ts">
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';

	let email = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let error = $state<string | null>(null);
	let formEl: HTMLFormElement | undefined = $state(undefined);

	async function submit(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!formEl) return;
		const altcha = String(new FormData(formEl).get('altcha') ?? '');
		if (!altcha) {
			error = 'Bitte kurz warten, bis die Sicherheitsprüfung abgeschlossen ist.';
			return;
		}
		error = null;
		sending = true;
		try {
			await api.magicLink({ email, altcha });
			sent = true;
		} catch (err) {
			error = err instanceof ApiError ? (err.detail ?? err.title) : 'Unbekannter Fehler';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>Bahn-Netzwerk-Tracker</title>
</svelte:head>

<h1>Bahn-Netzwerk-Tracker</h1>
<p>
	Dieses Projekt misst, wie gut das Netz in Zügen tatsächlich ist – getrennt nach DB-WLAN und
	eigenem Mobilfunk. Während einer Fahrt werden Latenz, Paketverlust, Standort und auf Wunsch die
	Durchsatzgeschwindigkeit erfasst und anonymisiert als Heatmap veröffentlicht.
</p>
<p>
	<strong>Datenschutz:</strong> IP-Adressen werden nie gespeichert, sondern nur für den Moment der
	Anfrage im Arbeitsspeicher verwendet, um grob den Netzbetreiber zu bestimmen. Veröffentlicht
	werden ausschließlich Aggregate über mehrere Fahrten hinweg, nie einzelne Positionen oder
	Zeitstempel.
</p>

{#if auth.loading}
	<p>Lade…</p>
{:else if auth.me}
	<div class="card-grid">
		<a class="card" href="/track">
			<h2>Fahrt starten</h2>
			<p>Live-Messung während der Zugfahrt.</p>
		</a>
		<a class="card" href="/map">
			<h2>Karte</h2>
			<p>Öffentliche Heatmap aller Messungen.</p>
		</a>
		<a class="card" href="/account">
			<h2>Konto</h2>
			<p>Eigene Fahrten, Export, Einstellungen.</p>
		</a>
	</div>
{:else if sent}
	<div class="notice success">
		Mail geschickt. Bitte den Bestätigungslink darin öffnen. In der Testversion:
		<a href="/mailpit">Mailpit öffnen</a>.
	</div>
{:else}
	<form class="card" bind:this={formEl} onsubmit={submit}>
		<h2>Anmelden</h2>
		{#if error}
			<div class="notice error">{error}</div>
		{/if}
		<div class="field">
			<label for="email">E-Mail</label>
			<input id="email" name="email" type="email" required bind:value={email} autocomplete="email" />
		</div>
		<altcha-widget challengeurl="/api/altcha/challenge" hidefooter></altcha-widget>
		<button class="btn" type="submit" disabled={sending} style="margin-top: 0.8rem">
			{sending ? 'Sende…' : 'Anmeldelink senden'}
		</button>
	</form>
{/if}
