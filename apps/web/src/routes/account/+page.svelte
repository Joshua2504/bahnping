<script lang="ts">
	// Deutsche Übersetzung für das ALTCHA-Widget registrieren; Englisch ist im Kernpaket bereits
	// enthalten. Die Sprache wird anhand von <html lang> automatisch erkannt (siehe +layout.svelte).
	import 'altcha/i18n/de';
	import { goto } from '$app/navigation';
	import type { ApiTokenInfo, Trip } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import { fmtDateTime, i18n, trainTypeLabel } from '#lib/i18n.svelte.js';

	const de = {
		title: 'Konto',
		loading: 'Lade…',
		loginRequired: 'Für das Konto ist eine Anmeldung nötig.',
		loginNow: 'Jetzt anmelden',
		loggedInAs: 'Angemeldet als',
		displayName: 'Anzeigename',
		nameLabel: 'Name',
		saved: 'Gespeichert.',
		saving: 'Speichere…',
		changeName: 'Name ändern',
		livePublicTitle: 'Live öffentlich',
		livePublicDesc:
			'Wenn aktiv, erscheint eine laufende Fahrt anonymisiert auf der öffentlichen Live-Karte der Startseite: ohne Namen, die Position auf ca. 1 km gerundet, und nur solange die letzte Messung nicht älter als 5 Minuten ist.',
		livePublicCheckbox: 'Meine laufenden Fahrten anonymisiert auf der öffentlichen Live-Karte zeigen',
		tripsTitle: 'Eigene Fahrten',
		noTrips: 'Noch keine Fahrten.',
		tripDelete: 'Löschen',
		tripDeleteConfirm: 'Wirklich?',
		tripDeleteActive: 'Laufende Fahrt erst beenden',
		tripDeleteError: 'Löschen fehlgeschlagen',
		colStart: 'Start',
		colTrainType: 'Zugtyp',
		colNumber: 'Nummer',
		colStatus: 'Status',
		colSamples: 'Messwerte',
		statusActive: 'aktiv',
		statusEnded: 'beendet',
		statusFlagged: 'markiert',
		dataTitle: 'Daten',
		exportLink: 'Eigene Daten exportieren (JSON)',
		tokensTitle: 'API-Tokens (CLI)',
		tokensDesc: 'Zum Anmelden der Kommandozeilen-CLI oder einer App, ohne Browser-Login.',
		noTokens: 'Noch keine Tokens angelegt.',
		colTokenName: 'Name',
		colCreated: 'Erstellt',
		colLastUsed: 'Zuletzt benutzt',
		never: 'nie',
		revoke: 'Widerrufen',
		revokeConfirm: 'Dieses Token wirklich widerrufen? CLI/App-Zugriff damit wird sofort beendet.',
		newTokenNotice: 'Neues Token (nur jetzt sichtbar, danach nicht mehr abrufbar):',
		copied: 'Kopiert ✓',
		copy: 'Kopieren',
		saveTokenHint: 'Bitte jetzt sicher speichern (z. B. Passwort-Manager) – aus Sicherheitsgründen wird es nicht erneut angezeigt.',
		tokenNamePlaceholder: 'z. B. Laptop-CLI',
		creating: 'Lege an…',
		createToken: 'Token anlegen',
		cliInstallTitle: 'CLI installieren',
		cliInstallDesc: 'Mit curl herunterladen statt über den Browser, sonst setzt macOS eine Quarantäne-Markierung auf die Datei:',
		macArm: '(Mac, Apple Silicon)',
		macIntel: '(Mac, Intel)',
		linux: '(Linux)',
		securityTitle: 'Sicherheit',
		securityDesc: 'Meldet alle Sitzungen auf allen Geräten ab.',
		loggingOutAll: 'Melde ab…',
		logoutAll: 'Überall abmelden',
		deleteTitle: 'Konto löschen',
		deleteDesc: 'Löscht sofort das Konto samt aller Fahrten und Messwerte. Das kann nicht rückgängig gemacht werden.',
		deleteButton: 'Konto löschen',
		deleteConfirmQuestion: 'Wirklich endgültig löschen?',
		deleting: 'Lösche…',
		deleteConfirmYes: 'Ja, endgültig löschen',
		cancel: 'Abbrechen',
		waitAltcha: 'Bitte kurz warten, bis die Sicherheitsprüfung abgeschlossen ist.',
		unknownError: 'Unbekannter Fehler',
		tripsLoadError: 'Fahrten konnten nicht geladen werden',
		tokensLoadError: 'Tokens konnten nicht geladen werden',
		tokenCreateError: 'Token konnte nicht angelegt werden',
		tokenRevokeError: 'Token konnte nicht widerrufen werden',
		settingsSaveError: 'Einstellung konnte nicht gespeichert werden',
		deleteError: 'Löschen fehlgeschlagen',
	};
	const en: typeof de = {
		title: 'Account',
		loading: 'Loading…',
		loginRequired: 'Signing in is required to use the account page.',
		loginNow: 'Sign in now',
		loggedInAs: 'Signed in as',
		displayName: 'Display name',
		nameLabel: 'Name',
		saved: 'Saved.',
		saving: 'Saving…',
		changeName: 'Change name',
		livePublicTitle: 'Public live',
		livePublicDesc:
			'When enabled, a running ride appears anonymised on the public live map on the home page: without a name, position rounded to about 1 km, and only while the latest measurement is no older than 5 minutes.',
		livePublicCheckbox: 'Show my running rides anonymised on the public live map',
		tripsTitle: 'Your rides',
		noTrips: 'No rides yet.',
		tripDelete: 'Delete',
		tripDeleteConfirm: 'Really?',
		tripDeleteActive: 'End the ride first',
		tripDeleteError: 'Deletion failed',
		colStart: 'Start',
		colTrainType: 'Train type',
		colNumber: 'Number',
		colStatus: 'Status',
		colSamples: 'Samples',
		statusActive: 'active',
		statusEnded: 'ended',
		statusFlagged: 'flagged',
		dataTitle: 'Data',
		exportLink: 'Export your data (JSON)',
		tokensTitle: 'API tokens (CLI)',
		tokensDesc: 'For signing in the command-line CLI or an app, without browser login.',
		noTokens: 'No tokens created yet.',
		colTokenName: 'Name',
		colCreated: 'Created',
		colLastUsed: 'Last used',
		never: 'never',
		revoke: 'Revoke',
		revokeConfirm: 'Really revoke this token? CLI/app access with it ends immediately.',
		newTokenNotice: 'New token (only visible now, cannot be retrieved afterwards):',
		copied: 'Copied ✓',
		copy: 'Copy',
		saveTokenHint: 'Please save it securely now (e.g. a password manager) — for security reasons it will not be shown again.',
		tokenNamePlaceholder: 'e.g. Laptop CLI',
		creating: 'Creating…',
		createToken: 'Create token',
		cliInstallTitle: 'Install the CLI',
		cliInstallDesc: 'Download with curl instead of the browser, otherwise macOS sets a quarantine flag on the file:',
		macArm: '(Mac, Apple Silicon)',
		macIntel: '(Mac, Intel)',
		linux: '(Linux)',
		securityTitle: 'Security',
		securityDesc: 'Signs out all sessions on all devices.',
		loggingOutAll: 'Signing out…',
		logoutAll: 'Sign out everywhere',
		deleteTitle: 'Delete account',
		deleteDesc: 'Immediately deletes the account along with all rides and measurements. This cannot be undone.',
		deleteButton: 'Delete account',
		deleteConfirmQuestion: 'Really delete permanently?',
		deleting: 'Deleting…',
		deleteConfirmYes: 'Yes, delete permanently',
		cancel: 'Cancel',
		waitAltcha: 'Please wait a moment until the security check has finished.',
		unknownError: 'Unknown error',
		tripsLoadError: 'Rides could not be loaded',
		tokensLoadError: 'Tokens could not be loaded',
		tokenCreateError: 'Token could not be created',
		tokenRevokeError: 'Token could not be revoked',
		settingsSaveError: 'Setting could not be saved',
		deleteError: 'Deletion failed',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	let displayName = $state('');
	let nameForm: HTMLFormElement | undefined = $state(undefined);
	let nameSaving = $state(false);
	let nameError = $state<string | null>(null);
	let nameSuccess = $state(false);

	let trips = $state<Trip[] | null>(null);
	// Zweistufiges Löschen je Fahrt: erster Klick merkt die ID, zweiter löscht.
	let confirmTripId = $state<string | null>(null);
	let deletingTripId = $state<string | null>(null);
	let tripDeleteError = $state<string | null>(null);

	async function deleteTrip(id: string): Promise<void> {
		if (confirmTripId !== id) {
			confirmTripId = id;
			return;
		}
		deletingTripId = id;
		tripDeleteError = null;
		try {
			await api.deleteTrip(id);
			trips = (trips ?? []).filter((t) => t.id !== id);
		} catch (err) {
			tripDeleteError = err instanceof ApiError ? (err.detail ?? err.title) : m.tripDeleteError;
		} finally {
			deletingTripId = null;
			confirmTripId = null;
		}
	}
	let tripsError = $state<string | null>(null);

	let deleteStep = $state(0);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let loggingOutAll = $state(false);

	let livePublicSaving = $state(false);
	let livePublicError = $state<string | null>(null);

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
			tripsError = err instanceof ApiError ? (err.detail ?? err.title) : m.tripsLoadError;
		}
	}

	async function loadTokens(): Promise<void> {
		try {
			tokens = await api.listTokens();
		} catch (err) {
			tokensError = err instanceof ApiError ? (err.detail ?? err.title) : m.tokensLoadError;
		}
	}

	async function createToken(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!tokenForm) return;
		const altcha = String(new FormData(tokenForm).get('altcha') ?? '');
		tokenError = null;
		if (!altcha) {
			tokenError = m.waitAltcha;
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
			tokenError = err instanceof ApiError ? (err.detail ?? err.title) : m.tokenCreateError;
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
		if (!confirm(m.revokeConfirm)) return;
		revokingId = id;
		try {
			await api.revokeToken(id);
			await loadTokens();
		} catch (err) {
			tokensError = err instanceof ApiError ? (err.detail ?? err.title) : m.tokenRevokeError;
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
			nameError = m.waitAltcha;
			return;
		}
		nameSaving = true;
		try {
			await api.updateMe({ displayName, altcha });
			await auth.load();
			nameSuccess = true;
		} catch (err) {
			nameError = err instanceof ApiError ? (err.detail ?? err.title) : m.unknownError;
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
			deleteError = err instanceof ApiError ? (err.detail ?? err.title) : m.deleteError;
		} finally {
			deleting = false;
		}
	}

	function statusLabel(status: Trip['status']): string {
		switch (status) {
			case 'active':
				return m.statusActive;
			case 'ended':
				return m.statusEnded;
			case 'flagged':
				return m.statusFlagged;
		}
	}

	async function toggleLivePublic(e: Event): Promise<void> {
		const checked = (e.target as HTMLInputElement).checked;
		livePublicSaving = true;
		livePublicError = null;
		try {
			const updated = await api.updateMeSettings({ livePublic: checked });
			auth.me = updated;
		} catch (err) {
			livePublicError = err instanceof ApiError ? (err.detail ?? err.title) : m.settingsSaveError;
		} finally {
			livePublicSaving = false;
		}
	}
</script>

<svelte:head>
	<title>{m.title}</title>
</svelte:head>

<h1>{m.title}</h1>

{#if auth.loading}
	<p>{m.loading}</p>
{:else if !auth.me}
	<div class="notice warn">{m.loginRequired} <a href="/">{m.loginNow}</a>.</div>
{:else}
	<div class="card">
		<h2>{m.loggedInAs}</h2>
		<p>{auth.me.email}</p>
	</div>

	<form class="card" bind:this={nameForm} onsubmit={saveName}>
		<h2>{m.displayName}</h2>
		{#if nameError}<div class="notice error">{nameError}</div>{/if}
		{#if nameSuccess}<div class="notice success">{m.saved}</div>{/if}
		<div class="field">
			<label for="displayName">{m.nameLabel}</label>
			<input id="displayName" bind:value={displayName} minlength="2" maxlength="32" required />
		</div>
		<altcha-widget challengeurl="/api/altcha/challenge" hidefooter></altcha-widget>
		<button class="btn" type="submit" disabled={nameSaving} style="margin-top: 0.8rem">
			{nameSaving ? m.saving : m.changeName}
		</button>
	</form>

	<div class="card">
		<h2>{m.livePublicTitle}</h2>
		<p>{m.livePublicDesc}</p>
		{#if livePublicError}<div class="notice error">{livePublicError}</div>{/if}
		<label style="display: inline-flex; align-items: center; gap: 0.5rem">
			<input
				type="checkbox"
				style="width: auto; min-height: auto"
				checked={auth.me.livePublic}
				disabled={livePublicSaving}
				onchange={toggleLivePublic}
			/>
			{m.livePublicCheckbox}
		</label>
	</div>

	<div class="card">
		<h2>{m.tripsTitle}</h2>
		{#if tripsError}
			<div class="notice error">{tripsError}</div>
		{:else if trips === null}
			<p>{m.loading}</p>
		{:else if trips.length === 0}
			<p>{m.noTrips}</p>
		{:else}
			{#if tripDeleteError}<div class="notice error">{tripDeleteError}</div>{/if}
			<table>
				<thead>
					<tr>
						<th>{m.colStart}</th>
						<th>{m.colTrainType}</th>
						<th>{m.colNumber}</th>
						<th>{m.colStatus}</th>
						<th>{m.colSamples}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each trips as trip (trip.id)}
						<tr>
							<td><a href={`/trips/${trip.id}`}>{fmtDateTime(trip.startedAt)}</a></td>
							<td>{trainTypeLabel(trip.trainType)}</td>
							<td>{trip.trainNumber ?? '–'}</td>
							<td>
								{statusLabel(trip.status)}
								{#if trip.status === 'active'}<span class="live-badge">LIVE</span>{/if}
							</td>
							<td>{trip.sampleCount ?? '–'}</td>
							<td>
								<button
									class="btn {confirmTripId === trip.id ? 'danger' : 'secondary'} trip-delete"
									disabled={trip.status === 'active' || deletingTripId === trip.id}
									title={trip.status === 'active' ? m.tripDeleteActive : undefined}
									onclick={() => deleteTrip(trip.id)}
								>
									{confirmTripId === trip.id ? m.tripDeleteConfirm : m.tripDelete}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<div class="card">
		<h2>{m.dataTitle}</h2>
		<p><a class="btn secondary" href={api.exportUrl()} download>{m.exportLink}</a></p>
	</div>

	<div class="card">
		<h2>{m.tokensTitle}</h2>
		<p>{m.tokensDesc}</p>

		{#if tokensError}
			<div class="notice error">{tokensError}</div>
		{:else if tokens === null}
			<p>{m.loading}</p>
		{:else if tokens.length === 0}
			<p>{m.noTokens}</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>{m.colTokenName}</th>
						<th>{m.colCreated}</th>
						<th>{m.colLastUsed}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each tokens as t (t.id)}
						<tr>
							<td>{t.name}</td>
							<td>{fmtDateTime(t.createdAt)}</td>
							<td>{t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : m.never}</td>
							<td>
								<button class="btn danger" style="padding: 0.3rem 0.7rem" onclick={() => revokeToken(t.id)} disabled={revokingId === t.id}>
									{m.revoke}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if newToken}
			<div class="notice success" style="margin-top: 0.8rem">
				<p><strong>{m.newTokenNotice}</strong></p>
				<code style="display: block; word-break: break-all; padding: 0.5rem; background: rgba(0, 0, 0, 0.3); border-radius: 4px">
					{newToken}
				</code>
				<button class="btn secondary" style="margin-top: 0.5rem" onclick={copyToken}>
					{tokenCopied ? m.copied : m.copy}
				</button>
				<p style="margin-top: 0.5rem">{m.saveTokenHint}</p>
			</div>
		{/if}

		<form class="track-actions" bind:this={tokenForm} onsubmit={createToken} style="margin-top: 0.8rem; flex-wrap: wrap">
			{#if tokenError}<div class="notice error" style="width: 100%">{tokenError}</div>{/if}
			<div class="field" style="min-width: 200px">
				<label for="tokenName">{m.nameLabel}</label>
				<input id="tokenName" bind:value={tokenName} maxlength="60" placeholder={m.tokenNamePlaceholder} required />
			</div>
			<altcha-widget challengeurl="/api/altcha/challenge" hidefooter></altcha-widget>
			<button class="btn" type="submit" disabled={tokenCreating}>{tokenCreating ? m.creating : m.createToken}</button>
		</form>

		<h3 style="margin-top: 1.2rem">{m.cliInstallTitle}</h3>
		<p>{m.cliInstallDesc}</p>
		<ul style="padding-left: 1.2rem">
			<li><a href="/dl/bahnping-darwin-arm64">bahnping-darwin-arm64</a> {m.macArm}</li>
			<li><a href="/dl/bahnping-darwin-amd64">bahnping-darwin-amd64</a> {m.macIntel}</li>
			<li><a href="/dl/bahnping-linux-amd64">bahnping-linux-amd64</a> {m.linux}</li>
		</ul>
		<pre style="background: rgba(0, 0, 0, 0.3); padding: 0.6rem; border-radius: 4px; overflow-x: auto"><code
				>curl -fsSLo bahnping https://bahnping.treudler.net/dl/bahnping-darwin-arm64 &amp;&amp; chmod +x bahnping
./bahnping login https://bahnping.treudler.net
./bahnping track</code
			></pre>
	</div>

	<div class="card">
		<h2>{m.securityTitle}</h2>
		<p>{m.securityDesc}</p>
		<button class="btn secondary" onclick={logoutAll} disabled={loggingOutAll}>
			{loggingOutAll ? m.loggingOutAll : m.logoutAll}
		</button>
	</div>

	<div class="card">
		<h2>{m.deleteTitle}</h2>
		<p>{m.deleteDesc}</p>
		{#if deleteError}<div class="notice error">{deleteError}</div>{/if}
		{#if deleteStep === 0}
			<button class="btn danger" onclick={() => (deleteStep = 1)}>{m.deleteButton}</button>
		{:else}
			<p><strong>{m.deleteConfirmQuestion}</strong></p>
			<div class="track-actions">
				<button class="btn danger" onclick={deleteAccount} disabled={deleting}>
					{deleting ? m.deleting : m.deleteConfirmYes}
				</button>
				<button class="btn secondary" onclick={() => (deleteStep = 0)}>{m.cancel}</button>
			</div>
		{/if}
	</div>
{/if}
