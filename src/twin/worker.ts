/// <reference lib="webworker" />
/**
 * Runs the twin off the UI thread. The UI asks for one month at a time and
 * renders whatever comes back, so the page stays responsive at any speed.
 */
import { loadTwinData } from './data';
import type { MonthStats } from './engine';
import type { CountyDetail, FromWorker, NationalStats, PersonView, ShockSpec, ToWorker } from './protocol';
import { Simulation, type MonthRecord } from './simulation';
import { HEALTH, STATUS, type World } from './world';

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let sim: Simulation | null = null;
let branch: Simulation | null = null;
let followed: number | null = null;

function national(s: MonthStats): NationalStats {
  return {
    unemploymentRate: s.unemploymentRate,
    laborForce: s.laborForce,
    employed: s.employed,
    participationRate: s.participationRate,
    meanDurationWeeks: s.meanDurationWeeks,
    longTermShare: s.longTermShare,
    hires: s.hires,
    separations: s.separations,
    avgWage: s.avgWage,
    sectorEmployment: Array.from(s.sectorEmployment),
  };
}

function person(w: World, i: number): PersonView {
  return {
    id: i,
    county: w.county[i],
    age: w.age[i],
    sex: w.sex[i],
    race: w.race[i],
    edu: w.edu[i],
    status: w.status[i],
    sector: w.sector[i],
    wage: w.wage[i],
    dur: w.dur[i],
    tenure: w.tenure[i],
    health: w.health[i],
    vote: w.vote[i],
  };
}

function applyShocks(target: Simulation, spec: ShockSpec) {
  const d = target.data.counties;
  target.shocks.demand = spec.demand;
  target.shocks.sector = spec.sector.slice();
  target.shocks.policy = spec.policy;
  target.shocks.matchBoost = spec.matchBoost;
  const reg = new Float64Array(d.fips.length).fill(1);
  for (let c = 0; c < reg.length; c++) reg[c] = spec.states[d.state[c]] ?? 1;
  target.shocks.regional = reg;
}

function sendMonth(rec: MonthRecord, brec: MonthRecord | null) {
  const s = sim!;
  const countyU = rec.stats.countyU.slice();
  const bU = brec ? brec.stats.countyU.slice() : null;
  const view = branch ?? s;
  post(
    {
      type: 'month',
      t: s.world.t,
      label: rec.label,
      mode: rec.mode,
      national: national(rec.stats),
      observed: rec.observed
        ? {
            unrate: rec.observed.unrate,
            longTermShare: rec.observed.longTermShare,
            meanDurationWeeks: rec.observed.meanDurationWeeks,
            laborForceRatio: rec.observed.laborForceRatio,
          }
        : null,
      demand: Math.exp(rec.logDemand),
      participation: rec.participation,
      policy: rec.policy,
      policyNote: rec.policyNote,
      evaluations: rec.evaluations,
      countyU,
      branch: brec && bU ? { national: national(brec.stats), countyU: bU } : null,
      followed: followed != null ? person(view.world, followed) : null,
      lastRelease: s.lastReleaseLabel,
    },
    bU ? [countyU.buffer, bU.buffer] : [countyU.buffer],
  );
}

function countyDetail(c: number, nonce: number): CountyDetail {
  const s = branch ?? sim!;
  const w = s.world;
  const ns = w.ns;
  const wt = w.weight[c];
  const pyramid: [number, number][] = Array.from({ length: 18 }, () => [0, 0]);
  const status = [0, 0, 0, 0];
  const sector = new Array(ns).fill(0);
  const wageSum = new Array(ns).fill(0);
  const race = [0, 0, 0, 0, 0];
  const edu = [0, 0, 0, 0];
  const vote = [0, 0, 0, 0];
  const health = [0, 0, 0, 0];
  let adults = 0;
  for (let i = w.countyStart[c]; i < w.countyStart[c + 1]; i++) {
    pyramid[Math.min(17, Math.floor(w.age[i] / 5))][w.sex[i]] += wt;
    status[w.status[i]] += wt;
    race[w.race[i]] += wt;
    if (w.status[i] === STATUS.EMPLOYED) {
      sector[w.sector[i]] += wt;
      wageSum[w.sector[i]] += w.wage[i] * wt;
    }
    if (w.age[i] >= 25 && w.edu[i] < 4) edu[w.edu[i]] += wt;
    if (w.age[i] >= 18) {
      adults += wt;
      vote[w.vote[i]] += wt;
      if (w.health[i] & HEALTH.OBESE) health[0] += wt;
      if (w.health[i] & HEALTH.SMOKER) health[1] += wt;
      if (w.health[i] & HEALTH.POOR_HEALTH) health[2] += wt;
    }
    if (w.health[i] & HEALTH.UNINSURED) health[3] += wt;
  }
  return {
    type: 'county',
    nonce,
    county: c,
    agents: w.countyStart[c + 1] - w.countyStart[c],
    weight: wt,
    pyramid,
    status,
    sector,
    avgWageBySector: wageSum.map((v, k) => (sector[k] > 0 ? v / sector[k] : 0)),
    race,
    edu,
    vote,
    health: health.map((h, k) => h / ((k === 3 ? (w.countyStart[c + 1] - w.countyStart[c]) * wt : adults) || 1)),
    matchingEfficiency: w.mu[c],
    uTarget: w.uTarget[c],
  };
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        branch = null;
        followed = null;
        post({ type: 'progress', message: 'Loading county data…' });
        const data = await loadTwinData(async (name) => (await fetch(msg.base + name)).json());
        post({ type: 'progress', message: `Synthesizing ${Math.round(data.counties.pop.reduce((a, b) => a + b, 0) / 1e6)} million Americans…` });
        sim = Simulation.create(data, msg.options);
        post({ type: 'ready', n: sim.world.n, nc: sim.world.nc, startLabel: sim.label, lastRelease: sim.lastReleaseLabel });
        sendMonth(sim.history[0], null);
        break;
      }
      case 'step': {
        if (!sim) return;
        const rec = sim.step();
        const brec = branch ? branch.step() : null;
        sendMonth(rec, brec);
        break;
      }
      case 'fork': {
        if (!sim) return;
        branch = sim.fork();
        applyShocks(branch, msg.shocks);
        break;
      }
      case 'setShocks':
        if (branch) applyShocks(branch, msg.shocks);
        break;
      case 'unfork':
        branch = null;
        break;
      case 'county':
        if (sim) post(countyDetail(msg.county, msg.nonce));
        break;
      case 'residents': {
        if (!sim) return;
        const w = (branch ?? sim).world;
        const a = w.countyStart[msg.county];
        const b = w.countyStart[msg.county + 1];
        // prefer adults, spread across the county's rows
        const people: PersonView[] = [];
        const step = Math.max(1, Math.floor((b - a) / (msg.count * 3)));
        const offset = Math.floor(Math.random() * step);
        for (let i = a + offset; i < b && people.length < msg.count; i += step) {
          if (w.age[i] >= 18 && Math.random() < 0.5) people.push(person(w, i));
        }
        post({ type: 'residents', nonce: msg.nonce, people });
        break;
      }
      case 'follow':
        followed = msg.person;
        break;
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
  }
};
