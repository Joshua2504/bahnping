<script lang="ts">
	// Öffentliche Statistikseite: Gesamtzahlen + Kennzahlen je Netzklasse, aus /api/public/stats,
	// dazu die letzten öffentlichen Fahrten aus /api/public/trips.
	import { onMount } from 'svelte';
	import { type PublicStats, type Trip } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { fmtDateTime, i18n, iceStateLabel, netClassLabel, trainTypeLabel } from '#lib/i18n.svelte.js';

	const de = {
		title: 'Statistik',
		loading: 'Lade…',
		loadError: 'Statistik konnte nicht geladen werden',
		totals: 'Gesamt',
		trips: 'Fahrten',
		samples: 'Messwerte',
		users: 'Nutzer',
		activeTrips: 'Fahrten aktiv',
		byNet: 'Nach Netzklasse',
		noData: 'Noch keine Daten vorhanden.',
		net: 'Netz',
		rttMedian: 'Latenz (Median)',
		rttP90: 'Latenz (p90)',
		loss: 'Verlust',
		downMedian: 'Download (Median)',
		upMedian: 'Upload (Median)',
		byIceState: 'Bordportal-Prognose vs. Messung',
		iceIntro:
			'Das ICE-Portal zeigt für jeden Streckenabschnitt eine Netzprognose der DB. Das ist keine Messung. Hier steht, wie die Verbindung bei der jeweiligen Prognose tatsächlich war (nur Fahrten mit CLI/App, die das Bordportal auslesen).',
		forecast: 'Prognose',
		avail: 'Verfügbarkeit',
		measureWindows: 'Messfenster',
		availNote: 'Verfügbarkeit: Anteil der 10-Sekunden-Messfenster mit mindestens einer Ping-Antwort.',
		recentTrips: 'Letzte Fahrten',
		recentIntro: 'Solange die Datenbasis klein ist, sind einzelne Fahrten öffentlich (ohne Namen oder Konto).',
		train: 'Zug',
		route: 'Strecke',
		start: 'Beginn',
		live: 'läuft',
		footerPre: 'Live-Übersicht und Karte unter ',
		footerPost: '. Angaben ohne Namen oder Kontodaten.',
	};
	const en: typeof de = {
		title: 'Statistics',
		loading: 'Loading…',
		loadError: 'Statistics could not be loaded',
		totals: 'Total',
		trips: 'Rides',
		samples: 'Samples',
		users: 'Users',
		activeTrips: 'Active rides',
		byNet: 'By network class',
		noData: 'No data available yet.',
		net: 'Network',
		rttMedian: 'Latency (median)',
		rttP90: 'Latency (p90)',
		loss: 'Loss',
		downMedian: 'Download (median)',
		upMedian: 'Upload (median)',
		byIceState: 'On-board portal forecast vs. measurement',
		iceIntro:
			'The ICE portal shows a DB network forecast for every stretch of track. That is not a measurement. This shows how the connection actually performed for each forecast (only rides via CLI/app that read the on-board portal).',
		forecast: 'Forecast',
		avail: 'Availability',
		measureWindows: 'Measurement windows',
		availNote: 'Availability: share of 10-second measurement windows with at least one ping reply.',
		recentTrips: 'Recent rides',
		recentIntro: 'While the dataset is still small, individual rides are public (without names or accounts).',
		train: 'Train',
		route: 'Route',
		start: 'Start',
		live: 'live',
		footerPre: 'Live overview and map at ',
		footerPost: '. Figures without names or account data.',
	};
	const m = $derived(i18n.locale === 'de' ? de : en);

	let data = $state<PublicStats | null>(null);
	let loadError = $state<string | null>(null);
	let trips = $state<Trip[]>([]);

	function fmt(value: number | null, digits = 0, suffix = ''): string {
		return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
	}

	function mbit(bps: number | null): string {
		return bps === null ? '–' : `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
	}

	function tripLabel(t: Trip): string {
		return t.trainNumber ? `${trainTypeLabel(t.trainType)} ${t.trainNumber}` : trainTypeLabel(t.trainType);
	}

	onMount(async () => {
		// Fahrtliste unabhängig laden, ein Fehler dort soll die Statistik nicht verdecken.
		api.publicTrips().then(
			(rows) => (trips = rows),
			() => {},
		);
		try {
			data = await api.publicStats();
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : m.loadError;
		}
	});
</script>

<svelte:head>
	<title>{m.title}</title>
</svelte:head>

<h1>{m.title}</h1>

{#if loadError}
	<div class="notice error">{loadError}</div>
{:else if !data}
	<p>{m.loading}</p>
{:else}
	<div class="card">
		<h2>{m.totals}</h2>
		<div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr))">
			<div class="stat">
				<div class="stat__label">{m.trips}</div>
				<div class="stat__value">{data.totals.trips}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.samples}</div>
				<div class="stat__value">{data.totals.samples}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.users}</div>
				<div class="stat__value">{data.totals.users}</div>
			</div>
			<div class="stat">
				<div class="stat__label">{m.activeTrips}</div>
				<div class="stat__value">{data.totals.activeTrips}</div>
			</div>
		</div>
	</div>

	<div class="card">
		<h2>{m.byNet}</h2>
		{#if data.byNet.length === 0}
			<p>{m.noData}</p>
		{:else}
			<div style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>{m.net}</th>
							<th>{m.rttMedian}</th>
							<th>{m.rttP90}</th>
							<th>{m.loss}</th>
							<th>{m.downMedian}</th>
							<th>{m.upMedian}</th>
							<th>{m.trips}</th>
							<th>{m.samples}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.byNet as row (row.netClass)}
							<tr>
								<td>{netClassLabel(row.netClass)}</td>
								<td>{fmt(row.rttMedian, 0, ' ms')}</td>
								<td>{fmt(row.rttP90, 0, ' ms')}</td>
								<td>{fmt(row.lossPct, 1, ' %')}</td>
								<td>{mbit(row.downMedianBps)}</td>
								<td>{mbit(row.upMedianBps)}</td>
								<td>{row.nTrips}</td>
								<td>{row.nSamples}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="card">
		<h2>{m.byIceState}</h2>
		<p>
			{m.iceIntro}
		</p>
		{#if data.byIceState.length === 0}
			<p>{m.noData}</p>
		{:else}
			<div style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>{m.forecast}</th>
							<th>{m.avail}</th>
							<th>{m.loss}</th>
							<th>{m.rttMedian}</th>
							<th>{m.trips}</th>
							<th>{m.measureWindows}</th>
						</tr>
					</thead>
					<tbody>
						{#each data.byIceState as row (row.iceState)}
							<tr>
								<td>{iceStateLabel(row.iceState)}</td>
								<td>{fmt(row.availPct, 0, ' %')}</td>
								<td>{fmt(row.lossPct, 1, ' %')}</td>
								<td>{fmt(row.rttMedian, 0, ' ms')}</td>
								<td>{row.nTrips}</td>
								<td>{row.nSamples}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p>{m.availNote}</p>
		{/if}
	</div>

	{#if trips.length > 0}
		<div class="card">
			<h2>{m.recentTrips}</h2>
			<p>{m.recentIntro}</p>
			<div style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>{m.train}</th>
							<th>{m.route}</th>
							<th>{m.start}</th>
							<th>{m.samples}</th>
						</tr>
					</thead>
					<tbody>
						{#each trips as t (t.id)}
							<tr>
								<td><a href="/trips/{t.id}">{tripLabel(t)}</a>{#if t.status === 'active'} · {m.live}{/if}</td>
								<td>{t.originName && t.destinationName ? `${t.originName} → ${t.destinationName}` : '–'}</td>
								<td>{fmtDateTime(t.startedAt)}</td>
								<td>{t.sampleCount ?? '–'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<div class="card">
		<p>
			{m.footerPre}<a href="/map">/map</a>{m.footerPost}
		</p>
	</div>
{/if}
