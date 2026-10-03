// Grobe, serverseitig als Freitext gespeicherte Plattformangabe (TripCreate.platform, max. 40 Zeichen).

/** Erkennt grob OS/Browser und ob die App als installierte PWA läuft. */
export function detectPlatform(): string {
	const ua = navigator.userAgent;
	const nav = navigator as Navigator & { standalone?: boolean };
	const standalone =
		(typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
		nav.standalone === true;
	const suffix = standalone ? '-pwa' : '';

	if (/iPad|iPhone|iPod/.test(ua)) return `ios-safari${suffix}`;

	if (/Android/.test(ua)) {
		if (/Firefox/.test(ua)) return `android-firefox${suffix}`;
		return `android-chrome${suffix}`;
	}

	let browser = 'other';
	if (/Edg\//.test(ua)) browser = 'edge';
	else if (/Firefox\//.test(ua)) browser = 'firefox';
	else if (/Chrome\//.test(ua)) browser = 'chrome';
	else if (/Safari\//.test(ua)) browser = 'safari';

	return `desktop-${browser}${suffix}`;
}
