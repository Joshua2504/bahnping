<script lang="ts">
	// Registriert das ALTCHA-Web-Component global, bevor irgendeine Seite es benutzt.
	import 'altcha';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { auth } from '#lib/auth.svelte.js';

	let { children } = $props();

	$effect(() => {
		void auth.load();
	});

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
		<span class="app-nav__brand">BahnPing</span>
		{#each links as link (link.href)}
			<a href={link.href} class:active={page.url.pathname === link.href}>{link.label}</a>
		{/each}
		{#if auth.loading}
			<span class="app-nav__status">…</span>
		{:else if auth.me}
			<span class="app-nav__status">{auth.me.displayName ?? auth.me.email}</span>
		{:else}
			<a href="/">Anmelden</a>
		{/if}
	</nav>
	<main class="app-main">
		{@render children()}
	</main>
</div>
