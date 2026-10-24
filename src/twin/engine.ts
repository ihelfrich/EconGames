/**
 * The twin's engine: a month-by-month agent-based labor market.
 *
 * A step runs an ordered list of mechanisms over the synthetic population.
 * Each mechanism is a small, self-contained piece of economics with its own
 * parameters, so research models can be swapped in one at a time (see
 * docs/TWIN.md, "Adding a mechanism").
 *
 * Randomness uses counter-based draws: uniform(person, slot) depends only on
 * the seed, the month and the person, never on the order of earlier draws.
 * Two runs that differ only in a driver (say, demand) therefore see the same
 * luck, which makes assimilation smooth and what-if comparisons clean
 * ("common random numbers").
 */
import type { CountyData } from './data';
import { EDU_PAY_PREMIUM } from './population';
import { cumulative, hashSeed } from './rng';
import { DEFAULT_POLICY, NO_SECTOR, STATUS, World, type Drivers } from './world';

export interface StepContext {
  world: World;
  data: CountyData;
  drivers: Drivers;
  /** true during spin-up: the calendar is frozen (no aging or deaths) */
  spinup: boolean;
  /** stream key for this month; draw with uniform(key, person, slot) */
  key: number;
  // scratch shared between mechanisms, sized nc*ns or nc
  employedCS: Float64Array;
  targetCS: Float64Array;
  exits: Float64Array;
  hires: number;
  separations: number;
}

export interface Mechanism {
  id: string;
  label: string;
  /** one line for the UI and docs */
  summary: string;
  step(ctx: StepContext): void;
}

export interface MonthStats {
  t: number;
  label: string;
  unemploymentRate: number;
  laborForce: number;
  employed: number;
  unemployed: number;
  participationRate: number;
  meanDurationWeeks: number;
  longTermShare: number;
  hires: number;
  separations: number;
  sectorEmployment: Float64Array;
  countyU: Float32Array;
  countyLF: Float32Array;
  avgWage: number;
}

// Module-local copies: hot loops should not go through an import binding.
const CHILD = STATUS.CHILD;
const EMPLOYED = STATUS.EMPLOYED;
const UNEMPLOYED = STATUS.UNEMPLOYED;
const NILF = STATUS.NILF;

// ---------------------------------------------------------------- parameters

/**
 * Behavioral parameters. Plain numbers so experiments, the UI and research
 * mechanisms can read or override them.
 */
export const PARAMS = {
  /** monthly separation rates into unemployment, by twin sector (meta.sectors order) */
  separation: [0.022, 0.026, 0.013, 0.02, 0.015, 0.012, 0.022, 0.012, 0.034, 0.02, 0.008],
  /** share of a county-sector's excess employment shed per month */
  layoffSpeed: 0.55,
  /** openings posted per job firms want to fill */
  vacancyRatio: 2,
  /** openings that exist even at full staffing, share of target employment */
  frictionalOpenings: 0.005,
  /** share of the gap to the target labor force closed per month */
  participationSpeed: 0.6,
  /** matching elasticity w.r.t. unemployment */
  alpha: 0.5,
  /** search effort falls as 1 / (1 + durationDecay * months unemployed) */
  durationDecay: 0.15,
  /** relative job-finding by education (<HS, HS, some college, BA+) */
  eduEmployability: [0.6, 0.85, 1, 1.3],
  /** monthly exit from unemployment to out of the labor force; extra after 12 months */
  discouragement: 0.012,
  discouragementLong: 0.02,
  /** pay cut on re-employment after 24+ months unemployed */
  scarring: 0.15,
};

/** monthly Gompertz mortality at life expectancy 78.7, by age */
const MORTALITY = Float64Array.from({ length: 112 }, (_, a) => Math.min(1, Math.exp(-10 + 0.09 * a)) / 12);

function retirementHazard(age: number): number {
  if (age < 55) return 0;
  if (age < 62) return 0.0025;
  if (age < 65) return 0.01;
  if (age < 70) return 0.015;
  return 0.02;
}

// ---------------------------------------------------------------- mechanisms

export const Demography: Mechanism = {
  id: 'demography',
  label: 'Demography',
  summary: 'People age on their birthday, retire with age-specific hazards, and die at Gompertz rates shifted by county life expectancy; each death is replaced by a newborn in the same county.',
  step(ctx) {
    const { world: w, data } = ctx;
    const cal = (w.startMonth + w.t) % 12;
    for (let c = 0; c < w.nc; c++) {
      const le = data.lifeExp[c] ?? 78.7;
      const mortShift = Math.exp(-0.09 * (le - 78.7));
      let eduCdf: Float64Array | null = null;
      let raceCdf: Float64Array | null = null;
      for (let i = w.countyStart[c]; i < w.countyStart[c + 1]; i++) {
        const a = w.age[i];
        if (!ctx.spinup) {
          if (w.birthMonth[i] === cal) {
            const na = Math.min(110, a + 1);
            w.age[i] = na;
            if (na === 16) {
              w.status[i] = NILF;
              w.edu[i] = 0;
            } else if (na === 18) {
              eduCdf ??= cumulative(data.edu[c]);
              const e = pickEdu(eduCdf, uniform(ctx.key, i, 6));
              w.edu[i] = e;
              w.prod[i] *= EDU_PAY_PREMIUM[e] / EDU_PAY_PREMIUM[1];
            }
          }
          if (uniform(ctx.key, i, 0) < MORTALITY[a] * mortShift) {
            if (w.status[i] === EMPLOYED || w.status[i] === UNEMPLOYED) ctx.exits[c]++;
            raceCdf ??= cumulative(data.race[c]);
            rebirth(w, i, raceCdf, uniform(ctx.key, i, 1), uniform(ctx.key, i, 7));
            continue;
          }
        }
        const st = w.status[i];
        if ((st === EMPLOYED || st === UNEMPLOYED) && uniform(ctx.key, i, 1) < retirementHazard(a)) {
          w.status[i] = NILF;
          w.dur[i] = 0;
          ctx.exits[c]++;
        }
      }
    }
  },
};

function pickEdu(cdf: Float64Array, u: number): number {
  const t = u * cdf[cdf.length - 1];
  for (let k = 0; k < cdf.length; k++) if (cdf[k] > t) return k;
  return cdf.length - 1;
}

function rebirth(w: World, i: number, raceCdf: Float64Array, u1: number, u2: number): void {
  w.age[i] = 0;
  w.sex[i] = u2 < 0.512 ? 0 : 1;
  w.race[i] = pickEdu(raceCdf, u1);
  w.edu[i] = 255;
  w.status[i] = CHILD;
  w.sector[i] = NO_SECTOR;
  w.wage[i] = 0;
  w.dur[i] = 0;
  w.tenure[i] = 0;
  w.health[i] = 0;
  w.vote[i] = 0;
}

export const LaborDemand: Mechanism = {
  id: 'labor-demand',
  label: 'Labor demand & separations',
  summary: 'Each county-sector wants L0 x aggregate demand x sector mix x regional shock workers. Jobs end at sector-specific rates, plus layoffs that close part of any excess of workers over demand.',
  step(ctx) {
    const { world: w, drivers: d } = ctx;
    const ns = w.ns;
    const E = ctx.employedCS;
    E.fill(0);
    for (let i = 0; i < w.n; i++) if (w.status[i] === EMPLOYED) E[w.county[i] * ns + w.sector[i]]++;
    const layoff = new Float64Array(w.nc * ns);
    for (let c = 0; c < w.nc; c++) {
      const wt = w.weight[c];
      for (let s = 0; s < ns; s++) {
        const k = c * ns + s;
        const target = (w.L0[k] / wt) * d.demand * d.sector[s] * d.regional[c];
        ctx.targetCS[k] = target;
        const excess = E[k] > 0 ? Math.max(0, (E[k] - target) / E[k]) : 0;
        layoff[k] = Math.min(0.95, PARAMS.separation[s] + PARAMS.layoffSpeed * excess);
      }
    }
    for (let i = 0; i < w.n; i++) {
      if (w.status[i] !== EMPLOYED) continue;
      const k = w.county[i] * ns + w.sector[i];
      if (uniform(ctx.key, i, 2) < layoff[k]) {
        w.status[i] = UNEMPLOYED;
        w.dur[i] = 0;
        w.tenure[i] = 0;
        E[k]--;
        ctx.separations += w.weight[w.county[i]];
      }
    }
  },
};

export const Matching: Mechanism = {
  id: 'matching',
  label: 'Search & matching',
  summary: 'Each county is a local labor market. Hires follow a Cobb-Douglas matching function M = mu U^a V^(1-a); search effort falls with unemployment duration and while on UI; workers prefer openings in their previous sector.',
  step(ctx) {
    const { world: w, drivers: d } = ctx;
    const ns = w.ns;
    const pol = d.policy ?? DEFAULT_POLICY;
    const vac = new Float64Array(ns);
    for (let c = 0; c < w.nc; c++) {
      const a = w.countyStart[c];
      const b = w.countyStart[c + 1];
      // vac[s] = jobs firms want to fill; they post more openings than that
      // (vacancyRatio) because each opening only fills with some probability
      let gap = 0;
      let target = 0;
      for (let s = 0; s < ns; s++) {
        const k = c * ns + s;
        vac[s] = Math.max(0, ctx.targetCS[k] - ctx.employedCS[k]);
        gap += vac[s];
        target += ctx.targetCS[k];
      }
      const V = PARAMS.vacancyRatio * gap + PARAMS.frictionalOpenings * target;
      let U = 0;
      let effort = 0;
      for (let i = a; i < b; i++) {
        if (w.status[i] !== UNEMPLOYED) continue;
        U++;
        effort += searchEffort(w.dur[i], w.edu[i], pol);
      }
      if (U === 0 || gap <= 0) continue;
      const M = Math.min(0.9 * U, gap, w.mu[c] * pol.matchBoost * Math.pow(U, PARAMS.alpha) * Math.pow(V, 1 - PARAMS.alpha));
      const scale = M / effort;
      const wt = w.weight[c];
      for (let i = a; i < b; i++) {
        if (w.status[i] !== UNEMPLOYED) continue;
        if (uniform(ctx.key, i, 3) >= scale * searchEffort(w.dur[i], w.edu[i], pol)) continue;
        // choose an opening, favoring the worker's previous sector
        const prev = w.sector[i];
        let tot = 0;
        for (let s = 0; s < ns; s++) tot += vac[s] * (s === prev ? 3 : 1);
        if (tot <= 0) break;
        let r = uniform(ctx.key, i, 4) * tot;
        let s = 0;
        for (; s < ns - 1; s++) {
          r -= vac[s] * (s === prev ? 3 : 1);
          if (r < 0) break;
        }
        vac[s] = Math.max(0, vac[s] - 1);
        const k = c * ns + s;
        w.status[i] = EMPLOYED;
        w.sector[i] = s;
        const scar = 1 - (PARAMS.scarring * Math.min(24, w.dur[i])) / 24;
        w.wage[i] = (w.sectorWage[k] * w.prod[i] * scar) / w.prodRef[k];
        w.dur[i] = 0;
        w.tenure[i] = 0;
        ctx.employedCS[k]++;
        ctx.hires += wt;
      }
    }
  },
};

export function searchEffort(dur: number, edu: number, pol: { uiMonths: number; uiSearchPenalty: number }): number {
  const onUi = dur < pol.uiMonths ? 1 - pol.uiSearchPenalty : 1;
  return (onUi * (PARAMS.eduEmployability[edu] ?? 1)) / (1 + PARAMS.durationDecay * dur);
}

export const Participation: Mechanism = {
  id: 'participation',
  label: 'Labor force participation',
  summary: 'Job seekers drift out of the labor force, faster after a year of searching. Each county closes part of the gap to its target labor force every month: re-entrants (mostly young) when short, extra exits of job seekers when over. The participation dial moves every target.',
  step(ctx) {
    const { world: w, drivers: d } = ctx;
    const P = d.participation;
    const lfr = d.lfRegional;
    for (let c = 0; c < w.nc; c++) {
      const a = w.countyStart[c];
      const b = w.countyStart[c + 1];
      let eligibleW = 0;
      let lf = 0;
      let unemployed = 0;
      for (let i = a; i < b; i++) {
        const st = w.status[i];
        if (st === UNEMPLOYED) {
          const x = PARAMS.discouragement + (w.dur[i] >= 12 ? PARAMS.discouragementLong : 0);
          if (uniform(ctx.key, i, 5) < x) {
            w.status[i] = NILF;
            w.dur[i] = 0;
            ctx.exits[c]++;
          } else {
            lf++;
            unemployed++;
            continue;
          }
        } else if (st === EMPLOYED) {
          lf++;
          continue;
        }
        if (w.status[i] === NILF && w.age[i] < 65) eligibleW += w.age[i] < 25 ? 3 : 1;
      }
      const gap = (w.lf0[c] / w.weight[c]) * P * (lfr ? lfr[c] : 1) - lf;
      if (gap > 0 && eligibleW > 0) {
        const base = (PARAMS.participationSpeed * gap) / eligibleW;
        for (let i = a; i < b; i++) {
          if (w.status[i] !== NILF || w.age[i] >= 65) continue;
          if (uniform(ctx.key, i, 8) < base * (w.age[i] < 25 ? 3 : 1)) {
            w.status[i] = UNEMPLOYED;
            w.dur[i] = 0;
          }
        }
      } else if (gap < 0 && unemployed > 0) {
        const p = Math.min(0.9, (PARAMS.participationSpeed * -gap) / unemployed);
        for (let i = a; i < b; i++) {
          if (w.status[i] === UNEMPLOYED && uniform(ctx.key, i, 8) < p) {
            w.status[i] = NILF;
            w.dur[i] = 0;
          }
        }
      }
    }
  },
};

export const DEFAULT_MECHANISMS: Mechanism[] = [Demography, LaborDemand, Matching, Participation];

// ---------------------------------------------------------------- engine

export class Engine {
  readonly data: CountyData;
  mechanisms: Mechanism[];
  private employedCS: Float64Array;
  private targetCS: Float64Array;
  private exits: Float64Array;

  constructor(data: CountyData, mechanisms: Mechanism[] = DEFAULT_MECHANISMS) {
    this.data = data;
    this.mechanisms = mechanisms;
    const nc = data.fips.length;
    const ns = data.meta.sectors.length;
    this.employedCS = new Float64Array(nc * ns);
    this.targetCS = new Float64Array(nc * ns);
    this.exits = new Float64Array(nc);
  }

  /** Advance the world one month under the given drivers. */
  step(world: World, drivers: Drivers, opts: { spinup?: boolean; streamOffset?: number } = {}): MonthStats {
    const key = hashSeed(world.seed, world.t + 7919 * (opts.streamOffset ?? 0));
    this.exits.fill(0);
    const ctx: StepContext = {
      world,
      data: this.data,
      drivers,
      spinup: !!opts.spinup,
      key,
      employedCS: this.employedCS,
      targetCS: this.targetCS,
      exits: this.exits,
      hires: 0,
      separations: 0,
    };
    for (const m of this.mechanisms) m.step(ctx);
    // clocks
    for (let i = 0; i < world.n; i++) {
      const st = world.status[i];
      if (st === UNEMPLOYED) world.dur[i] = Math.min(65535, world.dur[i] + 1);
      else if (st === EMPLOYED) world.tenure[i] = Math.min(65535, world.tenure[i] + 1);
    }
    if (!opts.spinup) world.t++;
    return measure(world, ctx.hires, ctx.separations);
  }

  /**
   * Spin-up: run the labor market with the calendar frozen and nudge each
   * county's matching efficiency until its unemployment rate settles at the
   * BLS target. Mirrors how climate models are spun up before a forecast.
   */
  spinup(world: World, drivers: Drivers, months = 36): MonthStats {
    // analytic first guess from the steady state u = s / (s + f)
    for (let c = 0; c < world.nc; c++) {
      const u = world.uTarget[c];
      const f = (0.02 * (1 - u)) / u;
      world.mu[c] = Math.pow(f, PARAMS.alpha);
    }
    let stats = measure(world, 0, 0);
    for (let m = 0; m < months; m++) {
      stats = this.step(world, drivers, { spinup: true, streamOffset: 1000 + m });
      const gain = m < months - 6 ? 0.6 : 0.25;
      for (let c = 0; c < world.nc; c++) {
        const u = stats.countyU[c];
        const target = world.uTarget[c];
        const ratio = Math.min(3, Math.max(1 / 3, (u + 0.004) / (target + 0.004)));
        world.mu[c] = Math.min(6, Math.max(0.02, world.mu[c] * Math.pow(ratio, gain)));
      }
    }
    return stats;
  }
}

/**
 * Counter-based uniform draw in [0,1): a 32-bit hash (murmur3 finalizer) of
 * the month's key, the person and a slot (0..15). Each mechanism uses its own
 * slots, so draws never collide.
 */
export function uniform(key: number, i: number, slot: number): number {
  let h = Math.imul((i << 4) | slot, 0x9e3779b1) ^ key;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function measure(world: World, hires: number, separations: number): MonthStats {
  const nc = world.nc;
  const countyU = new Float32Array(nc);
  const countyLF = new Float32Array(nc);
  const sectorEmployment = new Float64Array(world.ns);
  let E = 0;
  let U = 0;
  let N = 0;
  let durSum = 0;
  let longTerm = 0;
  let wageSum = 0;
  for (let c = 0; c < nc; c++) {
    const wt = world.weight[c];
    let e = 0;
    let u = 0;
    let n = 0;
    for (let i = world.countyStart[c]; i < world.countyStart[c + 1]; i++) {
      const st = world.status[i];
      if (st === EMPLOYED) {
        e++;
        sectorEmployment[world.sector[i]] += wt;
        wageSum += world.wage[i] * wt;
      } else if (st === UNEMPLOYED) {
        u++;
        durSum += world.dur[i] * wt;
        if (world.dur[i] >= 6) longTerm += wt;
      } else if (st === NILF) n++;
    }
    countyU[c] = e + u > 0 ? u / (e + u) : 0;
    countyLF[c] = (e + u) * wt;
    E += e * wt;
    U += u * wt;
    N += n * wt;
  }
  return {
    t: world.t,
    label: world.label(),
    unemploymentRate: U / (E + U),
    laborForce: E + U,
    employed: E,
    unemployed: U,
    participationRate: (E + U) / (E + U + N),
    // spells in progress are counted at the start of their month, +0.5 month for midpoint
    meanDurationWeeks: U > 0 ? (durSum / U + 0.5) * 4.345 : 0,
    longTermShare: U > 0 ? longTerm / U : 0,
    hires,
    separations,
    sectorEmployment,
    countyU,
    countyLF,
    avgWage: E > 0 ? wageSum / E : 0,
  };
}
