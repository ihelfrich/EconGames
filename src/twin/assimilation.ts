/**
 * Data assimilation: keeps the twin on the path of real monthly releases.
 *
 * The twin has two unobserved dials, aggregate labor demand (A) and the
 * labor force (P). Each month that a release exists, the assimilator solves
 * for the (A, P) that make the twin's national unemployment rate and labor
 * force match the published numbers, by re-running the month from the same
 * starting state with the same random draws (quasi-Newton / Broyden
 * iterations, usually 2 to 4 trial months). Sector payroll releases set the
 * demand mix directly.
 *
 * When state releases exist, the assimilator also solves one demand dial and
 * one labor-force dial per state, so each state's unemployment gap to the
 * nation and its labor force growth match BLS LAUS. Nothing about counties
 * is fed in: where unemployment goes inside a state is the model's own
 * answer, which is what the within-state backtest checks.
 */
import type { Releases, SectorMeta } from './data';
import type { Engine, MonthStats } from './engine';
import { newStateMeasure, measureStates, type StateMap, type StateMeasure } from './states';
import { DEFAULT_POLICY, type Policy, STATUS, World } from './world';

export interface ReleaseFrame {
  label: string;
  /** unemployment rate, share */
  unrate: number | null;
  /** labor force relative to the start month, net of population growth */
  laborForceRatio: number | null;
  /** demand mix by twin sector, relative to the start month */
  sectorMix: Float64Array;
  /** raw values kept for charts */
  longTermShare: number | null;
  meanDurationWeeks: number | null;
  payems: number | null;
  /** per state: unemployment rate minus the labor-force-weighted all-state rate (share) */
  stateGap: Float64Array | null;
  /** per state: labor force relative to the start month, over the all-state ratio */
  stateLfRatio: Float64Array | null;
  /** per state: published unemployment rate (share), for charts */
  stateUnrate: Float64Array | null;
  /**
   * per twin race (meta.races order): CPS unemployment rate minus the
   * national rate (share); NaN for groups CPS does not publish on the twin's
   * definitions (non-Hispanic white, other)
   */
  raceGap: Float64Array | null;
  /** per twin race: CPS unemployment rate (share), NaN where not published */
  raceUnrate: Float64Array | null;
}

/** Twin race index -> CPS series. CPS counts Hispanics of any race; the twin's groups are exclusive. */
export const RACE_TARGETS: { race: number; key: 'black' | 'asian' | 'hispanic' }[] = [
  { race: 1, key: 'black' },
  { race: 2, key: 'asian' },
  { race: 3, key: 'hispanic' },
];

function raceFrame(releases: Releases, i: number) {
  const r = releases.raceUnrate;
  const u = releases.unrate[i];
  if (!r || u == null) return { raceGap: null, raceUnrate: null };
  const rate = new Float64Array(5).fill(NaN);
  for (const t of RACE_TARGETS) {
    const v = r[t.key][i];
    if (v == null) return { raceGap: null, raceUnrate: null };
    rate[t.race] = v / 100;
  }
  if (r.white[i] != null) rate[0] = r.white[i]! / 100;
  return { raceGap: rate.map((x, g) => (g === 0 || Number.isNaN(x) ? NaN : x - u / 100)), raceUnrate: rate };
}

function stateFrame(releases: Releases, i: number, i0: number) {
  const st = releases.states;
  if (!st) return { stateGap: null, stateLfRatio: null, stateUnrate: null };
  const n = st.codes.length;
  const u = new Float64Array(n);
  const ratio = new Float64Array(n);
  let un = 0;
  let lf = 0;
  let lfStart = 0;
  for (let s = 0; s < n; s++) {
    const r = st.unrate[s][i];
    const l = st.laborForce[s][i];
    const l0 = st.laborForce[s][i0];
    if (r == null || l == null || l0 == null) return { stateGap: null, stateLfRatio: null, stateUnrate: null };
    u[s] = r / 100;
    ratio[s] = l / l0;
    un += u[s] * l;
    lf += l;
    lfStart += l0;
  }
  const uAll = un / lf;
  const ratioAll = lf / lfStart;
  const gap = u.map((x) => x - uAll);
  return { stateGap: gap, stateLfRatio: ratio.map((x) => x / ratioAll), stateUnrate: u };
}

/** Civilian population 16+ growth the twin's fixed population does not have (CPS, ~2016-2023). */
export const POP_GROWTH_PER_YEAR = 0.0075;

export function buildFrames(releases: Releases, sectors: SectorMeta[], startLabel: string): ReleaseFrame[] {
  const i0 = releases.months.indexOf(startLabel);
  if (i0 < 0) throw new Error(`no release for ${startLabel}`);
  const frames: ReleaseFrame[] = [];
  const pay0 = releases.payems[i0]!;
  const lf0 = releases.laborForce[i0]!;
  for (let i = i0; i < releases.months.length; i++) {
    const t = i - i0;
    const pay = releases.payems[i];
    const mix = new Float64Array(sectors.length);
    sectors.forEach((s, k) => {
      const g = releases.sectorGroups[s.group];
      mix[k] = g && pay ? g[i] / g[i0] / (pay / pay0) : 1;
    });
    const u = releases.unrate[i];
    const lf = releases.laborForce[i];
    const unemployed = lf != null && releases.employed[i] != null ? lf - releases.employed[i]! : null;
    frames.push({
      label: releases.months[i],
      unrate: u == null ? null : u / 100,
      laborForceRatio: lf == null ? null : lf / lf0 / Math.pow(1 + POP_GROWTH_PER_YEAR, t / 12),
      sectorMix: mix,
      longTermShare: releases.longTerm[i] != null && unemployed ? releases.longTerm[i]! / unemployed : null,
      meanDurationWeeks: releases.meanDuration[i],
      payems: pay,
      ...stateFrame(releases, i, i0),
      ...raceFrame(releases, i),
    });
  }
  return frames;
}

/**
 * Unemployment insurance as it actually ran, nationally (states varied).
 * CARES Act (Mar 2020): +13 weeks (PEUC) and +$600/week (FPUC) to July 2020.
 * Continued Assistance Act (Dec 2020): 50 weeks total, +$300/week.
 * American Rescue Plan (Mar 2021): 79 weeks total; federal programs ended Sep 2021.
 */
export const POLICY_CALENDAR: { from: string; policy: Policy; note: string }[] = [
  { from: '2000-01', policy: DEFAULT_POLICY, note: '' },
  { from: '2020-04', policy: { uiMonths: 9, uiSearchPenalty: 0.35, matchBoost: 1 }, note: 'CARES Act: UI extended to 39 weeks, +$600/week' },
  { from: '2020-08', policy: { uiMonths: 9, uiSearchPenalty: 0.2, matchBoost: 1 }, note: 'The $600 supplement expires' },
  { from: '2021-01', policy: { uiMonths: 11.5, uiSearchPenalty: 0.28, matchBoost: 1 }, note: 'Continued Assistance Act: 50 weeks of UI, +$300/week' },
  { from: '2021-04', policy: { uiMonths: 18, uiSearchPenalty: 0.28, matchBoost: 1 }, note: 'American Rescue Plan: up to 79 weeks of UI' },
  { from: '2021-10', policy: DEFAULT_POLICY, note: 'Pandemic UI programs end (Sep 6, 2021)' },
];

export function policyFor(label: string): { policy: Policy; note: string; changed: boolean } {
  let cur = POLICY_CALENDAR[0];
  for (const p of POLICY_CALENDAR) if (p.from <= label) cur = p;
  return { policy: cur.policy, note: cur.note, changed: cur.from === label };
}

export interface AssimilationResult {
  stats: MonthStats;
  logDemand: number;
  participation: number;
  evaluations: number;
  residualU: number;
  /** labor-force-weighted mean absolute error of state unemployment gaps (share), null without state data */
  stateError: number | null;
}

const BOUNDS = { logA: [-0.9, 0.5], P: [0.85, 1.15], logR: [-1.2, 1.2], logQ: [-0.3, 0.3] } as const;
const TOL = 0.0006;
const STATE_TOL = 0.0015;
const RACE_TOL = 0.002;
const MAX_EVALS = 7;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Per-state dials and the secant slopes the solver has learned for them. */
class StateSolver {
  readonly logR: Float64Array;
  readonly logQ: Float64Array;
  /** d(state gap)/d(logR) and d(lf ratio)/d(logQ), learned by secant updates */
  private slopeU: Float64Array;
  private slopeL: Float64Array;
  private prevR: Float64Array;
  private prevQ: Float64Array;
  private prevEU: Float64Array;
  private prevEL: Float64Array;
  readonly eU: Float64Array;
  readonly eL: Float64Array;
  readonly measure: StateMeasure;
  /** twin labor force per state at the start, and its all-state total */
  lf0: Float64Array;
  lfAll0 = 0;
  /** labor force shares at the start, for weighting errors and normalizing dials */
  share: Float64Array;

  constructor(readonly map: StateMap) {
    const n = map.n;
    this.logR = new Float64Array(n);
    this.logQ = new Float64Array(n);
    this.slopeU = new Float64Array(n).fill(-0.35);
    this.slopeL = new Float64Array(n).fill(0.5);
    this.prevR = new Float64Array(n);
    this.prevQ = new Float64Array(n);
    this.prevEU = new Float64Array(n).fill(NaN);
    this.prevEL = new Float64Array(n).fill(NaN);
    this.eU = new Float64Array(n);
    this.eL = new Float64Array(n);
    this.measure = newStateMeasure(n);
    this.lf0 = new Float64Array(n);
    this.share = new Float64Array(n);
  }

  calibrate(world: World) {
    measureStates(world, this.map, this.measure);
    this.lf0 = this.measure.laborForce.slice();
    this.lfAll0 = this.lf0.reduce((a, b) => a + b, 0);
    this.share = this.lf0.map((x) => x / this.lfAll0);
  }

  /** Errors of the trial month against the frame; returns the weighted mean absolute gap error. */
  evaluate(world: World, frame: ReleaseFrame): number {
    const m = measureStates(world, this.map, this.measure);
    let un = 0;
    let lf = 0;
    for (let s = 0; s < this.map.n; s++) {
      un += m.unemployed[s];
      lf += m.laborForce[s];
    }
    const uAll = un / lf;
    const ratioAll = lf / this.lfAll0;
    let err = 0;
    for (let s = 0; s < this.map.n; s++) {
      const u = m.laborForce[s] > 0 ? m.unemployed[s] / m.laborForce[s] : uAll;
      this.eU[s] = u - uAll - frame.stateGap![s];
      this.eL[s] = m.laborForce[s] / this.lf0[s] / ratioAll - frame.stateLfRatio![s];
      err += this.share[s] * Math.abs(this.eU[s]);
    }
    return err;
  }

  newMonth() {
    this.prevEU.fill(NaN);
    this.prevEL.fill(NaN);
  }

  /** One secant step per state from the latest errors, then re-center the dials. */
  update(): boolean {
    let moved = false;
    for (let s = 0; s < this.map.n; s++) {
      // learn the local slope from the last two trials of this month
      if (!Number.isNaN(this.prevEU[s]) && Math.abs(this.logR[s] - this.prevR[s]) > 1e-4) {
        const k = (this.eU[s] - this.prevEU[s]) / (this.logR[s] - this.prevR[s]);
        if (k < -0.03 && k > -3) this.slopeU[s] = 0.5 * this.slopeU[s] + 0.5 * k;
      }
      if (!Number.isNaN(this.prevEL[s]) && Math.abs(this.logQ[s] - this.prevQ[s]) > 1e-5) {
        const k = (this.eL[s] - this.prevEL[s]) / (this.logQ[s] - this.prevQ[s]);
        if (k > 0.05 && k < 3) this.slopeL[s] = 0.5 * this.slopeL[s] + 0.5 * k;
      }
      this.prevR[s] = this.logR[s];
      this.prevQ[s] = this.logQ[s];
      this.prevEU[s] = this.eU[s];
      this.prevEL[s] = this.eL[s];
      const dR = clamp(-this.eU[s] / this.slopeU[s], -0.25, 0.25);
      const dQ = clamp(-this.eL[s] / this.slopeL[s], -0.02, 0.02);
      if (Math.abs(this.eU[s]) > 0.0005 && Math.abs(dR) > 1e-4) {
        this.logR[s] = clamp(this.logR[s] + dR, BOUNDS.logR[0], BOUNDS.logR[1]);
        moved = true;
      }
      if (Math.abs(this.eL[s]) > 0.0005 && Math.abs(dQ) > 1e-5) {
        this.logQ[s] = clamp(this.logQ[s] + dQ, BOUNDS.logQ[0], BOUNDS.logQ[1]);
        moved = true;
      }
    }
    // the national dials carry the aggregate; state dials only carry differences
    let mr = 0;
    let mq = 0;
    for (let s = 0; s < this.map.n; s++) {
      mr += this.share[s] * this.logR[s];
      mq += this.share[s] * this.logQ[s];
    }
    for (let s = 0; s < this.map.n; s++) {
      this.logR[s] -= mr;
      this.logQ[s] -= mq;
    }
    return moved;
  }
}

/**
 * Who bears unemployment. One incidence dial per race group (relative to
 * non-Hispanic white) scales the chance of losing a job and divides the
 * chance of finding one, solved so each group's unemployment gap to the
 * national rate matches CPS. The dials are re-scaled so the labor-force
 * average multiplier stays 1, so the national dials keep their meaning.
 */
class RaceSolver {
  /** log dials relative to non-Hispanic white */
  readonly x = new Float64Array(5);
  /** applied multipliers, normalized */
  readonly risk = new Float64Array(5).fill(1);
  readonly e = new Float64Array(5);
  private slope = new Float64Array(5).fill(0.08);
  private prevX = new Float64Array(5);
  private prevE = new Float64Array(5).fill(NaN);
  private un = new Float64Array(5);
  private lf = new Float64Array(5);
  /** labor force shares by group at the start */
  share = new Float64Array(5).fill(0.2);

  measure(w: World) {
    this.un.fill(0);
    this.lf.fill(0);
    for (let c = 0; c < w.nc; c++) {
      const wt = w.weight[c];
      for (let i = w.countyStart[c]; i < w.countyStart[c + 1]; i++) {
        const st = w.status[i];
        if (st === STATUS.EMPLOYED) this.lf[w.race[i]] += wt;
        else if (st === STATUS.UNEMPLOYED) {
          this.lf[w.race[i]] += wt;
          this.un[w.race[i]] += wt;
        }
      }
    }
  }

  calibrate(w: World) {
    this.measure(w);
    const tot = this.lf.reduce((a, b) => a + b, 0);
    this.share = this.lf.map((x) => x / tot);
  }

  /** Twin unemployment rate per group, from the last measure(). */
  rates(): Float64Array {
    return this.un.map((u, g) => (this.lf[g] > 0 ? u / this.lf[g] : 0));
  }

  /** Errors against the frame; returns the share-weighted mean absolute gap error over targeted groups. */
  evaluate(w: World, frame: ReleaseFrame): number {
    this.measure(w);
    const uAll = this.un.reduce((a, b) => a + b, 0) / this.lf.reduce((a, b) => a + b, 0);
    let err = 0;
    let wsum = 0;
    for (const t of RACE_TARGETS) {
      const g = t.race;
      const u = this.lf[g] > 0 ? this.un[g] / this.lf[g] : uAll;
      this.e[g] = u - uAll - frame.raceGap![g];
      err += this.share[g] * Math.abs(this.e[g]);
      wsum += this.share[g];
    }
    // initial slope guess: a group's rate moves about 2u per log point of risk
    for (const t of RACE_TARGETS) if (Number.isNaN(this.prevE[t.race])) this.slope[t.race] = Math.max(this.slope[t.race], 1.5 * uAll);
    return err / (wsum || 1);
  }

  newMonth() {
    this.prevE.fill(NaN);
  }

  update(): boolean {
    let moved = false;
    for (const t of RACE_TARGETS) {
      const g = t.race;
      if (!Number.isNaN(this.prevE[g]) && Math.abs(this.x[g] - this.prevX[g]) > 1e-4) {
        const k = (this.e[g] - this.prevE[g]) / (this.x[g] - this.prevX[g]);
        if (k > 0.01 && k < 2) this.slope[g] = 0.5 * this.slope[g] + 0.5 * k;
      }
      this.prevX[g] = this.x[g];
      this.prevE[g] = this.e[g];
      const dx = clamp(-this.e[g] / this.slope[g], -0.3, 0.3);
      if (Math.abs(this.e[g]) > 0.0005 && Math.abs(dx) > 1e-4) {
        this.x[g] = clamp(this.x[g] + dx, -1.5, 1.5);
        moved = true;
      }
    }
    this.apply();
    return moved;
  }

  apply() {
    let m = 0;
    for (let g = 0; g < 5; g++) m += this.share[g] * Math.exp(this.x[g]);
    for (let g = 0; g < 5; g++) this.risk[g] = Math.exp(this.x[g]) / m;
  }
}

export class Assimilator {
  logA = 0;
  P = 1;
  /** Jacobian of [u, lfRatio] w.r.t. [logA, P], refined by Broyden updates */
  private J = [
    [-0.5, 0.6],
    [0, 0.6],
  ];
  private trial: World | null = null;
  lf0 = 0;
  readonly states: StateSolver | null;
  readonly race = new RaceSolver();

  constructor(
    private engine: Engine,
    stateMap: StateMap | null = null,
  ) {
    this.states = stateMap ? new StateSolver(stateMap) : null;
  }

  /** State demand dials (log), or null when the twin runs without state data. */
  get stateLogR(): Float64Array | null {
    return this.states?.logR ?? null;
  }

  get stateLogQ(): Float64Array | null {
    return this.states?.logQ ?? null;
  }

  /** Applied race-incidence multipliers (meta.races order). */
  get raceRisk(): Float64Array {
    return this.race.risk;
  }

  /** Record the start-of-history state labor forces the dials are measured against. */
  calibrate(world: World, laborForce: number) {
    this.lf0 = laborForce;
    this.states?.calibrate(world);
  }

  /** Measure race labor-force shares before the spin-up starts moving the race dials. */
  calibrateRace(world: World) {
    this.race.calibrate(world);
  }

  /**
   * One step of the race dials during the spin-up, so the start-of-history
   * labor market already carries the race gaps of the first release.
   */
  spinupRace(world: World, frame: ReleaseFrame) {
    if (!frame.raceGap) return;
    this.race.evaluate(world, frame);
    this.race.update();
  }

  /**
   * Run month t so it reproduces the frame. `run(world)` must perform the
   * engine step with the dials taken from this assimilator (logA, P and the
   * state dials).
   */
  step(world: World, frame: ReleaseFrame, run: (w: World) => MonthStats): AssimilationResult {
    void this.engine;
    const target = [frame.unrate, frame.laborForceRatio];
    const trial = (this.trial ??= world.clone());
    const st = frame.stateGap && frame.stateLfRatio ? this.states : null;
    st?.newMonth();
    const rc = frame.raceGap ? this.race : null;
    rc?.newMonth();
    let x = [this.logA, this.P];
    type Best = { x: number[]; stats: MonthStats; err: number; F: number[]; sErr: number | null; logR?: Float64Array; logQ?: Float64Array; raceX?: Float64Array; at: number };
    let best: Best | null = null;
    let evaluations = 0;
    let sErr = 0;
    let rErr = 0;
    const evalAt = (xx: number[]) => {
      trial.copyDynamicFrom(world);
      this.logA = xx[0];
      this.P = xx[1];
      const stats = run(trial);
      evaluations++;
      const F = [
        target[0] == null ? 0 : stats.unemploymentRate - target[0],
        target[1] == null ? 0 : stats.laborForce / this.lf0 - target[1],
      ];
      sErr = st ? st.evaluate(trial, frame) : 0;
      rErr = rc ? rc.evaluate(trial, frame) : 0;
      const err = Math.abs(F[0]) + Math.abs(F[1]) + 0.5 * sErr + 0.25 * rErr;
      if (!best || err < best.err) {
        best = { x: xx.slice(), stats, err, F, sErr: st ? sErr : null, logR: st?.logR.slice(), logQ: st?.logQ.slice(), raceX: rc?.x.slice(), at: evaluations };
      }
      return F;
    };
    const unsolved = (F: number[]) => Math.abs(F[0]) + Math.abs(F[1]) > TOL || (st != null && sErr > STATE_TOL) || (rc != null && rErr > RACE_TOL);
    let F = evalAt(x);
    while (evaluations < MAX_EVALS && unsolved(F)) {
      const [[a, b], [c, d]] = this.J;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-9) break;
      let dx = [(d * F[0] - b * F[1]) / det, (-c * F[0] + a * F[1]) / det];
      // damp very large moves
      const m = Math.max(Math.abs(dx[0]) / 0.4, Math.abs(dx[1]) / 0.05, 1);
      dx = [-dx[0] / m, -dx[1] / m];
      const nx = [clamp(x[0] + dx[0], BOUNDS.logA[0], BOUNDS.logA[1]), clamp(x[1] + dx[1], BOUNDS.P[0], BOUNDS.P[1])];
      const step = [nx[0] - x[0], nx[1] - x[1]];
      const stateMoved = st ? st.update() : false;
      const raceMoved = rc ? rc.update() : false;
      const statesMoved = stateMoved || raceMoved;
      const s2 = step[0] * step[0] + step[1] * step[1];
      if (s2 < 1e-14 && !statesMoved) break;
      const nF = evalAt(nx);
      if (s2 >= 1e-14) {
        // Broyden rank-one update
        const dF = [nF[0] - F[0], nF[1] - F[1]];
        for (let r = 0; r < 2; r++) {
          const pred = this.J[r][0] * step[0] + this.J[r][1] * step[1];
          for (let k = 0; k < 2; k++) this.J[r][k] += ((dF[r] - pred) * step[k]) / s2;
        }
        // keep the Jacobian economically signed and away from singular
        this.J[0][0] = Math.min(-0.05, this.J[0][0]);
        this.J[1][1] = Math.max(0.05, this.J[1][1]);
      }
      x = nx;
      F = nF;
    }
    const b = best! as Best;
    if (b.at !== evaluations) {
      // re-run the best point so world ends in exactly that state
      if (st) {
        st.logR.set(b.logR!);
        st.logQ.set(b.logQ!);
      }
      if (rc) {
        rc.x.set(b.raceX!);
        rc.apply();
      }
      evalAt(b.x);
    }
    this.logA = b.x[0];
    this.P = b.x[1];
    world.copyDynamicFrom(trial);
    return { stats: b.stats, logDemand: b.x[0], participation: b.x[1], evaluations, residualU: b.F[0], stateError: b.sErr };
  }
}
