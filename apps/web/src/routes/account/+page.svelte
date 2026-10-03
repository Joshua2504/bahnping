<script lang="ts">
	import { goto } from '$app/navigation';
	import { TRAIN_TYPE_LABELS, type Trip } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';

	let displayName = $state('');
	let nameForm: HTMLFormElement | undefined = $state(undefined);
	let nameSaving = $state(false);
	let nameError = $state<string | null>(null);
	let nameSuccess = $state(false);

	let trips = $state<Trip[] | null>(null);
	let tripsError = $state<string | null>(null);

	let deleteStep = $state(0);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let loggingOutAll = $state(false);

	$effect(() => {
		if (auth.me) displayName = auth.me.displayName ?? '';
	});

	$effect(() => {
		if (!auth.me) return;
		void loadTrips();
	});

	async function loadTrips(): Promise<void> {
		try {
			trips = await api.listTrips();
		} catch (err) {
			tripsError = err instanceof ApiError ? (err.detail ?? err.title) : 'Fahrten konnten nicht geladen werden';
		}
	}

	async function saveName(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!nameForm) return;
		const altcha = String(new FormData(nameForm).get('altcha') ?? '');
		nameError = null;
		nameSuccess = false;
		if (!altcha) {
			nameError = 'Bitte kurz warten, bis die Sicherheitsprüfung abgeschlossen ist.';
			return;
		}
		nameSaving = true;
		try {
			await api.updateMe({ displayName, altcha });
			await auth.load();
			nameSuccess = true;
		} catch (err) {
			nameError = err instanceof ApiError ? (err.detail ?? err.title) : 'Unbekannter Fehler';
		} finally {
			nameSaving = false;
		}
	}

	async function logoutAll(): Promise<void> {
		loggingOutAll = true;
		try {
			await auth.logoutAll();
			await goto('/');
		} finally {
			loggingOutAll = false;
		}
	}

	async function deleteAccount(): Promise<void> {
		deleting = true;
		deleteError = null;
		try {
			await api.deleteMe();
			auth.me = null;
			await goto('/');
		} catch (err) {
			deleteError = err instanceof ApiError ? (err.detail ?? err.title) : 'Löschen fehlgeschlagen';
		} finally {
			deleting = false;
		}
	}

	function statusLabel(status: Trip['status']): string {
		switch (status) {
			case 'active':
				return 'aktiv';
			case 'ended':
				return 'beendet';
			case 'flagged':
				return 'markiert';
		}
	}
</script>

<svelte:head>
	<title>Konto</title>
</svelte:head>

<h1>Konto</h1>

{#if auth.loading}
	<p>Lade…</p>
{:else if !auth.me}
	<div class="notice warn">Für das Konto ist eine Anmeldung nötig. <a href="/">Jetzt anmelden</a>.</div>
{:else}
	<div class="card">
		<h2>Angemeldet als</h2>
		<p>{auth.me.email}</p>
	</div>

	<form class="card" bind:this={nameForm} onsubmit={saveName}>
		<h2>Anzeigename</h2>
		{#if nameError}<div class="notice error">{nameError}</div>{/if}
		{#if nameSuccess}<div class="notice success">Gespeichert.</div>{/if}
		<div class="field">
			<label for="displayName">Name</label>
			<input id="displayName" bind:value={displayName} minlength="2" maxlength="32" required />
		</div>
		<altcha-widget challengeurl="/api/altcha/challenge" hidefooter></altcha-widget>
		<button class="btn" type="submit" disabled={nameSaving} style="margin-top: 0.8rem">
			{nameSaving ? 'Speichere…' : 'Name ändern'}
		</button>
	</form>

	<div class="card">
		<h2>Eigene Fahrten</h2>
		{#if tripsError}
			<div class="notice error">{tripsError}</div>
		{:else if trips === null}
			<p>Lade…</p>
		{:else if trips.length === 0}
			<p>Noch keine Fahrten.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Start</th>
						<th>Zugtyp</th>
						<th>Nummer</th>
						<th>Status</th>
						<th>Messwerte</th>
					</tr>
				</thead>
				<tbody>
					{#each trips as trip (trip.id)}
						<tr>
							<td>{new Date(trip.startedAt).toLocaleString('de-DE')}</td>
							<td>{TRAIN_TYPE_LABELS[trip.trainType]}</td>
							<td>{trip.trainNumber ?? '–'}</td>
							<td>{statusLabel(trip.status)}</td>
							<td>{trip.sampleCount ?? '–'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<div class="card">
		<h2>Daten</h2>
		<p><a class="btn secondary" href={api.exportUrl()} download>Eigene Daten exportieren (JSON)</a></p>
	</div>

	<div class="card">
		<h2>Sicherheit</h2>
		<p>Meldet alle Sitzungen auf allen Geräten ab.</p>
		<button class="btn secondary" onclick={logoutAll} disabled={loggingOutAll}>
			{loggingOutAll ? 'Melde ab…' : 'Überall abmelden'}
		</button>
	</div>

	<div class="card">
		<h2>Konto löschen</h2>
		<p>Löscht sofort das Konto samt aller Fahrten und Messwerte. Das kann nicht rückgängig gemacht werden.</p>
		{#if deleteError}<div class="notice error">{deleteError}</div>{/if}
		{#if deleteStep === 0}
			<button class="btn danger" onclick={() => (deleteStep = 1)}>Konto löschen</button>
		{:else}
			<p><strong>Wirklich endgültig löschen?</strong></p>
			<div class="track-actions">
				<button class="btn danger" onclick={deleteAccount} disabled={deleting}>
					{deleting ? 'Lösche…' : 'Ja, endgültig löschen'}
				</button>
				<button class="btn secondary" onclick={() => (deleteStep = 0)}>Abbrechen</button>
			</div>
		{/if}
	</div>
{/if}
