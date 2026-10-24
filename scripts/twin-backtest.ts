/**
 * Headless replay of the twin from January 2016 through the last release,
 * printing how well it tracks the data and the 2020 spatial backtest.
 *
 *   npm run twin:backtest
 */
import { spatialBacktest } from '../src/twin/backtest';
import { loadTwinDataFromDisk } from '../src/twin/nodeData';
import { Simulation } from '../src/twin/simulation';

const data = await loadTwinDataFromDisk();
const t0 = performance.now();
const sim = Simulation.create(data);
console.log(`population ${sim.world.n.toLocaleString()} synthetic people, ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const pct = (x: number | null | undefined, d = 1) => (x == null ? '  -  ' : (100 * x).toFixed(d).padStart(5));
console.log('\nmonth    u(real) u(twin)  demand  LF dial  LTU(real) LTU(twin) dur(real) dur(twin)  evals');
let evals = 0;
const t1 = performance.now();
while (sim.nextFrame()) {
  const r = sim.step();
  evals += r.evaluations;
  if (r.label.endsWith('-01') || r.label.endsWith('-07') || (r.label >= '2020-03' && r.label <= '2020-06')) {
    const o = r.observed!;
    console.log(
      `${r.label}  ${pct(o.unrate)}   ${pct(r.stats.unemploymentRate)}   ${Math.exp(r.logDemand).toFixed(3)}   ${r.participation.toFixed(3)}    ` +
        `${pct(o.longTermShare)}     ${pct(r.stats.longTermShare)}     ${(o.meanDurationWeeks ?? 0).toFixed(1).padStart(5)}     ${r.stats.meanDurationWeeks.toFixed(1).padStart(5)}    ${r.evaluations}`,
    );
  }
}
const months = sim.history.length - 1;
console.log(`\n${months} months replayed in ${((performance.now() - t1) / 1000).toFixed(1)}s (${(evals / months).toFixed(1)} trial months per month)`);

const track = sim.history.slice(1).map((h) => Math.abs(h.stats.unemploymentRate - (h.observed?.unrate ?? h.stats.unemploymentRate)));
console.log(`national unemployment tracking error: mean ${(100 * track.reduce((a, b) => a + b, 0) / track.length).toFixed(2)} pp, max ${(100 * Math.max(...track)).toFixed(2)} pp`);

const lt = sim.history.slice(1).filter((h) => h.observed?.longTermShare != null);
const ltErr = lt.map((h) => Math.abs(h.stats.longTermShare - h.observed!.longTermShare!));
console.log(`untargeted: long-term unemployment share error, mean ${(100 * ltErr.reduce((a, b) => a + b, 0) / ltErr.length).toFixed(1)} pp`);

const rate2020 = sim.annualCountyRate(2020);
if (rate2020) {
  const bt = spatialBacktest(data.counties, rate2020);
  console.log(`\nSpatial backtest, ${bt.counties} counties, ${bt.baseYear} -> ${bt.year} (BLS LAUS annual averages)`);
  console.log(`  national: ${(100 * bt.national.actualBase).toFixed(1)}% -> ${(100 * bt.national.actual).toFixed(1)}%`);
  console.log(`  RMSE of ${bt.year} county rates (pp): twin ${bt.rmse.twin.toFixed(2)} | uniform shift ${bt.rmse.uniform.toFixed(2)} | proportional ${bt.rmse.proportional.toFixed(2)}`);
  console.log(`  correlation of predicted vs actual change: twin ${bt.changeCorrelation.twin.toFixed(2)} | proportional ${bt.changeCorrelation.proportional.toFixed(2)}`);
}
