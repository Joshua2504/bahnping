<script lang="ts">
	// Öffentliche Statistikseite: Gesamtzahlen + Kennzahlen je Netzklasse, aus /api/public/stats.
	import { onMount } from 'svelte';
	import { ICE_STATE_LABELS, NET_CLASS_LABELS, type PublicStats } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';

	let data = $state<PublicStats | null>(null);
	let loadError = $state<string | null>(null);

	function fmt(value: number | null, digits = 0, suffix = ''): string {
		return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
	}

	function mbit(bps: number | null): string {
		return bps === null ? '–' : `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
	}

	onMount(async () => {
		try {
			data = await api.publicStats();
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : 'Statistik konnte nicht geladen werden';
		}
	});
</script>

<svelte:head>
	<title>Statistik</title>
</svelte:head>

<h1>Statistik</h1>

{#if loadError}
	<div class="notice error">{loadError}</div>
{:else if !data}
	<p>Lade…</p>
{:else}
	<div class="card">
		<h2>Gesamt</h2>
		<div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr))">
			<div class="stat">
				<div class="stat__label">Fahrten</div>
				<div class="stat__value">{data.totals.trips}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Messwerte</div>
				<div class="stat__value">{data.totals.samples}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Nutzer</div>
				<div class="stat__value">{data.totals.users}</div>
			</div>
			<div class="stat">
				<div class="stat__label">Fahrten aktiv</div>
				<div class="stat__value">{data.totals.activeTrips}</div>
			</div>
		</div>
	</div>

	<div class="card">
		<h2>Nach Netzklasse</h2>
		{#if data.byNet.length === 0}
			<p>Noch keine Daten vorhanden.</p>
		{:else}
			<div style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>Netz</th>
							<th>Latenz (Median)</th>
							<th>Latenz (p90)</th>
							<th>Verlust</th>
							<th>Download (Median)</th>
							<th>Upload (Median)</th>
							<th>Fahrten</th>
							<th>Messwerte</th>
						</tr>
					</thead>
					<tbody>
						{#each data.byNet as row (row.netClass)}
							<tr>
								<td>{NET_CLASS_LABELS[row.netClass]}</td>
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
		<h2>Bordportal-Prognose vs. Messung</h2>
		<p>
			Das ICE-Portal zeigt für jeden Streckenabschnitt eine Netzprognose der DB. Das ist keine Messung. Hier steht, wie
			die Verbindung bei der jeweiligen Prognose tatsächlich war (nur Fahrten mit CLI/App, die das Bordportal auslesen).
		</p>
		{#if data.byIceState.length === 0}
			<p>Noch keine Daten vorhanden.</p>
		{:else}
			<div style="overflow-x: auto">
				<table>
					<thead>
						<tr>
							<th>Prognose</th>
							<th>Verfügbarkeit</th>
							<th>Verlust</th>
							<th>Latenz (Median)</th>
							<th>Fahrten</th>
							<th>Messfenster</th>
						</tr>
					</thead>
					<tbody>
						{#each data.byIceState as row (row.iceState)}
							<tr>
								<td>{ICE_STATE_LABELS[row.iceState] ?? row.iceState}</td>
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
			<p>Verfügbarkeit: Anteil der 10-Sekunden-Messfenster mit mindestens einer Ping-Antwort.</p>
		{/if}
	</div>

	<div class="card">
		<p>
			Live-Übersicht und Karte unter <a href="/map">/map</a>. Angaben ohne personenbezogene Daten; Zellen mit zu wenigen
			Fahrten erscheinen dort nicht.
		</p>
	</div>
{/if}
