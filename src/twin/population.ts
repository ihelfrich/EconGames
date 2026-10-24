/**
 * Synthetic population: draws people for every county so that the county's
 * real marginals (age, sex, race, education, labor force, unemployment, jobs
 * by sector, pay by sector, health, votes) are reproduced, while joint
 * structure the county files do not carry (education vs. pay, age vs.
 * participation, education vs. industry...) comes from national patterns.
 *
 * Where a county total must be hit exactly in expectation, person-level
 * probabilities are raked: a county-specific shift on the log-odds scale is
 * solved by bisection so the county's expected count equals its target.
 */
import type { CountyData } from './data';
import { Rng, cumulative } from './rng';
import { HEALTH, NO_SECTOR, STATUS, VOTE, World } from './world';

export interface PopulationOptions {
  /** real people per synthetic person (before the per-county minimum) */
  scale: number;
  /** every county gets at least this many people, so small places still have a labor market */
  minPerCounty: number;
  seed: number;
  /** index into meta.laborYears used to calibrate the labor market (3 = 2016) */
  laborYearIndex: number;
}

export const DEFAULT_POPULATION: PopulationOptions = {
  scale: 1000,
  minPerCounty: 80,
  seed: 20160101,
  laborYearIndex: 3,
};

const AGE_LO = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];

// National patterns (CPS-style orders of magnitude) that shape the joint
// distribution. County totals are raked on top of these.
function baseParticipation(age: number): number {
  if (age < 16) return 0;
  if (age < 20) return 0.35;
  if (age < 25) return 0.71;
  if (age < 55) return 0.82;
  if (age < 62) return 0.7;
  if (age < 65) return 0.5;
  if (age < 70) return 0.32;
  if (age < 75) return 0.19;
  return 0.07;
}
const PART_EDU_ODDS = [0.6, 0.9, 1.0, 1.5];
const PART_FEMALE_ODDS = 0.75;

function baseUnemployment(age: number): number {
  if (age < 20) return 0.16;
  if (age < 25) return 0.085;
  if (age < 55) return 0.042;
  return 0.035;
}
const UNEMP_EDU_ODDS = [1.9, 1.25, 1.0, 0.55];

/** education x sector affinity (odds), rows <HS, HS, some college, BA+; columns follow meta.sectors */
export const SECTOR_EDU_AFFINITY = [
  [2.0, 2.0, 1.3, 1.1, 0.3, 0.3, 0.8, 0.5, 2.2, 1.2, 0.4],
  [1.3, 1.5, 1.4, 1.3, 0.6, 0.7, 0.8, 0.8, 1.3, 1.1, 0.8],
  [0.8, 0.9, 0.9, 1.0, 1.0, 1.0, 0.9, 1.1, 1.0, 1.0, 1.0],
  [0.5, 0.35, 0.6, 0.6, 1.8, 1.7, 1.4, 1.4, 0.5, 0.8, 1.4],
];
export const EDU_PAY_PREMIUM = [0.72, 0.88, 1.0, 1.55];

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Solve for k so that mean(sigmoid(base + k)) over items = target. */
export function rake(base: Float64Array, count: number, target: number): number {
  if (count === 0) return 0;
  const t = Math.min(0.999, Math.max(0.001, target));
  let lo = -12;
  let hi = 12;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    let s = 0;
    for (let i = 0; i < count; i++) s += sigmoid(base[i] + mid);
    if (s / count > t) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Iterative proportional fitting of an edu x sector table to row and column totals. */
function fitSectorTable(rowTotals: number[], colShares: number[], ns: number): number[][] {
  const total = rowTotals.reduce((a, b) => a + b, 0);
  const cols = colShares.map((s) => s * total);
  const m = rowTotals.map((_, e) => colShares.map((s, j) => s * SECTOR_EDU_AFFINITY[e][j] + 1e-9));
  for (let it = 0; it < 12; it++) {
    for (let e = 0; e < m.length; e++) {
      const r = m[e].reduce((a, b) => a + b, 0);
      for (let j = 0; j < ns; j++) m[e][j] *= r > 0 ? rowTotals[e] / r : 0;
    }
    for (let j = 0; j < ns; j++) {
      let c = 0;
      for (let e = 0; e < m.length; e++) c += m[e][j];
      for (let e = 0; e < m.length; e++) m[e][j] *= c > 0 ? cols[j] / c : 0;
    }
  }
  return m;
}

export function synthesize(data: CountyData, opts: PopulationOptions = DEFAULT_POPULATION): World {
  const nc = data.fips.length;
  const ns = data.meta.sectors.length;
  const yi = opts.laborYearIndex;
  const sizes = data.pop.map((p) => Math.max(opts.minPerCounty, Math.round(p / opts.scale)));
  const n = sizes.reduce((a, b) => a + b, 0);
  const world = new World(n, nc, ns, opts.seed);
  world.startYear = data.meta.laborYears[yi];
  const rng = new Rng(opts.seed);

  // national fallbacks
  let natLf = 0;
  let natUn = 0;
  let natPop16 = 0;
  for (let c = 0; c < nc; c++) {
    const lf = data.lf[c][yi];
    const un = data.unemp[c][yi];
    if (lf && un != null) {
      natLf += lf;
      natUn += un;
      natPop16 += data.pop[c] * share16plus(data.age[c]);
    }
  }
  const natPart = natLf / natPop16;
  const natU = natUn / natLf;
  const natJobs = new Array(ns).fill(0);
  for (let c = 0; c < nc; c++) for (let j = 0; j < ns; j++) natJobs[j] += data.jobs[c][j];

  const scratch = new Float64Array(Math.max(...sizes));
  let row = 0;
  for (let c = 0; c < nc; c++) {
    const size = sizes[c];
    const start = row;
    world.countyStart[c] = start;
    world.weight[c] = data.pop[c] / size;
    const ageCdf = cumulative(data.age[c]);
    const raceCdf = cumulative(data.race[c]);
    const eduCdf = cumulative(data.edu[c]);
    const [obese, smoke, poor, unins] = data.health[c].map((v, k) => v ?? [0.32, 0.17, 0.18, 0.1][k]);
    const votes = data.vote2024[c] ?? data.vote2020[c];

    // demographics
    for (let k = 0; k < size; k++) {
      const i = row + k;
      world.county[i] = c;
      world.sex[i] = rng.next() < data.male[c] ? 0 : 1;
      const bin = rng.pickCdf(ageCdf);
      const age = bin === 17 ? Math.min(100, 85 + Math.floor(-Math.log(1 - rng.next()) * 5)) : AGE_LO[bin] + Math.floor(rng.next() * 5);
      world.age[i] = age;
      world.birthMonth[i] = Math.floor(rng.next() * 12);
      world.race[i] = rng.pickCdf(raceCdf);
      world.edu[i] = age >= 18 ? rng.pickCdf(eduCdf) : age >= 16 ? 0 : 255;
      let h = 0;
      if (age >= 18) {
        if (rng.next() < obese) h |= HEALTH.OBESE;
        if (rng.next() < smoke) h |= HEALTH.SMOKER;
        if (rng.next() < poor * (0.45 + age / 70)) h |= HEALTH.POOR_HEALTH;
      }
      if (age < 65 && rng.next() < unins) h |= HEALTH.UNINSURED;
      world.health[i] = h;
      world.status[i] = age >= 16 ? STATUS.NILF : STATUS.CHILD;
      world.sector[i] = NO_SECTOR;
      // productivity: idiosyncratic x education x experience
      const e = world.edu[i] === 255 ? 1 : world.edu[i];
      const x = Math.max(0, age - 18 - (e === 3 ? 4 : e === 2 ? 2 : 0));
      world.prod[i] = Math.exp(0.45 * rng.normal() - 0.101) * EDU_PAY_PREMIUM[e] * Math.exp(0.035 * x - 0.0006 * x * x);
    }

    // votes, raked to county turnout
    if (votes && votes[2] > 0) {
      let adults = 0;
      for (let k = 0; k < size; k++) if (world.age[row + k] >= 18) adults++;
      const turnout = Math.min(0.92, votes[2] / (adults * world.weight[c] || 1));
      const pd = votes[0] / votes[2];
      const pg = votes[1] / votes[2];
      for (let k = 0; k < size; k++) {
        const i = row + k;
        if (world.age[i] < 18 || rng.next() >= turnout) continue;
        const u = rng.next();
        world.vote[i] = u < pd ? VOTE.DEM : u < pd + pg ? VOTE.GOP : VOTE.OTHER;
      }
    }

    // labor force participation, raked to BLS LAUS
    const lf = data.lf[c][yi];
    const un = data.unemp[c][yi];
    let m16 = 0;
    for (let k = 0; k < size; k++) {
      const i = row + k;
      const a = world.age[i];
      if (a < 16) continue;
      const odds = PART_EDU_ODDS[world.edu[i]] * (world.sex[i] ? PART_FEMALE_ODDS : 1);
      scratch[m16++] = logit(baseParticipation(a)) + Math.log(odds);
    }
    const partTarget = lf ? Math.min(0.92, lf / (m16 * world.weight[c])) : natPart;
    const kPart = rake(scratch, m16, partTarget);
    const adults: number[] = [];
    for (let k = 0; k < size; k++) if (world.age[row + k] >= 16) adults.push(row + k);
    const inLf = sampleExactly(adults, (j) => sigmoid(scratch[j] + kPart), Math.round(partTarget * m16), rng);

    // unemployment within the labor force, raked to BLS LAUS
    const uTarget = lf && un != null ? Math.max(0.005, un / lf) : natU;
    world.uTarget[c] = uTarget;
    for (let j = 0; j < inLf.length; j++) {
      const i = inLf[j];
      scratch[j] = logit(baseUnemployment(world.age[i])) + Math.log(UNEMP_EDU_ODDS[world.edu[i]]);
    }
    const kU = rake(scratch, inLf.length, uTarget);
    const isUnemployed = new Set(sampleExactly(inLf, (j) => sigmoid(scratch[j] + kU), Math.round(uTarget * inLf.length), rng));
    const eduCounts = [0, 0, 0, 0];
    const employed: number[] = [];
    for (let j = 0; j < inLf.length; j++) {
      const i = inLf[j];
      if (isUnemployed.has(i)) {
        world.status[i] = STATUS.UNEMPLOYED;
        // unemployment spells: a mix of short and long durations
        const mean = rng.next() < 0.75 ? 2.5 : 14;
        world.dur[i] = Math.min(60, Math.floor(-Math.log(1 - rng.next()) * mean));
      } else {
        world.status[i] = STATUS.EMPLOYED;
        employed.push(i);
        world.tenure[i] = Math.min((world.age[i] - 15) * 12, Math.floor(-Math.log(1 - rng.next()) * 50));
      }
      eduCounts[world.edu[i]]++;
    }
    world.lf0[c] = inLf.length * world.weight[c];

    // industry: county job mix x education affinity, fitted with IPF
    const jobsC = data.jobs[c];
    const jobTotal = jobsC.reduce((a, b) => a + b, 0);
    const shares = jobTotal > 0 ? jobsC.map((v) => v / jobTotal) : natJobs.map((v) => v / natJobs.reduce((a, b) => a + b, 0));
    const table = fitSectorTable(eduCounts, shares, ns);
    const rowCdfs = table.map((r) => cumulative(r));
    for (const i of inLf) {
      const cdf = rowCdfs[world.edu[i]];
      world.sector[i] = cdf[ns - 1] > 0 ? rng.pickCdf(cdf) : rng.pickCdf(cumulative(shares));
    }

    // pay: county x sector average (CBP), spread by productivity
    const prodSum = new Float64Array(ns);
    const prodN = new Float64Array(ns);
    for (const i of employed) {
      prodSum[world.sector[i]] += world.prod[i];
      prodN[world.sector[i]]++;
    }
    for (let s = 0; s < ns; s++) {
      world.prodRef[c * ns + s] = prodN[s] > 0 ? prodSum[s] / prodN[s] : 1;
      world.sectorWage[c * ns + s] = data.wage[c][s];
      world.L0[c * ns + s] = prodN[s] * world.weight[c];
    }
    for (const i of employed) {
      const s = world.sector[i];
      world.wage[i] = (data.wage[c][s] * world.prod[i]) / world.prodRef[c * ns + s];
    }
    row += size;
  }
  world.countyStart[nc] = row;
  return world;
}

/**
 * Draw exactly m items without replacement, item j with weight p(j)
 * (Efraimidis-Spirakis keys u^(1/p)), so county totals are hit exactly
 * instead of only in expectation. Returns items in their original order.
 */
function sampleExactly(items: number[], p: (j: number) => number, m: number, rng: Rng): number[] {
  if (m <= 0) return [];
  if (m >= items.length) return items.slice();
  const keys = items.map((_, j) => ({ j, key: Math.log(1 - rng.next()) / Math.max(1e-9, p(j)) }));
  keys.sort((a, b) => b.key - a.key);
  return keys
    .slice(0, m)
    .map((k) => k.j)
    .sort((a, b) => a - b)
    .map((j) => items[j]);
}

function share16plus(age: number[]): number {
  let s = 0;
  for (let b = 0; b < age.length; b++) s += b === 3 ? age[b] * 0.8 : b >= 4 ? age[b] : 0;
  return s;
}
