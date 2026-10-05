<script lang="ts">
	// Impressum nach § 5 DDG und § 18 Abs. 2 MStV. Anbieterangaben pflegen Admins unter /admin.
	import type { LegalInfo } from '@bahn/shared';
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

	const de = {
		title: 'Impressum',
		provider: 'Angaben gemäß § 5 DDG',
		responsible: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
		projectTitle: 'Über das Projekt',
		project:
			'BahnPing ist ein privates, nicht-kommerzielles Projekt, das die Netzqualität in Zügen misst und die Ergebnisse öffentlich macht. Es besteht keine Verbindung zur Deutschen Bahn AG oder zu Mobilfunkanbietern.',
		liabilityTitle: 'Haftung für Inhalte und Messwerte',
		liability:
			'Die Messwerte stammen von Nutzerinnen und Nutzern und werden automatisch ausgewertet. Für Richtigkeit, Vollständigkeit und Aktualität wird keine Gewähr übernommen. Hinweise auf fehlerhafte Daten nehmen wir gern per E-Mail entgegen.',
		disputeTitle: 'Verbraucherstreitbeilegung',
		dispute: 'Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
		privacyLink: 'Zur Datenschutzerklärung',
		loading: 'Lade…',
	};
	const en: typeof de = {
		title: 'Legal notice',
		provider: 'Information pursuant to § 5 DDG (German Digital Services Act)',
		responsible: 'Responsible for content pursuant to § 18 (2) MStV',
		projectTitle: 'About the project',
		project:
			'BahnPing is a private, non-commercial project that measures network quality on trains and publishes the results. It is not affiliated with Deutsche Bahn AG or any mobile network operator.',
		liabilityTitle: 'Liability for content and measurements',
		liability:
			'Measurements are contributed by users and evaluated automatically. No guarantee is given for their accuracy, completeness or timeliness. Please let us know by email if you spot incorrect data.',
		disputeTitle: 'Consumer dispute resolution',
		dispute: 'We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.',
		privacyLink: 'Privacy policy',
		loading: 'Loading…',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);
</script>

<svelte:head>
	<title>{m.title} – BahnPing</title>
</svelte:head>

<article class="legal">
	<h1>{m.title}</h1>

	{#if error}
		<div class="notice error">{error}</div>
	{:else if !info}
		<p>{m.loading}</p>
	{:else}
		<h2>{m.provider}</h2>
		<LegalOperator {info} />

		{#if info.contentResponsible || info.name}
			<h2>{m.responsible}</h2>
			<p>{info.contentResponsible || info.name}</p>
		{/if}
	{/if}

	<h2>{m.projectTitle}</h2>
	<p>{m.project}</p>

	<h2>{m.liabilityTitle}</h2>
	<p>{m.liability}</p>

	<h2>{m.disputeTitle}</h2>
	<p>{m.dispute}</p>

	<p><a href="/datenschutz">{m.privacyLink}</a></p>
</article>
