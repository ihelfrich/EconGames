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

const st = sim.history.slice(1).filter((h) => h.stateError != null);
if (st.length) {
  const errs = st.map((h) => h.stateError!);
  const apr = sim.history.find((h) => h.label === '2020-04');
  console.log(
    `state releases: ${sim.states!.n} states, gap tracking error mean ${(100 * errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2)} pp, max ${(100 * Math.max(...errs)).toFixed(2)} pp` +
      (apr?.stateLogR ? `; April 2020 hidden state demand: ${sim.states!.postal.map((p, k) => [p, Math.exp(apr.stateLogR![k])] as const).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([p, v]) => `${p} ${(100 * (v - 1)).toFixed(0)}%`).join(', ')}` : ''),
  );
}

const races = sim.history.filter((h) => h.observed?.raceUnrate && ['2016-06', '2020-04', '2021-01', '2024-01'].includes(h.label));
if (races.length) {
  console.log('\nunemployment by race (CPS vs twin; race incidence is steered):');
  console.log('  month    Black(CPS) twin   Asian(CPS) twin   Hispanic(CPS) twin   risk B/A/H');
  for (const h of races) {
    const o = h.observed!.raceUnrate!;
    const t = h.raceRates!;
    const r = h.raceRisk!;
    console.log(`  ${h.label}   ${pct(o[1])}  ${pct(t[1])}    ${pct(o[2])}  ${pct(t[2])}    ${pct(o[3])}     ${pct(t[3])}     ${r[1].toFixed(2)}/${r[2].toFixed(2)}/${r[3].toFixed(2)}`);
  }
}

const raceMonths = sim.history.filter((h) => h.raceRates && h.observed?.raceUnrate);
if (raceMonths.length) {
  const mae = (g: number) => (100 * raceMonths.reduce((a, h) => a + Math.abs(h.raceRates![g] - h.observed!.raceUnrate![g]), 0)) / raceMonths.length;
  console.log(`race tracking, mean abs error: Black ${mae(1).toFixed(2)} pp, Asian ${mae(2).toFixed(2)} pp, Hispanic ${mae(3).toFixed(2)} pp`);
}

const rate2020 = sim.annualCountyRate(2020);
const rate2016 = sim.annualCountyRate(2016);
if (rate2020) {
  const bt = spatialBacktest(data.counties, rate2020, 2020, 2016, rate2016);
  const f = (x: number) => x.toFixed(2).padStart(6);
  console.log(`\nSpatial backtest, ${bt.counties} counties, ${bt.baseYear} -> ${bt.year} (BLS LAUS annual averages)`);
  console.log(`  national: ${(100 * bt.national.actualBase).toFixed(1)}% -> ${(100 * bt.national.actual).toFixed(1)}%`);
  console.log('  predictor              RMSE  Δcorr | within-state RMSE  Δcorr');
  for (const k of Object.keys(bt.rmse) as (keyof typeof bt.rmse)[]) {
    console.log(`  ${k.padEnd(19)} ${f(bt.rmse[k])} ${f(bt.changeCorrelation[k])} |            ${f(bt.withinState.rmse[k])} ${f(bt.withinState.changeCorrelation[k])}`);
  }
}
