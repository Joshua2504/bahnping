<script lang="ts">
	// Kleine RTT-Sparkline (letzte ~5 Minuten) für den Fahrt-Modus.
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';

	let { points }: { points: { t: number; rtt: number | null }[] } = $props();

	let container: HTMLDivElement | undefined = $state(undefined);
	let chart: uPlot | null = null;

	function toData(pts: typeof points): uPlot.AlignedData {
		return [pts.map((p) => p.t / 1000), pts.map((p) => p.rtt)] as uPlot.AlignedData;
	}

	$effect(() => {
		const data = toData(points);
		if (!container) return;

		if (!chart) {
			chart = new uPlot(
				{
					width: container.clientWidth || 280,
					height: 72,
					padding: [4, 4, 0, 4],
					cursor: { show: false },
					legend: { show: false },
					axes: [{ show: false }, { show: false }],
					scales: { x: { time: false } },
					series: [{}, { stroke: '#4ade80', width: 2, points: { show: false } }],
				},
				data,
				container,
			);
		} else {
			chart.setSize({ width: container.clientWidth || 280, height: 72 });
			chart.setData(data);
		}
	});

	$effect(() => {
		return () => {
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="sparkline" bind:this={container}></div>

<style>
	.sparkline {
		width: 100%;
		height: 72px;
	}
</style>
