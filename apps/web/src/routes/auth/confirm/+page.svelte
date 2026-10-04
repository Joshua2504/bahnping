<script lang="ts">
	// Bestätigungsseite mit Button (kein Auto-Login), damit Mail-Scanner/Link-Vorschauen den Token
	// nicht verbrauchen, siehe PLANUNG.md 9.1.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';
	import { i18n } from '#lib/i18n.svelte.js';

	const de = {
		title: 'Anmeldung bestätigen',
		missingToken: 'Der Link ist unvollständig: es fehlt der Anmelde-Token.',
		noTokenInUrl: 'Kein Token in der URL gefunden.',
		intro: 'Zum Abschluss der Anmeldung bitte bestätigen.',
		confirming: 'Bestätige…',
		confirm: 'Anmeldung bestätigen',
		unknownError: 'Unbekannter Fehler',
	};
	const en: typeof de = {
		title: 'Confirm sign-in',
		missingToken: 'The link is incomplete: the sign-in token is missing.',
		noTokenInUrl: 'No token found in the URL.',
		intro: 'Please confirm to complete the sign-in.',
		confirming: 'Confirming…',
		confirm: 'Confirm sign-in',
		unknownError: 'Unknown error',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	const token = page.url.searchParams.get('token') ?? '';
	let confirming = $state(false);
	let error = $state<string | null>(null);

	async function confirm(): Promise<void> {
		if (!token) {
			error = m.noTokenInUrl;
			return;
		}
		confirming = true;
		error = null;
		try {
			await api.confirm({ token });
			await auth.load();
			await goto('/track');
		} catch (err) {
			error = err instanceof ApiError ? (err.detail ?? err.title) : m.unknownError;
		} finally {
			confirming = false;
		}
	}
</script>

<svelte:head>
	<title>{m.title}</title>
</svelte:head>

<h1>{m.title}</h1>

{#if !token}
	<div class="notice error">{m.missingToken}</div>
{:else}
	<p>{m.intro}</p>
	{#if error}
		<div class="notice error">{error}</div>
	{/if}
	<button class="btn" onclick={confirm} disabled={confirming}>
		{confirming ? m.confirming : m.confirm}
	</button>
{/if}
