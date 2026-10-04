<script lang="ts">
	// Registriert das ALTCHA-Web-Component global, bevor irgendeine Seite es benutzt.
	import 'altcha';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { auth } from '#lib/auth.svelte.js';
	import { theme } from '#lib/theme.svelte.js';

	let { children } = $props();

	$effect(() => {
		void auth.load();
	});

	$effect(() => theme.apply());

	const THEME_LABELS = { system: 'Farbmodus: System', light: 'Farbmodus: Hell', dark: 'Farbmodus: Dunkel' } as const;

	const links = $derived([
		{ href: '/', label: 'Start' },
		{ href: '/track', label: 'Fahrt' },
		{ href: '/map', label: 'Karte' },
		{ href: '/stats', label: 'Statistik' },
		{ href: '/account', label: 'Konto' },
		...(auth.me?.role === 'admin' ? [{ href: '/admin', label: 'Admin' }] : []),
	]);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-shell">
	<nav class="app-nav">
		<a href="/" class="app-nav__brand"><span class="app-nav__logo" aria-hidden="true">B</span>BahnPing</a>
		<div class="app-nav__links">
			{#each links as link (link.href)}
				<a href={link.href} class:active={page.url.pathname === link.href}>{link.label}</a>
			{/each}
		</div>
		<div class="app-nav__end">
			{#if auth.loading}
				<span class="app-nav__status">…</span>
			{:else if auth.me}
				<span class="app-nav__status">{auth.me.displayName ?? auth.me.email}</span>
			{:else}
				<a href="/" class="app-nav__status" style="color: var(--accent)">Anmelden</a>
			{/if}
			<button
				class="icon-btn"
				onclick={() => theme.cycle()}
				title={THEME_LABELS[theme.pref]}
				aria-label={THEME_LABELS[theme.pref]}
			>
				{#if theme.pref === 'system'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
				{:else if theme.pref === 'light'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
				{:else}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
				{/if}
			</button>
		</div>
	</nav>
	<main class="app-main">
		{@render children()}
	</main>
</div>
