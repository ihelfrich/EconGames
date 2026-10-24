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
 * Nothing about counties is fed in. Where local unemployment goes is the
 * model's own answer, which is what the spatial backtest checks.
 */
import type { Releases, SectorMeta } from './data';
import type { Engine, MonthStats } from './engine';
import { DEFAULT_POLICY, type Policy, World } from './world';

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
}

const BOUNDS = { logA: [-0.9, 0.5], P: [0.85, 1.15] } as const;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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

  constructor(private engine: Engine) {}

  /**
   * Run month t so it reproduces the frame. `run(world)` must perform the
   * engine step with the dials taken from this.logA / this.P.
   */
  step(world: World, frame: ReleaseFrame, run: (w: World) => MonthStats): AssimilationResult {
    void this.engine;
    const target = [frame.unrate, frame.laborForceRatio];
    const trial = (this.trial ??= world.clone());
    let x = [this.logA, this.P];
    let best: { x: number[]; stats: MonthStats; err: number; F: number[] } | null = null;
    let evaluations = 0;
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
      const err = Math.abs(F[0]) + Math.abs(F[1]);
      if (!best || err < best.err) best = { x: xx.slice(), stats, err, F };
      return F;
    };
    let F = evalAt(x);
    for (let it = 0; it < 5 && Math.abs(F[0]) + Math.abs(F[1]) > 0.0006; it++) {
      const [[a, b], [c, d]] = this.J;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-9) break;
      let dx = [(d * F[0] - b * F[1]) / det, (-c * F[0] + a * F[1]) / det];
      // damp very large moves
      const m = Math.max(Math.abs(dx[0]) / 0.4, Math.abs(dx[1]) / 0.05, 1);
      dx = [-dx[0] / m, -dx[1] / m];
      const nx = [clamp(x[0] + dx[0], BOUNDS.logA[0], BOUNDS.logA[1]), clamp(x[1] + dx[1], BOUNDS.P[0], BOUNDS.P[1])];
      const step = [nx[0] - x[0], nx[1] - x[1]];
      if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-7) break;
      const nF = evalAt(nx);
      // Broyden rank-one update
      const dF = [nF[0] - F[0], nF[1] - F[1]];
      const s2 = step[0] * step[0] + step[1] * step[1];
      for (let r = 0; r < 2; r++) {
        const pred = this.J[r][0] * step[0] + this.J[r][1] * step[1];
        for (let k = 0; k < 2; k++) this.J[r][k] += ((dF[r] - pred) * step[k]) / s2;
      }
      // keep the Jacobian economically signed and away from singular
      this.J[0][0] = Math.min(-0.05, this.J[0][0]);
      this.J[1][1] = Math.max(0.05, this.J[1][1]);
      x = nx;
      F = nF;
    }
    const b = best!;
    // re-run the best point so world ends in exactly that state
    if (b.x[0] !== x[0] || b.x[1] !== x[1] || evaluations === 0) evalAt(b.x);
    else {
      this.logA = b.x[0];
      this.P = b.x[1];
    }
    world.copyDynamicFrom(trial);
    return { stats: b.stats, logDemand: b.x[0], participation: b.x[1], evaluations, residualU: b.F[0] };
  }
}
