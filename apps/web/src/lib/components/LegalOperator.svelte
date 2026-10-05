<script lang="ts">
	// Anschriftblock des Anbieters für Impressum und Datenschutzerklärung (Daten aus /api/public/legal).
	import type { LegalInfo } from '@bahn/shared';
	import { i18n } from '#lib/i18n.svelte.js';

	let { info }: { info: LegalInfo } = $props();

	const de = { email: 'E-Mail', phone: 'Telefon', missing: 'Die Anbieterangaben sind noch nicht hinterlegt.' };
	const en: typeof de = { email: 'Email', phone: 'Phone', missing: 'The provider details have not been entered yet.' };
	const m = $derived(i18n.locale === 'de' ? de : en);
</script>

{#if info.name}
	<address class="legal-operator">
		{info.name}<br />
		{#if info.street}{info.street}<br />{/if}
		{#if info.postalCity}{info.postalCity}<br />{/if}
		{#if info.country}{info.country}<br />{/if}
		{#if info.email}{m.email}: <a href="mailto:{info.email}">{info.email}</a><br />{/if}
		{#if info.phone}{m.phone}: {info.phone}{/if}
	</address>
{:else}
	<div class="notice warn">{m.missing}</div>
{/if}

<style>
	.legal-operator {
		font-style: normal;
		line-height: 1.6;
	}
</style>
