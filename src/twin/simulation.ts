/**
 * Simulation: one timeline of the twin. Wires the population, the engine,
 * the release frames and the assimilator together, and records history.
 *
 * Modes, per month:
 *  - replay: a release exists, so the dials are solved from data
 *  - forecast: past the last release, dials persist at their last values
 *  - branch: a fork of another timeline that follows its parent's dials
 *    with the player's shocks applied on top (counterfactual history)
 */
import { Assimilator, buildFrames, policyFor, type ReleaseFrame } from './assimilation';
import type { TwinData } from './data';
import { Engine, measure, type MonthStats } from './engine';
import { DEFAULT_POPULATION, synthesize, type PopulationOptions } from './population';
import { DEFAULT_POLICY, type Drivers, type Policy, World } from './world';

export interface Shocks {
  /** multiplier on aggregate demand */
  demand: number;
  /** multiplier per twin sector */
  sector: number[];
  /** multiplier per county */
  regional: Float64Array;
  /** replaces the policy (null = follow the timeline's policy) */
  policy: Policy | null;
  /** multiplier on matching efficiency, on top of the policy */
  matchBoost: number;
}

export function noShocks(ns: number, nc: number): Shocks {
  return { demand: 1, sector: new Array(ns).fill(1), regional: new Float64Array(nc).fill(1), policy: null, matchBoost: 1 };
}

export interface MonthRecord {
  label: string;
  mode: 'spinup' | 'replay' | 'forecast' | 'branch';
  stats: MonthStats;
  logDemand: number;
  participation: number;
  policy: Policy;
  policyNote: string;
  observed: ReleaseFrame | null;
  evaluations: number;
}

export class Simulation {
  readonly data: TwinData;
  readonly engine: Engine;
  world: World;
  frames: ReleaseFrame[];
  history: MonthRecord[] = [];
  /** county unemployment rate by month (index = world.t at the end of that month) */
  countyHistory: Float32Array[] = [];
  readonly assim: Assimilator;
  drivers: Drivers;
  shocks: Shocks;
  parent: Simulation | null = null;

  private constructor(data: TwinData, world: World, engine: Engine) {
    this.data = data;
    this.world = world;
    this.engine = engine;
    this.frames = buildFrames(data.releases, data.counties.meta.sectors, world.label(0));
    this.assim = new Assimilator(engine);
    const ns = world.ns;
    this.drivers = {
      demand: 1,
      participation: 1,
      sector: new Float64Array(ns).fill(1),
      regional: new Float64Array(world.nc).fill(1),
      policy: DEFAULT_POLICY,
    };
    this.shocks = noShocks(ns, world.nc);
  }

  static create(data: TwinData, opts: Partial<PopulationOptions> = {}, spinupMonths = 36): Simulation {
    const world = synthesize(data.counties, { ...DEFAULT_POPULATION, ...opts });
    const engine = new Engine(data.counties);
    const sim = new Simulation(data, world, engine);
    const stats = engine.spinup(world, sim.drivers, spinupMonths);
    sim.assim.lf0 = stats.laborForce;
    sim.countyHistory.push(stats.countyU);
    sim.history.push({
      label: world.label(0),
      mode: 'spinup',
      stats,
      logDemand: 0,
      participation: 1,
      policy: DEFAULT_POLICY,
      policyNote: '',
      observed: sim.frames[0] ?? null,
      evaluations: 0,
    });
    return sim;
  }

  get label(): string {
    return this.world.label();
  }

  /** The frame for the month about to be simulated, if the data has it. */
  nextFrame(): ReleaseFrame | null {
    return this.frames[this.world.t + 1] ?? null;
  }

  get lastReleaseLabel(): string {
    return this.frames[this.frames.length - 1].label;
  }

  /** Advance one month. A branch must be stepped after its parent. */
  step(): MonthRecord {
    const frame = this.nextFrame();
    const label = this.world.label(this.world.t + 1);
    const pol = policyFor(label);
    let rec: MonthRecord;
    if (this.parent) {
      const p = this.parent.history[this.world.t + 1];
      if (!p) throw new Error('step the parent timeline first');
      this.setDrivers(p.logDemand, p.participation, p.observed?.sectorMix ?? this.drivers.sector, p.policy);
      const stats = this.engine.step(this.world, this.drivers);
      rec = { ...p, mode: 'branch', stats, policy: this.drivers.policy, evaluations: 1 };
    } else if (frame && frame.unrate != null) {
      const res = this.assim.step(this.world, frame, (w) => {
        this.setDrivers(this.assim.logA, this.assim.P, frame.sectorMix, pol.policy);
        return this.engine.step(w, this.drivers);
      });
      rec = {
        label,
        mode: 'replay',
        stats: res.stats,
        logDemand: res.logDemand,
        participation: res.participation,
        policy: pol.policy,
        policyNote: pol.changed ? pol.note : '',
        observed: frame,
        evaluations: res.evaluations,
      };
    } else {
      const last = this.history[this.history.length - 1];
      this.setDrivers(last.logDemand, last.participation, this.drivers.sector, pol.policy);
      const stats = this.engine.step(this.world, this.drivers);
      rec = { label, mode: 'forecast', stats, logDemand: last.logDemand, participation: last.participation, policy: this.drivers.policy, policyNote: '', observed: null, evaluations: 1 };
    }
    this.history.push(rec);
    this.countyHistory.push(rec.stats.countyU);
    return rec;
  }

  private setDrivers(logA: number, P: number, mix: Float64Array, policy: Policy) {
    const s = this.shocks;
    this.drivers.demand = Math.exp(logA) * s.demand;
    this.drivers.participation = P;
    for (let k = 0; k < this.drivers.sector.length; k++) this.drivers.sector[k] = mix[k] * s.sector[k];
    this.drivers.regional = s.regional;
    const base = s.policy ?? policy;
    this.drivers.policy = s.matchBoost === 1 ? base : { ...base, matchBoost: base.matchBoost * s.matchBoost };
  }

  /** Fork this timeline. The branch follows this timeline's dials plus its own shocks. */
  fork(): Simulation {
    const b = new Simulation(this.data, this.world.clone(), this.engine);
    b.parent = this;
    b.assim.lf0 = this.assim.lf0;
    b.history = this.history.slice();
    b.countyHistory = this.countyHistory.slice();
    b.drivers.sector = this.drivers.sector.slice();
    return b;
  }

  /** County unemployment averaged over the twin's months of a calendar year. */
  annualCountyRate(year: number): Float32Array | null {
    const months = this.history.map((h, i) => [h.label, i] as const).filter(([l]) => l.startsWith(`${year}-`));
    if (months.length < 12) return null;
    const out = new Float32Array(this.world.nc);
    for (const [, i] of months) {
      const u = this.countyHistory[i];
      for (let c = 0; c < out.length; c++) out[c] += u[c] / months.length;
    }
    return out;
  }

  snapshot(): MonthStats {
    return measure(this.world, 0, 0);
  }
}
