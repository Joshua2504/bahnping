<script lang="ts">
	import { goto } from '$app/navigation';
	import { TRAIN_TYPE_LABELS, type ApiTokenInfo, type Trip } from '@bahn/shared';
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

	let tokens = $state<ApiTokenInfo[] | null>(null);
	let tokensError = $state<string | null>(null);
	let tokenForm: HTMLFormElement | undefined = $state(undefined);
	let tokenName = $state('');
	let tokenCreating = $state(false);
	let tokenError = $state<string | null>(null);
	/** Das Token wird nur direkt nach dem Anlegen einmalig angezeigt, danach nie wieder. */
	let newToken = $state<string | null>(null);
	let tokenCopied = $state(false);
	let revokingId = $state<string | null>(null);

	$effect(() => {
		if (auth.me) displayName = auth.me.displayName ?? '';
	});

	$effect(() => {
		if (!auth.me) return;
		void loadTrips();
		void loadTokens();
	});

	async function loadTrips(): Promise<void> {
		try {
			trips = await api.listTrips();
		} catch (err) {
			tripsError = err instanceof ApiError ? (err.detail ?? err.title) : 'Fahrten konnten nicht geladen werden';
		}
	}

	async function loadTokens(): Promise<void> {
		try {
			tokens = await api.listTokens();
		} catch (err) {
			tokensError = err instanceof ApiError ? (err.detail ?? err.title) : 'Tokens konnten nicht geladen werden';
		}
	}

	async function createToken(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!tokenForm) return;
		const altcha = String(new FormData(tokenForm).get('altcha') ?? '');
		tokenError = null;
		if (!altcha) {
			tokenError = 'Bitte kurz warten, bis die Sicherheitsprüfung abgeschlossen ist.';
			return;
		}
		tokenCreating = true;
		try {
			const created = await api.createToken({ name: tokenName, altcha });
			newToken = created.token;
			tokenCopied = false;
			tokenName = '';
			await loadTokens();
		} catch (err) {
			tokenError = err instanceof ApiError ? (err.detail ?? err.title) : 'Token konnte nicht angelegt werden';
		} finally {
			tokenCreating = false;
		}
	}

	async function copyToken(): Promise<void> {
		if (!newToken) return;
		try {
			await navigator.clipboard.writeText(newToken);
			tokenCopied = true;
		} catch {
			tokenCopied = false;
		}
	}

	async function revokeToken(id: string): Promise<void> {
		if (!confirm('Dieses Token wirklich widerrufen? CLI/App-Zugriff damit wird sofort beendet.')) return;
		revokingId = id;
		try {
			await api.revokeToken(id);
			await loadTokens();
		} catch (err) {
			tokensError = err instanceof ApiError ? (err.detail ?? err.title) : 'Token konnte nicht widerrufen werden';
		} finally {
			revokingId = null;
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
							<td><a href={`/trips/${trip.id}`}>{new Date(trip.startedAt).toLocaleString('de-DE')}</a></td>
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
		<h2>API-Tokens (CLI)</h2>
		<p>Zum Anmelden der Kommandozeilen-CLI oder einer App, ohne Browser-Login.</p>

		{#if tokensError}
			<div class="notice error">{tokensError}</div>
		{:else if tokens === null}
			<p>Lade…</p>
		{:else if tokens.length === 0}
			<p>Noch keine Tokens angelegt.</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Erstellt</th>
						<th>Zuletzt benutzt</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each tokens as t (t.id)}
						<tr>
							<td>{t.name}</td>
							<td>{new Date(t.createdAt).toLocaleString('de-DE')}</td>
							<td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('de-DE') : 'nie'}</td>
							<td>
								<button class="btn danger" style="padding: 0.3rem 0.7rem" onclick={() => revokeToken(t.id)} disabled={revokingId === t.id}>
									Widerrufen
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if newToken}
			<div class="notice success" style="margin-top: 0.8rem">
				<p><strong>Neues Token (nur jetzt sichtbar, danach nicht mehr abrufbar):</strong></p>
				<code style="display: block; word-break: break-all; padding: 0.5rem; background: rgba(0, 0, 0, 0.3); border-radius: 4px">
					{newToken}
				</code>
				<button class="btn secondary" style="margin-top: 0.5rem" onclick={copyToken}>
					{tokenCopied ? 'Kopiert ✓' : 'Kopieren'}
				</button>
				<p style="margin-top: 0.5rem">
					Bitte jetzt sicher speichern (z. B. Passwort-Manager) – aus Sicherheitsgründen wird es nicht erneut angezeigt.
				</p>
			</div>
		{/if}

		<form class="track-actions" bind:this={tokenForm} onsubmit={createToken} style="margin-top: 0.8rem; flex-wrap: wrap">
			{#if tokenError}<div class="notice error" style="width: 100%">{tokenError}</div>{/if}
			<div class="field" style="min-width: 200px">
				<label for="tokenName">Name</label>
				<input id="tokenName" bind:value={tokenName} maxlength="60" placeholder="z. B. Laptop-CLI" required />
			</div>
			<altcha-widget challengeurl="/api/altcha/challenge" hidefooter></altcha-widget>
			<button class="btn" type="submit" disabled={tokenCreating}>{tokenCreating ? 'Lege an…' : 'Token anlegen'}</button>
		</form>

		<h3 style="margin-top: 1.2rem">CLI installieren</h3>
		<p>
			Mit <code>curl</code> herunterladen statt über den Browser, sonst setzt macOS eine Quarantäne-Markierung auf die Datei:
		</p>
		<ul style="padding-left: 1.2rem">
			<li><a href="/dl/bahnnet-darwin-arm64">bahnnet-darwin-arm64</a> (Mac, Apple Silicon)</li>
			<li><a href="/dl/bahnnet-darwin-amd64">bahnnet-darwin-amd64</a> (Mac, Intel)</li>
			<li><a href="/dl/bahnnet-linux-amd64">bahnnet-linux-amd64</a> (Linux)</li>
		</ul>
		<pre style="background: rgba(0, 0, 0, 0.3); padding: 0.6rem; border-radius: 4px; overflow-x: auto"><code
				>curl -fsSLo bahnnet https://bahnnet.treudler.net/dl/bahnnet-darwin-arm64 &amp;&amp; chmod +x bahnnet
./bahnnet login https://bahnnet.treudler.net
./bahnnet track</code
			></pre>
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
