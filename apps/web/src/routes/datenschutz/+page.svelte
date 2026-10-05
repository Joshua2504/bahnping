<script lang="ts">
	// Datenschutzerklärung (Art. 13 DSGVO). Inhalt muss zu PLANUNG.md Kap. 10 und zum tatsächlichen
	// Verhalten von API und Web passen; bei Änderungen an Datenflüssen hier mitpflegen.
	import { SESSION_TTL_MS, MAGIC_LINK_TTL_MS, type LegalInfo } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { i18n } from '#lib/i18n.svelte.js';
	import LegalOperator from '#lib/components/LegalOperator.svelte';

	let info = $state<LegalInfo | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		api
			.publicLegal()
			.then((v) => (info = v))
			.catch((err) => (error = err instanceof ApiError ? (err.detail ?? err.title) : String(err)));
	});

	const sessionDays = Math.round(SESSION_TTL_MS / 86_400_000);
	const magicMinutes = Math.round(MAGIC_LINK_TTL_MS / 60_000);

	type Section = { h: string; p: string[]; list?: string[] };

	const de = {
		title: 'Datenschutzerklärung',
		controller: '1. Verantwortlicher',
		loading: 'Lade…',
		sections: (hoster: string, mail: string): Section[] => [
			{
				h: '2. Grundsätze',
				p: [
					'BahnPing misst die Netzqualität in Zügen und veröffentlicht die Ergebnisse. Wir verarbeiten nur, was dafür nötig ist. IP-Adressen werden nie gespeichert, protokolliert oder gehasht. Es gibt keine Werbung, kein Tracking, keine Analysedienste und keine Inhalte von Drittanbietern: Karte, Schriften, Captcha und Mailversand laufen auf eigenen Servern, dein Browser lädt nichts von fremden Servern nach.',
				],
			},
			{
				h: '3. Aufruf der Website',
				p: [
					'Beim Aufruf überträgt dein Browser technisch bedingt deine IP-Adresse, Datum und Uhrzeit, die angefragte Adresse sowie Browser-Angaben (User-Agent). Diese Daten werden nur flüchtig im Arbeitsspeicher verarbeitet, um die Anfrage zu beantworten, und nicht in Logdateien gespeichert. Aus dem User-Agent leiten wir bei der Anmeldung nur eine grobe Gerätebezeichnung ab (z. B. „Android Chrome“), die in der Sitzungsliste deines Kontos angezeigt wird.',
					'Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist der sichere und funktionsfähige Betrieb der Website.',
				],
			},
			{
				h: '4. Netzbetreiber-Erkennung',
				p: [
					'Um Messungen dem richtigen Netz zuzuordnen (DB-WLAN, Telekom, Vodafone, O2 …), schlägt der Server deine IP-Adresse im Arbeitsspeicher in einer lokalen Tabelle nach und ermittelt daraus die Nummer des autonomen Systems (ASN) und den Netzbetreiber. Gespeichert werden nur ASN, Netzklasse und IP-Version, nie die Adresse selbst. Die ASN-Tabelle (iptoasn.com) lädt der Server als Ganzes herunter; dabei werden keine Daten über dich übermittelt.',
					'Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Durchführung der von dir gestarteten Messung) bzw. lit. f DSGVO für Aufrufe ohne Konto.',
				],
			},
			{
				h: '5. Konto und Anmeldung',
				p: [
					`Für die Anmeldung speichern wir deine E-Mail-Adresse und schicken dir einen Anmeldelink, der ${magicMinutes} Minuten gültig ist. Optional kannst du einen öffentlichen Namen festlegen; er erscheint nur, wenn du der Rangliste zustimmst, und dort nur mit der Anzahl deiner Fahrten und Messungen, nie mit Orten oder Zeiten.`,
					'Vor dem Absenden von Formularen löst dein Browser eine kleine Rechenaufgabe (ALTCHA, selbst gehostet) als Schutz vor Missbrauch. Dabei werden keine Daten an Dritte übertragen und keine Cookies gesetzt.',
					`Nach der Anmeldung setzen wir ein technisch notwendiges Sitzungs-Cookie. Auf dem Server liegt nur ein Hashwert davon, zusammen mit Zeitpunkt der Anmeldung, letzter Nutzung und der groben Gerätebezeichnung. Sitzungen laufen nach ${sessionDays} Tagen ohne Nutzung ab und werden dann gelöscht. Für die Companion-CLI kannst du API-Tokens erzeugen; auch davon speichern wir nur einen Hashwert.`,
					'Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Nutzungsverhältnis), für den Missbrauchsschutz lit. f DSGVO.',
				],
			},
			{
				h: '6. Messfahrten',
				p: [
					'Wenn du eine Fahrt startest, erfasst die App bis zum Ende der Fahrt: Standort (über die Standortfreigabe deines Browsers, inkl. Genauigkeit, Geschwindigkeit und Richtung), Latenz und Paketverlust, auf Wunsch Geschwindigkeitstests (dabei werden Testdaten übertragen), Verbindungstyp laut Browser, Netzbetreiber wie in Abschnitt 4 sowie Zuggattung, Zugnummer und ob du WLAN oder Mobilfunk nutzt. Die Companion-CLI liest zusätzlich Daten aus dem ICE-Portal (Zugposition, Triebzug, Baureihe, Halte, Verspätungen, Verbindungsstatus). Ohne gestartete Fahrt wird kein Standort erfasst.',
					'Die Standortfreigabe erteilst du im Browser und kannst sie dort jederzeit widerrufen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, denn die Messung ist der Kern des Dienstes, den du aktiv nutzt.',
				],
			},
			{
				h: '7. Veröffentlichung der Messdaten',
				p: [
					'Zweck des Projekts ist die Veröffentlichung. Solange die Datenbasis klein ist, sind alle Messungen sofort öffentlich: als Karte und als einzelne Fahrten mit Strecke, Zeitpunkten, Zug und Messwerten, aber ohne Namen, E-Mail-Adresse oder Konto-Kennung. Die Positionen liegen auf Bahnstrecken. Laufende Fahrten erscheinen ohne Personenbezug auf der Live-Karte; das kannst du unter „Konto“ abschalten. Später werden nur noch zusammengefasste Werte veröffentlicht.',
					'Bitte beachte: Wer weiß, dass du zu einer bestimmten Zeit in einem bestimmten Zug warst, kann eine öffentliche Fahrt möglicherweise dir zuordnen. Wenn du das nicht möchtest, starte für diese Fahrt keine Messung oder lösche sie anschließend unter „Konto“.',
				],
			},
			{
				h: '8. Speicherung im Browser',
				p: [
					'Neben dem Sitzungs-Cookie speichert die App im Browser (localStorage, IndexedDB, Service-Worker-Cache): Sprache, Farbmodus und Kartenansicht, die laufende Fahrt, noch nicht übertragene Messwerte (Offline-Warteschlange) sowie die App-Dateien für den Offline-Betrieb. Diese Daten verlassen dein Gerät nur als Messwerte deiner Fahrt. Die Speicherung ist für die von dir gewünschten Funktionen unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).',
				],
			},
			{
				h: '9. Empfänger',
				p: [
					hoster
						? `Die Server betreibt ${hoster} in unserem Auftrag (Auftragsverarbeitung nach Art. 28 DSGVO).`
						: 'Die Server werden von einem Hosting-Anbieter in unserem Auftrag betrieben (Auftragsverarbeitung nach Art. 28 DSGVO).',
					mail
						? `Anmelde-Mails werden über ${mail} versendet.`
						: 'Anmelde-Mails werden über unseren eigenen Mailserver versendet.',
					'Eine Übermittlung in Drittländer außerhalb der EU/des EWR findet nicht statt. Daten werden nicht verkauft und nicht für Werbung genutzt.',
				],
			},
			{
				h: '10. Speicherdauer',
				p: [],
				list: [
					`Anmeldelinks: ${magicMinutes} Minuten, danach gelöscht.`,
					`Sitzungen: bis zur Abmeldung oder ${sessionDays} Tage nach letzter Nutzung.`,
					'Konto, Fahrten und Messwerte: bis du sie oder dein Konto löschst. Die Löschung des Kontos entfernt sofort alle zugehörigen Fahrten und Messwerte.',
					'Versendete Mails werden von uns nicht archiviert.',
				],
			},
			{
				h: '11. Deine Rechte',
				p: [
					'Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO). Vieles davon kannst du selbst unter „Konto“ erledigen: Daten exportieren (JSON), einzelne Fahrten oder das Konto samt aller Fahrten löschen und die Live-Karte abschalten. Für alles Weitere genügt eine E-Mail an die oben genannte Adresse.',
					'Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren, insbesondere in dem Bundesland bzw. Mitgliedstaat deines Wohnorts.',
				],
			},
			{
				h: '12. Pflicht zur Bereitstellung',
				p: [
					'Die Karte und die öffentlichen Fahrten kannst du ohne Konto ansehen. Für eigene Messungen sind E-Mail-Adresse und Standortfreigabe erforderlich; ohne sie ist keine Messung möglich. Eine automatisierte Entscheidungsfindung im Sinne von Art. 22 DSGVO findet nicht statt.',
				],
			},
		],
	};
	const en: typeof de = {
		title: 'Privacy policy',
		controller: '1. Controller',
		loading: 'Loading…',
		sections: (hoster: string, mail: string): Section[] => [
			{
				h: '2. Principles',
				p: [
					'BahnPing measures network quality on trains and publishes the results. We only process what is needed for that. IP addresses are never stored, logged or hashed. There is no advertising, no tracking, no analytics and no third-party content: map, fonts, captcha and email run on our own servers, and your browser does not load anything from third-party servers.',
				],
			},
			{
				h: '3. Visiting the website',
				p: [
					'When you visit the site, your browser necessarily transmits your IP address, date and time, the requested address and browser details (user agent). These are only processed transiently in memory to answer the request and are not written to log files. When you sign in, we derive only a rough device label from the user agent (e.g. "Android Chrome"), shown in your account’s session list.',
					'Legal basis is Art. 6(1)(f) GDPR; our legitimate interest is the secure and reliable operation of the website.',
				],
			},
			{
				h: '4. Network operator detection',
				p: [
					'To attribute measurements to the right network (DB Wi-Fi, Telekom, Vodafone, O2 …), the server looks up your IP address in memory in a local table to determine the autonomous system number (ASN) and the operator. Only the ASN, network class and IP version are stored, never the address itself. The server downloads the ASN table (iptoasn.com) as a whole; no data about you is transmitted.',
					'Legal basis is Art. 6(1)(b) GDPR (performing the measurement you started) or Art. 6(1)(f) GDPR for requests without an account.',
				],
			},
			{
				h: '5. Account and sign-in',
				p: [
					`To sign you in we store your email address and send you a sign-in link valid for ${magicMinutes} minutes. You may optionally set a public name; it only appears if you opt in to the leaderboard, and there only with the number of your rides and measurements, never with places or times.`,
					'Before forms are submitted, your browser solves a small computational puzzle (ALTCHA, self-hosted) to prevent abuse. No data is sent to third parties and no cookies are set for this.',
					`After signing in we set a strictly necessary session cookie. The server only stores a hash of it, together with the time of sign-in, last use and the rough device label. Sessions expire after ${sessionDays} days without use and are then deleted. You can create API tokens for the companion CLI; for these too we only store a hash.`,
					'Legal basis is Art. 6(1)(b) GDPR (user relationship), and Art. 6(1)(f) GDPR for abuse prevention.',
				],
			},
			{
				h: '6. Measurement rides',
				p: [
					'When you start a ride, the app records until the ride ends: location (via your browser’s location permission, including accuracy, speed and heading), latency and packet loss, optionally speed tests (which transfer test data), connection type as reported by the browser, network operator as described in section 4, as well as train type, train number and whether you use Wi-Fi or mobile data. The companion CLI additionally reads data from the ICE portal (train position, trainset, series, stops, delays, connectivity status). No location is recorded without an active ride.',
					'You grant location access in your browser and can revoke it there at any time. Legal basis is Art. 6(1)(b) GDPR, as the measurement is the core of the service you are actively using.',
				],
			},
			{
				h: '7. Publication of measurements',
				p: [
					'The purpose of the project is publication. While the dataset is small, all measurements are public right away: as a map and as individual rides with route, times, train and measurements, but without name, email address or account ID. Positions lie on railway lines. Ongoing rides appear on the live map without personal reference; you can turn this off under "Account". Later, only aggregated values will be published.',
					'Please note: someone who knows that you were on a particular train at a particular time may be able to link a public ride to you. If you do not want that, do not start a measurement for that ride, or delete it afterwards under "Account".',
				],
			},
			{
				h: '8. Storage in the browser',
				p: [
					'Besides the session cookie, the app stores in your browser (localStorage, IndexedDB, service worker cache): language, colour mode and map view, the ongoing ride, measurements not yet uploaded (offline queue) and the app files for offline use. This data only leaves your device as measurements of your ride. Storage is strictly necessary for the features you request (§ 25(2) no. 2 TDDDG).',
				],
			},
			{
				h: '9. Recipients',
				p: [
					hoster
						? `The servers are operated on our behalf by ${hoster} (data processing under Art. 28 GDPR).`
						: 'The servers are operated on our behalf by a hosting provider (data processing under Art. 28 GDPR).',
					mail ? `Sign-in emails are sent via ${mail}.` : 'Sign-in emails are sent via our own mail server.',
					'No data is transferred to countries outside the EU/EEA. Data is not sold and not used for advertising.',
				],
			},
			{
				h: '10. Retention',
				p: [],
				list: [
					`Sign-in links: ${magicMinutes} minutes, then deleted.`,
					`Sessions: until you sign out or ${sessionDays} days after last use.`,
					'Account, rides and measurements: until you delete them or your account. Deleting the account immediately removes all associated rides and measurements.',
					'We do not archive emails sent.',
				],
			},
			{
				h: '11. Your rights',
				p: [
					'You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20) and to object to processing based on legitimate interests (Art. 21 GDPR). Much of this you can do yourself under "Account": export your data (JSON), delete individual rides or your account including all rides, and turn off the live map. For anything else, an email to the address above is enough.',
					'You may also lodge a complaint with a data protection supervisory authority, in particular in the state or member state of your residence.',
				],
			},
			{
				h: '12. Obligation to provide data',
				p: [
					'You can view the map and public rides without an account. Your own measurements require an email address and location access; without them no measurement is possible. There is no automated decision-making within the meaning of Art. 22 GDPR.',
				],
			},
		],
	};
	const m = $derived(i18n.locale === 'de' ? de : en);
	const sections = $derived(m.sections(info?.hoster ?? '', info?.mailProvider ?? ''));
</script>

<svelte:head>
	<title>{m.title} – BahnPing</title>
</svelte:head>

<article class="legal">
	<h1>{m.title}</h1>

	<h2>{m.controller}</h2>
	{#if error}
		<div class="notice error">{error}</div>
	{:else if !info}
		<p>{m.loading}</p>
	{:else}
		<LegalOperator {info} />
	{/if}

	{#each sections as s (s.h)}
		<h2>{s.h}</h2>
		{#each s.p as para, i (i)}
			<p>{para}</p>
		{/each}
		{#if s.list}
			<ul>
				{#each s.list as item, i (i)}
					<li>{item}</li>
				{/each}
			</ul>
		{/if}
	{/each}
</article>
