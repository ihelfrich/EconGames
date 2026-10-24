import { beforeAll, describe, expect, it } from 'vitest';
import { buildFrames } from './assimilation';
import { spatialBacktest } from './backtest';
import type { TwinData } from './data';
import { Engine, measure } from './engine';
import { loadTwinDataFromDisk } from './nodeData';
import { synthesize } from './population';
import { Simulation } from './simulation';
import { measureStates, newStateMeasure } from './states';
import { DEFAULT_POLICY, STATUS, type Drivers } from './world';

let data: TwinData;
beforeAll(async () => {
  data = await loadTwinDataFromDisk();
});

const neutral = (nc: number, ns: number): Drivers => ({
  demand: 1,
  participation: 1,
  sector: new Float64Array(ns).fill(1),
  regional: new Float64Array(nc).fill(1),
  policy: DEFAULT_POLICY,
});

describe('data files', () => {
  it('cover every county on the map', () => {
    const c = data.counties;
    expect(c.fips.length).toBeGreaterThan(3100);
    const onMap = new Set(data.grid.cells.filter((x) => x >= 0));
    expect(onMap.size).toBe(c.fips.length);
    const pop = c.pop.reduce((a, b) => a + b, 0);
    expect(pop).toBeGreaterThan(320e6);
    expect(pop).toBeLessThan(335e6);
  });

  it('have monthly releases aligned with the sector groups', () => {
    const r = data.releases;
    for (const g of Object.values(r.sectorGroups)) expect(g.length).toBe(r.months.length);
    const frames = buildFrames(r, data.counties.meta.sectors, '2016-01');
    expect(frames[0].laborForceRatio).toBeCloseTo(1, 6);
    expect(frames[0].sectorMix.every((v) => Math.abs(v - 1) < 1e-9)).toBe(true);
    const apr20 = frames.find((f) => f.label === '2020-04')!;
    expect(apr20.unrate).toBeGreaterThan(0.14);
  });
});

describe('synthetic population', () => {
  const world = () => synthesize(data.counties);

  it('hits county labor force and unemployment from BLS LAUS 2016', () => {
    const w = world();
    const c = data.counties;
    for (const fips of ['06037', '17031', '32003', '30111']) {
      const k = c.fips.indexOf(fips);
      let lf = 0;
      let un = 0;
      for (let i = w.countyStart[k]; i < w.countyStart[k + 1]; i++) {
        if (w.status[i] === STATUS.EMPLOYED || w.status[i] === STATUS.UNEMPLOYED) lf++;
        if (w.status[i] === STATUS.UNEMPLOYED) un++;
      }
      const target = c.unemp[k][3]! / c.lf[k][3]!;
      // exact up to rounding one synthetic person
      expect(Math.abs(un / lf - target)).toBeLessThan(1.5 / lf);
      expect(Math.abs(lf * w.weight[k] - c.lf[k][3]!) / c.lf[k][3]!).toBeLessThan(0.02);
    }
  });

  it('matches age and race marginals', () => {
    const w = world();
    const k = data.counties.fips.indexOf('06037');
    const n = w.countyStart[k + 1] - w.countyStart[k];
    let kids = 0;
    let hispanic = 0;
    for (let i = w.countyStart[k]; i < w.countyStart[k + 1]; i++) {
      if (w.age[i] < 15) kids++;
      if (w.race[i] === 3) hispanic++;
    }
    const age = data.counties.age[k];
    expect(kids / n).toBeCloseTo(age[0] + age[1] + age[2], 1);
    expect(hispanic / n).toBeCloseTo(data.counties.race[k][3], 1);
  });

  it('is reproducible from its seed', () => {
    const a = world();
    const b = world();
    expect(a.n).toBe(b.n);
    expect(a.wage).toEqual(b.wage);
  });
});

describe('engine', () => {
  it('holds a steady state under neutral drivers and conserves people', () => {
    const w = synthesize(data.counties, { scale: 3000, minPerCounty: 40, seed: 7, laborYearIndex: 3 });
    const eng = new Engine(data.counties);
    const d = neutral(w.nc, w.ns);
    const s0 = eng.spinup(w, d, 24);
    let s = s0;
    for (let m = 0; m < 12; m++) s = eng.step(w, d);
    expect(Math.abs(s.unemploymentRate - s0.unemploymentRate)).toBeLessThan(0.006);
    expect(Math.abs(s.laborForce / s0.laborForce - 1)).toBeLessThan(0.01);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < w.n; i++) counts[w.status[i]]++;
    expect(counts.reduce((a, b) => a + b, 0)).toBe(w.n);
  });

  it('uses common random numbers: same drivers, same outcome; less demand, more unemployment', () => {
    const w = synthesize(data.counties, { scale: 3000, minPerCounty: 40, seed: 11, laborYearIndex: 3 });
    const eng = new Engine(data.counties);
    eng.spinup(w, neutral(w.nc, w.ns), 12);
    const a = w.clone();
    const b = w.clone();
    const c = w.clone();
    const sa = eng.step(a, neutral(w.nc, w.ns));
    const sb = eng.step(b, neutral(w.nc, w.ns));
    const low = { ...neutral(w.nc, w.ns), demand: 0.9 };
    const sc = eng.step(c, low);
    expect(sa.unemploymentRate).toBe(sb.unemploymentRate);
    expect(Array.from(a.status)).toEqual(Array.from(b.status));
    expect(sc.unemploymentRate).toBeGreaterThan(sa.unemploymentRate + 0.02);
    expect(measure(a, 0, 0).unemploymentRate).toBeCloseTo(sa.unemploymentRate, 10);
  });
});

describe('assimilation', () => {
  it('tracks the BLS unemployment rate through the 2020 shock', () => {
    const sim = Simulation.create(data, { scale: 3000, minPerCounty: 40, seed: 3 }, 24);
    while (sim.nextFrame() && sim.label < '2020-08') sim.step();
    const replayed = sim.history.slice(1);
    expect(replayed.length).toBeGreaterThan(50);
    for (const h of replayed) expect(Math.abs(h.stats.unemploymentRate - h.observed!.unrate!)).toBeLessThan(0.0015);
    const apr = sim.history.find((h) => h.label === '2020-04')!;
    // the hidden demand shock the data implies
    expect(Math.exp(apr.logDemand)).toBeLessThan(0.85);
  }, 120_000);

  it('lets a branch follow its parent and diverge only through its shocks', () => {
    const sim = Simulation.create(data, { scale: 4000, minPerCounty: 30, seed: 5 }, 12);
    for (let i = 0; i < 3; i++) sim.step();
    const same = sim.fork();
    const hit = sim.fork();
    hit.shocks.demand = 0.92;
    for (let i = 0; i < 3; i++) {
      const p = sim.step();
      const s = same.step();
      const h = hit.step();
      expect(s.stats.unemploymentRate).toBeCloseTo(p.stats.unemploymentRate, 10);
      expect(h.stats.unemploymentRate).toBeGreaterThan(p.stats.unemploymentRate);
    }
  }, 60_000);
});

describe('state assimilation', () => {
  it('pins each state to its BLS release, including Nevada in April 2020', () => {
    const st = data.releases.states;
    expect(st, 'state releases are bundled').toBeTruthy();
    const sim = Simulation.create(data, { scale: 3000, minPerCounty: 40, seed: 9 }, 24);
    while (sim.nextFrame() && sim.label < '2020-04') sim.step();
    const apr = sim.history.find((h) => h.label === '2020-04')!;
    expect(apr.stateError).not.toBeNull();
    // labor-force-weighted mean gap error under half a point, even in the shock month
    expect(apr.stateError!).toBeLessThan(0.005);
    const nv = sim.states!.codes.indexOf('32');
    const m = measureStates(sim.world, sim.states!, newStateMeasure(sim.states!.n));
    const twinNV = m.unemployed[nv] / m.laborForce[nv];
    const blsNV = apr.observed!.stateUnrate![nv];
    expect(blsNV).toBeGreaterThan(0.2);
    // the world now holds April's end state
    expect(Math.abs(twinNV - blsNV)).toBeLessThan(0.02);
    // and the national rate is still on target
    expect(Math.abs(apr.stats.unemploymentRate - apr.observed!.unrate!)).toBeLessThan(0.002);
    // Nevada needed a demand shock beyond the nation's
    expect(Math.exp(apr.stateLogR![nv])).toBeLessThan(0.9);
  }, 120_000);
});

describe('spatial backtest', () => {
  it('scores a perfect forecast at zero error', () => {
    const c = data.counties;
    const truth = Float32Array.from(c.fips, (_, k) => (c.lf[k][4] && c.unemp[k][4] != null ? c.unemp[k][4]! / c.lf[k][4]! : 0));
    const r = spatialBacktest(c, truth);
    expect(r.rmse.twin).toBeLessThan(1e-4 * 100);
    expect(r.changeCorrelation.twin).toBeCloseTo(1, 5);
    expect(r.rmse.uniform).toBeGreaterThan(1);
    expect(r.withinState.rmse.twin).toBeLessThan(1e-2);
    // a state-wide shift has no within-state variation to correlate
    expect(r.withinState.changeCorrelation.stateShift).toBe(0);
  });
});
