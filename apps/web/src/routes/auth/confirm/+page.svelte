<script lang="ts">
	// Bestätigungsseite mit Button (kein Auto-Login), damit Mail-Scanner/Link-Vorschauen den Token
	// nicht verbrauchen, siehe PLANUNG.md 9.1.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';

	const token = page.url.searchParams.get('token') ?? '';
	let confirming = $state(false);
	let error = $state<string | null>(null);

	async function confirm(): Promise<void> {
		if (!token) {
			error = 'Kein Token in der URL gefunden.';
			return;
		}
		confirming = true;
		error = null;
		try {
			await api.confirm({ token });
			await auth.load();
			await goto('/track');
		} catch (err) {
			error = err instanceof ApiError ? (err.detail ?? err.title) : 'Unbekannter Fehler';
		} finally {
			confirming = false;
		}
	}
</script>

<svelte:head>
	<title>Anmeldung bestätigen</title>
</svelte:head>

<h1>Anmeldung bestätigen</h1>

{#if !token}
	<div class="notice error">Der Link ist unvollständig: es fehlt der Anmelde-Token.</div>
{:else}
	<p>Zum Abschluss der Anmeldung bitte bestätigen.</p>
	{#if error}
		<div class="notice error">{error}</div>
	{/if}
	<button class="btn" onclick={confirm} disabled={confirming}>
		{confirming ? 'Bestätige…' : 'Anmeldung bestätigen'}
	</button>
{/if}
