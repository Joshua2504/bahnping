<script lang="ts">
	// Admin-Seite: Review unbekannter/aller ASNs, Netzklasse per Hand setzen, SMTP-Konfiguration.
	import { NET_CLASSES, NET_CLASS_LABELS, type AdminAsn, type NetClass, type SmtpSecurity, type SmtpSettings } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';

	let tab = $state<'asns' | 'smtp'>('asns');

	// ---------- ASN-Review ----------

	let filter = $state<'unknown' | 'all'>('unknown');
	let rows = $state<AdminAsn[] | null>(null);
	let loadError = $state<string | null>(null);
	let pendingClass = $state<Record<number, NetClass>>({});
	let saving = $state<Record<number, boolean>>({});
	let feedback = $state<Record<number, string>>({});

	async function load(): Promise<void> {
		loadError = null;
		try {
			rows = await api.adminAsns(filter);
			pendingClass = Object.fromEntries((rows ?? []).map((r) => [r.asn, r.netClass]));
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : 'ASNs konnten nicht geladen werden';
		}
	}

	$effect(() => {
		if (auth.me?.role === 'admin') {
			void load();
			void loadSmtp();
		}
	});

	async function save(asn: number): Promise<void> {
		const netClass = pendingClass[asn];
		if (!netClass) return;
		saving = { ...saving, [asn]: true };
		feedback = { ...feedback, [asn]: '' };
		try {
			const res = await api.adminUpdateAsn(asn, { netClass });
			rows = (rows ?? []).map((r) => (r.asn === asn ? res.asn : r));
			feedback = { ...feedback, [asn]: `Gespeichert, ${res.samplesUpdated} Messwerte aktualisiert.` };
		} catch (err) {
			feedback = { ...feedback, [asn]: err instanceof ApiError ? (err.detail ?? err.title) : 'Speichern fehlgeschlagen' };
		} finally {
			saving = { ...saving, [asn]: false };
		}
	}

	// ---------- SMTP-Konfiguration ----------

	const SECURITY_DEFAULT_PORT: Record<SmtpSecurity, number> = { none: 25, starttls: 587, tls: 465 };

	let smtp = $state<SmtpSettings | null>(null);
	let smtpLoadError = $state<string | null>(null);
	let smtpMode = $state<'env' | 'custom'>('env');
	let smtpHost = $state('');
	let smtpPort = $state(587);
	let smtpSecurity = $state<SmtpSecurity>('starttls');
	let smtpUser = $state('');
	let smtpPassword = $state('');
	let smtpRemovePassword = $state(false);
	let smtpFrom = $state('');
	let smtpRejectUnauthorized = $state(true);
	let smtpSaving = $state(false);
	let smtpSaveMessage = $state<string | null>(null);
	let smtpSaveError = $state<string | null>(null);

	let testTo = $state('');
	let testSending = $state(false);
	let testMessage = $state<string | null>(null);
	let testError = $state<string | null>(null);

	async function loadSmtp(): Promise<void> {
		smtpLoadError = null;
		try {
			smtp = await api.adminGetSmtp();
			smtpMode = smtp.mode;
			smtpHost = smtp.host;
			smtpPort = smtp.port;
			smtpSecurity = smtp.security;
			smtpUser = smtp.user;
			smtpFrom = smtp.from;
			smtpRejectUnauthorized = smtp.rejectUnauthorized;
			smtpPassword = '';
			smtpRemovePassword = false;
			testTo = auth.me?.email ?? '';
		} catch (err) {
			smtpLoadError = err instanceof ApiError ? (err.detail ?? err.title) : 'SMTP-Einstellungen konnten nicht geladen werden';
		}
	}

	function onSecurityChange(next: SmtpSecurity): void {
		const prevDefault = SECURITY_DEFAULT_PORT[smtpSecurity];
		if (smtpPort === prevDefault) {
			smtpPort = SECURITY_DEFAULT_PORT[next];
		}
		smtpSecurity = next;
	}

	async function saveSmtp(): Promise<void> {
		smtpSaving = true;
		smtpSaveMessage = null;
		smtpSaveError = null;
		try {
			const body = {
				mode: smtpMode,
				host: smtpHost,
				port: smtpPort,
				security: smtpSecurity,
				user: smtpUser,
				from: smtpFrom,
				rejectUnauthorized: smtpRejectUnauthorized,
				...(smtpRemovePassword ? { password: '' } : smtpPassword ? { password: smtpPassword } : {}),
			};
			smtp = await api.adminUpdateSmtp(body);
			smtpPassword = '';
			smtpRemovePassword = false;
			smtpSaveMessage = 'Gespeichert.';
		} catch (err) {
			smtpSaveError = err instanceof ApiError ? (err.detail ?? err.title) : 'Speichern fehlgeschlagen';
		} finally {
			smtpSaving = false;
		}
	}

	async function sendTestMail(): Promise<void> {
		testSending = true;
		testMessage = null;
		testError = null;
		try {
			const res = await api.adminTestSmtp(testTo ? { to: testTo } : {});
			testMessage = `Testmail gesendet (Message-ID ${res.messageId}).`;
		} catch (err) {
			testError = err instanceof ApiError ? (err.detail ?? err.title) : 'Testmail konnte nicht gesendet werden';
		} finally {
			testSending = false;
		}
	}
</script>

<svelte:head>
	<title>Admin</title>
</svelte:head>

<h1>Admin</h1>

{#if auth.loading}
	<p>Lade…</p>
{:else if auth.me?.role !== 'admin'}
	<div class="notice warn">Dieser Bereich ist nur für Admins.</div>
{:else}
	<div class="app-nav" style="padding: 0; border: none; background: transparent; margin-bottom: 1rem">
		<button class="btn {tab === 'asns' ? '' : 'secondary'}" onclick={() => (tab = 'asns')}>ASN-Review</button>
		<button class="btn {tab === 'smtp' ? '' : 'secondary'}" onclick={() => (tab = 'smtp')}>E-Mail-Versand (SMTP)</button>
	</div>

	{#if tab === 'asns'}
		<div class="card">
			<div class="field" style="max-width: 240px">
				<label for="filter">Filter</label>
				<select id="filter" bind:value={filter} onchange={load}>
					<option value="unknown">nur unbekannte</option>
					<option value="all">alle</option>
				</select>
			</div>
		</div>

		{#if loadError}
			<div class="notice error">{loadError}</div>
		{:else if rows === null}
			<p>Lade…</p>
		{:else if rows.length === 0}
			<p>Keine ASNs gefunden.</p>
		{:else}
			<div class="card" style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>ASN</th>
							<th>Name</th>
							<th>Klasse</th>
							<th>Quelle</th>
							<th>Sichtungen</th>
							<th>Messwerte</th>
							<th>Fahrten</th>
							<th>Review</th>
							<th>Neue Klasse</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.asn)}
							<tr>
								<td>AS{row.asn}</td>
								<td>{row.name}</td>
								<td>{NET_CLASS_LABELS[row.netClass]}</td>
								<td>{row.source}</td>
								<td>{row.seen}</td>
								<td>{row.samples}</td>
								<td>{row.trips}</td>
								<td>{row.reviewedAt ? new Date(row.reviewedAt).toLocaleString('de-DE') : '–'}</td>
								<td>
									<select
										value={pendingClass[row.asn] ?? row.netClass}
										onchange={(e) => (pendingClass = { ...pendingClass, [row.asn]: (e.target as HTMLSelectElement).value as NetClass })}
									>
										{#each NET_CLASSES as c (c)}
											<option value={c}>{NET_CLASS_LABELS[c]}</option>
										{/each}
									</select>
								</td>
								<td>
									<button class="btn" disabled={saving[row.asn]} onclick={() => save(row.asn)}>
										{saving[row.asn] ? 'Speichere…' : 'Speichern'}
									</button>
									{#if feedback[row.asn]}<div style="font-size: 0.8rem; margin-top: 0.3rem">{feedback[row.asn]}</div>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		<h2>E-Mail-Versand (SMTP)</h2>

		{#if smtpLoadError}
			<div class="notice error">{smtpLoadError}</div>
		{:else if smtp === null}
			<p>Lade…</p>
		{:else}
			<div class="card">
				<div class="field">
					<label for="smtp-mode">Quelle</label>
					<select id="smtp-mode" bind:value={smtpMode}>
						<option value="env">Standard aus Serverkonfiguration (aktuell: {smtp.envDefaults.host}:{smtp.envDefaults.port})</option>
						<option value="custom">Eigener SMTP-Server</option>
					</select>
				</div>

				{#if smtpMode === 'custom'}
					<div class="notice warn">
						Achtung: Bei eigenem SMTP-Server landen Anmelde-Links (Magic Links) nicht mehr in Mailpit, sondern werden über den
						konfigurierten Server versendet.
					</div>

					<div class="card-grid">
						<div class="field">
							<label for="smtp-host">Host</label>
							<input id="smtp-host" type="text" bind:value={smtpHost} maxlength={253} placeholder="smtp.example.com" />
						</div>
						<div class="field">
							<label for="smtp-port">Port</label>
							<input id="smtp-port" type="number" min="1" max="65535" bind:value={smtpPort} />
						</div>
						<div class="field">
							<label for="smtp-security">Verschlüsselung</label>
							<select
								id="smtp-security"
								value={smtpSecurity}
								onchange={(e) => onSecurityChange((e.target as HTMLSelectElement).value as SmtpSecurity)}
							>
								<option value="none">Keine</option>
								<option value="starttls">STARTTLS</option>
								<option value="tls">SSL/TLS</option>
							</select>
						</div>
						<div class="field">
							<label for="smtp-user">Benutzer</label>
							<input id="smtp-user" type="text" bind:value={smtpUser} autocomplete="off" />
						</div>
						<div class="field">
							<label for="smtp-password">Passwort</label>
							<input
								id="smtp-password"
								type="password"
								bind:value={smtpPassword}
								disabled={smtpRemovePassword}
								autocomplete="new-password"
								placeholder={smtp.passwordSet ? 'gespeichert – leer lassen zum Beibehalten' : ''}
							/>
							{#if smtp.passwordSet}
								<label style="flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--fg-dim)">
									<input type="checkbox" bind:checked={smtpRemovePassword} style="min-height: auto; width: auto" />
									Passwort entfernen
								</label>
							{/if}
						</div>
						<div class="field">
							<label for="smtp-from">Absender</label>
							<input id="smtp-from" type="text" bind:value={smtpFrom} placeholder="Name &lt;mail@domain&gt;" />
						</div>
					</div>

					<label style="display: flex; flex-direction: row; align-items: center; gap: 0.4rem; margin-bottom: 0.9rem">
						<input type="checkbox" bind:checked={smtpRejectUnauthorized} style="min-height: auto; width: auto" />
						Zertifikat prüfen
					</label>
				{/if}

				<button class="btn" disabled={smtpSaving} onclick={saveSmtp}>{smtpSaving ? 'Speichere…' : 'Speichern'}</button>

				{#if smtpSaveMessage}<div class="notice success">{smtpSaveMessage}</div>{/if}
				{#if smtpSaveError}<div class="notice error">{smtpSaveError}</div>{/if}
			</div>

			<div class="card">
				<h3>Testmail senden</h3>
				<div class="field" style="max-width: 320px">
					<label for="smtp-test-to">Empfänger</label>
					<input id="smtp-test-to" type="email" bind:value={testTo} placeholder={auth.me?.email ?? ''} />
				</div>
				<button class="btn secondary" disabled={testSending} onclick={sendTestMail}>
					{testSending ? 'Sende…' : 'Testmail senden'}
				</button>
				{#if testMessage}<div class="notice success">{testMessage}</div>{/if}
				{#if testError}<div class="notice error">{testError}</div>{/if}
			</div>
		{/if}
	{/if}
{/if}
