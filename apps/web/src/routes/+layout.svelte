<script lang="ts">
	// Registriert das ALTCHA-Web-Component global, bevor irgendeine Seite es benutzt.
	import 'altcha';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page, updated } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { auth } from '#lib/auth.svelte.js';
	import { theme } from '#lib/theme.svelte.js';
	import { i18n } from '#lib/i18n.svelte.js';

	let { children } = $props();

	$effect(() => {
		void auth.load();
	});

	$effect(() => theme.apply());
	$effect(() => i18n.apply());

	// Neue Version deployt (SvelteKit prüft _app/version.json bei Fokus und stündlich): beim nächsten
	// Seitenwechsel voll neu laden, damit kein alter Code weiterläuft. Während einer Fahrt nicht
	// erzwingen (Reload beendet GPS/WebSocket), dann nur der Hinweis mit Neu-laden-Knopf.
	function tripRunning(): boolean {
		try {
			// Schlüssel wie STORAGE_KEY in #lib/tracker/tracker.svelte.ts (Import würde den Tracker starten).
			return localStorage.getItem('bahn-tracker:activeTrip') !== null;
		} catch {
			return false;
		}
	}

	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url && !tripRunning()) {
			location.href = to.url.href;
		}
	});

	const de = {
		start: 'Start',
		track: 'Fahrt',
		map: 'Karte',
		stats: 'Statistik',
		account: 'Konto',
		admin: 'Admin',
		login: 'Anmelden',
		theme: { system: 'Farbmodus: System', light: 'Farbmodus: Hell', dark: 'Farbmodus: Dunkel' },
		switchLang: 'Switch to English',
		updateAvailable: 'Neue Version verfügbar.',
		reload: 'Neu laden',
		imprint: 'Impressum',
		privacy: 'Datenschutz',
	};
	const en: typeof de = {
		start: 'Home',
		track: 'Ride',
		map: 'Map',
		stats: 'Statistics',
		account: 'Account',
		admin: 'Admin',
		login: 'Sign in',
		theme: { system: 'Colour mode: system', light: 'Colour mode: light', dark: 'Colour mode: dark' },
		switchLang: 'Auf Deutsch umschalten',
		updateAvailable: 'A new version is available.',
		reload: 'Reload',
		imprint: 'Legal notice',
		privacy: 'Privacy',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	const links = $derived([
		{ href: '/', label: m.start },
		{ href: '/track', label: m.track },
		{ href: '/map', label: m.map },
		{ href: '/stats', label: m.stats },
		{ href: '/account', label: m.account },
		...(auth.me?.role === 'admin' ? [{ href: '/admin', label: m.admin }] : []),
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
				<a href="/" class="app-nav__status" style="color: var(--accent)">{m.login}</a>
			{/if}
			<button class="icon-btn lang-btn" onclick={() => i18n.toggle()} title={m.switchLang} aria-label={m.switchLang}>
				{i18n.locale === 'de' ? 'EN' : 'DE'}
			</button>
			<button class="icon-btn" onclick={() => theme.cycle()} title={m.theme[theme.pref]} aria-label={m.theme[theme.pref]}>
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
		{#if updated.current}
			<div class="notice update-notice">
				<span>{m.updateAvailable}</span>
				<button class="btn secondary" onclick={() => location.reload()}>{m.reload}</button>
			</div>
		{/if}
		{@render children()}
	</main>
	<footer class="app-footer">
		<a href="/impressum">{m.imprint}</a>
		<a href="/datenschutz">{m.privacy}</a>
	</footer>
</div>

<style>
	.app-footer {
		display: flex;
		justify-content: center;
		gap: 1.25rem;
		padding: 0.75rem max(0.85rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom))
			max(0.85rem, env(safe-area-inset-left));
		border-top: 1px solid var(--border);
		font-size: 0.85rem;
	}

	.app-footer a {
		color: var(--fg-dim);
	}

	.update-notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border-color: var(--info);
	}

	.update-notice .btn {
		padding: 0.4rem 0.8rem;
		font-size: 0.9rem;
	}
</style>
