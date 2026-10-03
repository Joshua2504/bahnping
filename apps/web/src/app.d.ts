// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Das ALTCHA-Widget ist ein Custom Element (import 'altcha'); Svelte kennt dessen Attribute nicht.
declare module 'svelte/elements' {
	export interface SvelteHTMLElements {
		'altcha-widget': import('svelte/elements').HTMLAttributes<HTMLElement> & {
			challengeurl?: string;
			style?: string;
			hidelogo?: boolean;
			hidefooter?: boolean;
			floating?: 'auto' | 'top' | 'bottom' | boolean;
		};
	}
}

export {};
