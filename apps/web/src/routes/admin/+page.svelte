<script lang="ts">
	// Admin-Seite: Review unbekannter/aller ASNs, Netzklasse per Hand setzen, SMTP-Konfiguration,
	// Anbieterangaben für Impressum/Datenschutz.
	import { NET_CLASSES, type AdminAsn, type LegalInfoUpdate, type NetClass, type SmtpSecurity, type SmtpSettings } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import { i18n, netClassLabel, fmtDateTime } from '#lib/i18n.svelte.js';

	let tab = $state<'asns' | 'smtp' | 'legal'>('asns');

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
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : m.asns.loadError;
		}
	}

	$effect(() => {
		if (auth.me?.role === 'admin') {
			void load();
			void loadSmtp();
			void loadLegal();
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
			feedback = { ...feedback, [asn]: m.asns.saved(res.samplesUpdated) };
		} catch (err) {
			feedback = { ...feedback, [asn]: err instanceof ApiError ? (err.detail ?? err.title) : m.asns.saveError };
		} finally {
			saving = { ...saving, [asn]: false };
		}
	}

	// ---------- Impressum/Datenschutz ----------

	const LEGAL_FIELDS = ['name', 'street', 'postalCity', 'country', 'email', 'phone', 'contentResponsible', 'hoster', 'mailProvider'] as const;
	let legal = $state<LegalInfoUpdate | null>(null);
	let legalLoadError = $state<string | null>(null);
	let legalSaving = $state(false);
	let legalSaveMessage = $state<string | null>(null);
	let legalSaveError = $state<string | null>(null);

	async function loadLegal(): Promise<void> {
		legalLoadError = null;
		try {
			const { updatedAt: _, ...rest } = await api.publicLegal();
			legal = rest;
		} catch (err) {
			legalLoadError = err instanceof ApiError ? (err.detail ?? err.title) : m.legal.loadError;
		}
	}

	async function saveLegal(): Promise<void> {
		if (!legal) return;
		legalSaving = true;
		legalSaveMessage = null;
		legalSaveError = null;
		try {
			const { updatedAt: _, ...rest } = await api.adminUpdateLegal(legal);
			legal = rest;
			legalSaveMessage = m.legal.saveSuccess;
		} catch (err) {
			legalSaveError = err instanceof ApiError ? (err.detail ?? err.title) : m.legal.saveError;
		} finally {
			legalSaving = false;
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
			smtpLoadError = err instanceof ApiError ? (err.detail ?? err.title) : m.smtp.loadError;
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
			smtpSaveMessage = m.smtp.saveSuccess;
		} catch (err) {
			smtpSaveError = err instanceof ApiError ? (err.detail ?? err.title) : m.smtp.saveError;
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
			testMessage = m.smtp.testSuccess(res.messageId);
		} catch (err) {
			testError = err instanceof ApiError ? (err.detail ?? err.title) : m.smtp.testError;
		} finally {
			testSending = false;
		}
	}

	const de = {
		title: 'Admin',
		adminOnly: 'Dieser Bereich ist nur für Admins.',
		loading: 'Lade…',
		tabs: { asns: 'ASN-Review', smtp: 'E-Mail-Versand (SMTP)', legal: 'Impressum/Datenschutz' },
		asns: {
			filterLabel: 'Filter',
			filterUnknown: 'nur unbekannte',
			filterAll: 'alle',
			loadError: 'ASNs konnten nicht geladen werden',
			empty: 'Keine ASNs gefunden.',
			col: {
				asn: 'ASN',
				name: 'Name',
				netClass: 'Klasse',
				source: 'Quelle',
				seen: 'Sichtungen',
				samples: 'Messwerte',
				trips: 'Fahrten',
				review: 'Review',
				newClass: 'Neue Klasse',
			},
			saving: 'Speichere…',
			save: 'Speichern',
			saved: (n: number) => `Gespeichert, ${n} Messwerte aktualisiert.`,
			saveError: 'Speichern fehlgeschlagen',
		},
		legal: {
			heading: 'Anbieterangaben',
			intro: 'Erscheinen auf /impressum und als Verantwortlicher in /datenschutz. Leere Felder werden nicht angezeigt.',
			loadError: 'Angaben konnten nicht geladen werden',
			fields: {
				name: 'Name (natürliche Person oder Firma)',
				street: 'Straße und Hausnummer',
				postalCity: 'PLZ und Ort',
				country: 'Land',
				email: 'E-Mail',
				phone: 'Telefon (optional)',
				contentResponsible: 'Verantwortlich nach § 18 Abs. 2 MStV (leer = Name)',
				hoster: 'Hosting-Anbieter (Name, Anschrift)',
				mailProvider: 'Mailversand über (leer = eigener Mailserver)',
			},
			saving: 'Speichere…',
			save: 'Speichern',
			saveSuccess: 'Gespeichert.',
			saveError: 'Speichern fehlgeschlagen',
		},
		smtp: {
			heading: 'E-Mail-Versand (SMTP)',
			loadError: 'SMTP-Einstellungen konnten nicht geladen werden',
			sourceLabel: 'Quelle',
			sourceEnv: (host: string, port: number) => `Standard aus Serverkonfiguration (aktuell: ${host}:${port})`,
			sourceCustom: 'Eigener SMTP-Server',
			customWarning:
				'Achtung: Bei eigenem SMTP-Server landen Anmelde-Links (Magic Links) nicht mehr in Mailpit, sondern werden über den konfigurierten Server versendet.',
			host: 'Host',
			port: 'Port',
			security: 'Verschlüsselung',
			securityNone: 'Keine',
			securityStarttls: 'STARTTLS',
			securityTls: 'SSL/TLS',
			user: 'Benutzer',
			password: 'Passwort',
			passwordPlaceholder: 'gespeichert – leer lassen zum Beibehalten',
			removePassword: 'Passwort entfernen',
			from: 'Absender',
			rejectUnauthorized: 'Zertifikat prüfen',
			saving: 'Speichere…',
			save: 'Speichern',
			saveSuccess: 'Gespeichert.',
			saveError: 'Speichern fehlgeschlagen',
			testHeading: 'Testmail senden',
			testTo: 'Empfänger',
			testSending: 'Sende…',
			testSend: 'Testmail senden',
			testSuccess: (id: string) => `Testmail gesendet (Message-ID ${id}).`,
			testError: 'Testmail konnte nicht gesendet werden',
		},
	};
	const en: typeof de = {
		title: 'Admin',
		adminOnly: 'This area is for admins only.',
		loading: 'Loading…',
		tabs: { asns: 'ASN review', smtp: 'Email delivery (SMTP)', legal: 'Legal notice/privacy' },
		asns: {
			filterLabel: 'Filter',
			filterUnknown: 'unknown only',
			filterAll: 'all',
			loadError: 'Could not load ASNs',
			empty: 'No ASNs found.',
			col: {
				asn: 'ASN',
				name: 'Name',
				netClass: 'Class',
				source: 'Source',
				seen: 'Sightings',
				samples: 'Samples',
				trips: 'Rides',
				review: 'Review',
				newClass: 'New class',
			},
			saving: 'Saving…',
			save: 'Save',
			saved: (n: number) => `Saved, ${n} samples updated.`,
			saveError: 'Save failed',
		},
		legal: {
			heading: 'Provider details',
			intro: 'Shown on /impressum and as controller in /datenschutz. Empty fields are not displayed.',
			loadError: 'Could not load details',
			fields: {
				name: 'Name (person or company)',
				street: 'Street and number',
				postalCity: 'Postcode and city',
				country: 'Country',
				email: 'Email',
				phone: 'Phone (optional)',
				contentResponsible: 'Responsible under § 18(2) MStV (empty = name)',
				hoster: 'Hosting provider (name, address)',
				mailProvider: 'Email sent via (empty = own mail server)',
			},
			saving: 'Saving…',
			save: 'Save',
			saveSuccess: 'Saved.',
			saveError: 'Save failed',
		},
		smtp: {
			heading: 'Email delivery (SMTP)',
			loadError: 'Could not load SMTP settings',
			sourceLabel: 'Source',
			sourceEnv: (host: string, port: number) => `Default from server configuration (currently: ${host}:${port})`,
			sourceCustom: 'Custom SMTP server',
			customWarning:
				'Note: with a custom SMTP server, sign-in links (magic links) no longer land in Mailpit but are sent via the configured server.',
			host: 'Host',
			port: 'Port',
			security: 'Encryption',
			securityNone: 'None',
			securityStarttls: 'STARTTLS',
			securityTls: 'SSL/TLS',
			user: 'User',
			password: 'Password',
			passwordPlaceholder: 'saved – leave blank to keep',
			removePassword: 'Remove password',
			from: 'Sender',
			rejectUnauthorized: 'Verify certificate',
			saving: 'Saving…',
			save: 'Save',
			saveSuccess: 'Saved.',
			saveError: 'Save failed',
			testHeading: 'Send test email',
			testTo: 'Recipient',
			testSending: 'Sending…',
			testSend: 'Send test email',
			testSuccess: (id: string) => `Test email sent (message ID ${id}).`,
			testError: 'Could not send test email',
		},
	};
	const m = $derived(i18n.locale === 'de' ? de : en);
</script>

<svelte:head>
	<title>{m.title}</title>
</svelte:head>

<h1>{m.title}</h1>

{#if auth.loading}
	<p>{m.loading}</p>
{:else if auth.me?.role !== 'admin'}
	<div class="notice warn">{m.adminOnly}</div>
{:else}
	<div class="app-nav" style="padding: 0; border: none; background: transparent; margin-bottom: 1rem">
		<button class="btn {tab === 'asns' ? '' : 'secondary'}" onclick={() => (tab = 'asns')}>{m.tabs.asns}</button>
		<button class="btn {tab === 'smtp' ? '' : 'secondary'}" onclick={() => (tab = 'smtp')}>{m.tabs.smtp}</button>
		<button class="btn {tab === 'legal' ? '' : 'secondary'}" onclick={() => (tab = 'legal')}>{m.tabs.legal}</button>
	</div>

	{#if tab === 'asns'}
		<div class="card">
			<div class="field" style="max-width: 240px">
				<label for="filter">{m.asns.filterLabel}</label>
				<select id="filter" bind:value={filter} onchange={load}>
					<option value="unknown">{m.asns.filterUnknown}</option>
					<option value="all">{m.asns.filterAll}</option>
				</select>
			</div>
		</div>

		{#if loadError}
			<div class="notice error">{loadError}</div>
		{:else if rows === null}
			<p>{m.loading}</p>
		{:else if rows.length === 0}
			<p>{m.asns.empty}</p>
		{:else}
			<div class="card" style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>{m.asns.col.asn}</th>
							<th>{m.asns.col.name}</th>
							<th>{m.asns.col.netClass}</th>
							<th>{m.asns.col.source}</th>
							<th>{m.asns.col.seen}</th>
							<th>{m.asns.col.samples}</th>
							<th>{m.asns.col.trips}</th>
							<th>{m.asns.col.review}</th>
							<th>{m.asns.col.newClass}</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.asn)}
							<tr>
								<td>AS{row.asn}</td>
								<td>{row.name}</td>
								<td>{netClassLabel(row.netClass)}</td>
								<td>{row.source}</td>
								<td>{row.seen}</td>
								<td>{row.samples}</td>
								<td>{row.trips}</td>
								<td>{row.reviewedAt ? fmtDateTime(row.reviewedAt) : '–'}</td>
								<td>
									<select
										value={pendingClass[row.asn] ?? row.netClass}
										onchange={(e) => (pendingClass = { ...pendingClass, [row.asn]: (e.target as HTMLSelectElement).value as NetClass })}
									>
										{#each NET_CLASSES as c (c)}
											<option value={c}>{netClassLabel(c)}</option>
										{/each}
									</select>
								</td>
								<td>
									<button class="btn" disabled={saving[row.asn]} onclick={() => save(row.asn)}>
										{saving[row.asn] ? m.asns.saving : m.asns.save}
									</button>
									{#if feedback[row.asn]}<div style="font-size: 0.8rem; margin-top: 0.3rem">{feedback[row.asn]}</div>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else if tab === 'legal'}
		<h2>{m.legal.heading}</h2>
		<p>{m.legal.intro}</p>

		{#if legalLoadError}
			<div class="notice error">{legalLoadError}</div>
		{:else if legal === null}
			<p>{m.loading}</p>
		{:else}
			<div class="card">
				<div class="card-grid">
					{#each LEGAL_FIELDS as f (f)}
						<div class="field">
							<label for="legal-{f}">{m.legal.fields[f]}</label>
							<input id="legal-{f}" type={f === 'email' ? 'email' : 'text'} bind:value={legal[f]} maxlength={400} />
						</div>
					{/each}
				</div>
				<button class="btn" disabled={legalSaving} onclick={saveLegal}>{legalSaving ? m.legal.saving : m.legal.save}</button>
				{#if legalSaveMessage}<div class="notice success">{legalSaveMessage}</div>{/if}
				{#if legalSaveError}<div class="notice error">{legalSaveError}</div>{/if}
			</div>
		{/if}
	{:else}
		<h2>{m.smtp.heading}</h2>

		{#if smtpLoadError}
			<div class="notice error">{smtpLoadError}</div>
		{:else if smtp === null}
			<p>{m.loading}</p>
		{:else}
			<div class="card">
				<div class="field">
					<label for="smtp-mode">{m.smtp.sourceLabel}</label>
					<select id="smtp-mode" bind:value={smtpMode}>
						<option value="env">{m.smtp.sourceEnv(smtp.envDefaults.host, smtp.envDefaults.port)}</option>
						<option value="custom">{m.smtp.sourceCustom}</option>
					</select>
				</div>

				{#if smtpMode === 'custom'}
					<div class="notice warn">
						{m.smtp.customWarning}
					</div>

					<div class="card-grid">
						<div class="field">
							<label for="smtp-host">{m.smtp.host}</label>
							<input id="smtp-host" type="text" bind:value={smtpHost} maxlength={253} placeholder="smtp.example.com" />
						</div>
						<div class="field">
							<label for="smtp-port">{m.smtp.port}</label>
							<input id="smtp-port" type="number" min="1" max="65535" bind:value={smtpPort} />
						</div>
						<div class="field">
							<label for="smtp-security">{m.smtp.security}</label>
							<select
								id="smtp-security"
								value={smtpSecurity}
								onchange={(e) => onSecurityChange((e.target as HTMLSelectElement).value as SmtpSecurity)}
							>
								<option value="none">{m.smtp.securityNone}</option>
								<option value="starttls">{m.smtp.securityStarttls}</option>
								<option value="tls">{m.smtp.securityTls}</option>
							</select>
						</div>
						<div class="field">
							<label for="smtp-user">{m.smtp.user}</label>
							<input id="smtp-user" type="text" bind:value={smtpUser} autocomplete="off" />
						</div>
						<div class="field">
							<label for="smtp-password">{m.smtp.password}</label>
							<input
								id="smtp-password"
								type="password"
								bind:value={smtpPassword}
								disabled={smtpRemovePassword}
								autocomplete="new-password"
								placeholder={smtp.passwordSet ? m.smtp.passwordPlaceholder : ''}
							/>
							{#if smtp.passwordSet}
								<label style="flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--fg-dim)">
									<input type="checkbox" bind:checked={smtpRemovePassword} style="min-height: auto; width: auto" />
									{m.smtp.removePassword}
								</label>
							{/if}
						</div>
						<div class="field">
							<label for="smtp-from">{m.smtp.from}</label>
							<input id="smtp-from" type="text" bind:value={smtpFrom} placeholder="Name &lt;mail@domain&gt;" />
						</div>
					</div>

					<label style="display: flex; flex-direction: row; align-items: center; gap: 0.4rem; margin-bottom: 0.9rem">
						<input type="checkbox" bind:checked={smtpRejectUnauthorized} style="min-height: auto; width: auto" />
						{m.smtp.rejectUnauthorized}
					</label>
				{/if}

				<button class="btn" disabled={smtpSaving} onclick={saveSmtp}>{smtpSaving ? m.smtp.saving : m.smtp.save}</button>

				{#if smtpSaveMessage}<div class="notice success">{smtpSaveMessage}</div>{/if}
				{#if smtpSaveError}<div class="notice error">{smtpSaveError}</div>{/if}
			</div>

			<div class="card">
				<h3>{m.smtp.testHeading}</h3>
				<div class="field" style="max-width: 320px">
					<label for="smtp-test-to">{m.smtp.testTo}</label>
					<input id="smtp-test-to" type="email" bind:value={testTo} placeholder={auth.me?.email ?? ''} />
				</div>
				<button class="btn secondary" disabled={testSending} onclick={sendTestMail}>
					{testSending ? m.smtp.testSending : m.smtp.testSend}
				</button>
				{#if testMessage}<div class="notice success">{testMessage}</div>{/if}
				{#if testError}<div class="notice error">{testError}</div>{/if}
			</div>
		{/if}
	{/if}
{/if}
