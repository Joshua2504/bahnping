<script lang="ts">
	// Admin-Seite: Review unbekannter/aller ASNs, Netzklasse per Hand setzen.
	import { NET_CLASSES, NET_CLASS_LABELS, type AdminAsn, type NetClass } from '@bahn/shared';
	import { ApiError, api } from '#lib/api.js';
	import { auth } from '#lib/auth.svelte.js';

	let filter = $state<'unknown' | 'all'>('unknown');
	let rows = $state<AdminAsn[] | null>(null);
	let loadError = $state<string | null>(null);
	let pendingClass = $state<Record<number, NetClass>>({});
	let saving = $state<Record<number, boolean>>({});
	let feedback = $state<Record<number, string>>({});

	async function load(): Promise<void> {
		loadError = null;
		try {
			rows = await api.adminAsns(filter);
			pendingClass = Object.fromEntries((rows ?? []).map((r) => [r.asn, r.netClass]));
		} catch (err) {
			loadError = err instanceof ApiError ? (err.detail ?? err.title) : 'ASNs konnten nicht geladen werden';
		}
	}

	$effect(() => {
		if (auth.me?.role === 'admin') void load();
	});

	async function save(asn: number): Promise<void> {
		const netClass = pendingClass[asn];
		if (!netClass) return;
		saving = { ...saving, [asn]: true };
		feedback = { ...feedback, [asn]: '' };
		try {
			const res = await api.adminUpdateAsn(asn, { netClass });
			rows = (rows ?? []).map((r) => (r.asn === asn ? res.asn : r));
			feedback = { ...feedback, [asn]: `Gespeichert, ${res.samplesUpdated} Messwerte aktualisiert.` };
		} catch (err) {
			feedback = { ...feedback, [asn]: err instanceof ApiError ? (err.detail ?? err.title) : 'Speichern fehlgeschlagen' };
		} finally {
			saving = { ...saving, [asn]: false };
		}
	}
</script>

<svelte:head>
	<title>Admin</title>
</svelte:head>

<h1>Admin</h1>

{#if auth.loading}
	<p>Lade…</p>
{:else if auth.me?.role !== 'admin'}
	<div class="notice warn">Dieser Bereich ist nur für Admins.</div>
{:else}
	<div class="card">
		<div class="field" style="max-width: 240px">
			<label for="filter">Filter</label>
			<select id="filter" bind:value={filter} onchange={load}>
				<option value="unknown">nur unbekannte</option>
				<option value="all">alle</option>
			</select>
		</div>
	</div>

	{#if loadError}
		<div class="notice error">{loadError}</div>
	{:else if rows === null}
		<p>Lade…</p>
	{:else if rows.length === 0}
		<p>Keine ASNs gefunden.</p>
	{:else}
		<div class="card" style="overflow-x: auto">
			<table>
				<thead>
					<tr>
						<th>ASN</th>
						<th>Name</th>
						<th>Klasse</th>
						<th>Quelle</th>
						<th>Sichtungen</th>
						<th>Messwerte</th>
						<th>Fahrten</th>
						<th>Review</th>
						<th>Neue Klasse</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.asn)}
						<tr>
							<td>AS{row.asn}</td>
							<td>{row.name}</td>
							<td>{NET_CLASS_LABELS[row.netClass]}</td>
							<td>{row.source}</td>
							<td>{row.seen}</td>
							<td>{row.samples}</td>
							<td>{row.trips}</td>
							<td>{row.reviewedAt ? new Date(row.reviewedAt).toLocaleString('de-DE') : '–'}</td>
							<td>
								<select
									value={pendingClass[row.asn] ?? row.netClass}
									onchange={(e) => (pendingClass = { ...pendingClass, [row.asn]: (e.target as HTMLSelectElement).value as NetClass })}
								>
									{#each NET_CLASSES as c (c)}
										<option value={c}>{NET_CLASS_LABELS[c]}</option>
									{/each}
								</select>
							</td>
							<td>
								<button class="btn" disabled={saving[row.asn]} onclick={() => save(row.asn)}>
									{saving[row.asn] ? 'Speichere…' : 'Speichern'}
								</button>
								{#if feedback[row.asn]}<div style="font-size: 0.8rem; margin-top: 0.3rem">{feedback[row.asn]}</div>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}
