/**
 * The twin's state: one row per synthetic person in structure-of-arrays form
 * (typed arrays, so ~500k people fit in a few MB and a month runs in a few
 * milliseconds), plus county- and nation-level state the mechanisms share.
 *
 * People are stored sorted by county, so county c owns rows
 * countyStart[c] .. countyStart[c+1]-1.
 */

export const STATUS = { CHILD: 0, EMPLOYED: 1, UNEMPLOYED: 2, NILF: 3 } as const;
export const HEALTH = { OBESE: 1, SMOKER: 2, POOR_HEALTH: 4, UNINSURED: 8 } as const;
export const VOTE = { NONE: 0, DEM: 1, GOP: 2, OTHER: 3 } as const;
export const NO_SECTOR = -1;

export interface Policy {
  /** months of unemployment insurance eligibility */
  uiMonths: number;
  /** proportional cut in search intensity while receiving UI */
  uiSearchPenalty: number;
  /** multiplier on every county's matching efficiency */
  matchBoost: number;
}

export const DEFAULT_POLICY: Policy = { uiMonths: 6, uiSearchPenalty: 0.2, matchBoost: 1 };

/** Exogenous drivers for one month. The assimilation layer sets these from data. */
export interface Drivers {
  /** aggregate labor demand, 1 = start level */
  demand: number;
  /** labor force dial: every county's target labor force is its start level times this */
  participation: number;
  /** per-sector demand composition, 1 = start mix */
  sector: Float64Array;
  /** per-county demand multiplier (state dials and regional shocks) */
  regional: Float64Array;
  /** per-county labor force multiplier (state dials); absent = 1 everywhere */
  lfRegional?: Float64Array;
  /**
   * per race (meta.races order): multiplies the chance of losing a job and
   * divides the chance of finding one; absent = 1 for everyone
   */
  raceRisk?: Float64Array;
  policy: Policy;
}

export class World {
  readonly n: number;
  readonly nc: number;
  readonly ns: number;

  // people
  county: Uint16Array;
  sex: Uint8Array;
  age: Uint8Array;
  birthMonth: Uint8Array;
  race: Uint8Array;
  edu: Uint8Array;
  status: Uint8Array;
  sector: Int8Array;
  wage: Float32Array;
  prod: Float32Array;
  dur: Uint16Array;
  tenure: Uint16Array;
  health: Uint8Array;
  vote: Uint8Array;

  // counties
  countyStart: Uint32Array;
  /** real people represented by each synthetic person in the county */
  weight: Float64Array;
  /** matching efficiency, calibrated during spin-up */
  mu: Float64Array;
  /** baseline labor demand by county x sector (weighted jobs) */
  L0: Float64Array;
  /** average pay by county x sector */
  sectorWage: Float64Array;
  /** mean productivity of the county x sector's workers at start: pay of a
   * new hire = sectorWage * prod / prodRef */
  prodRef: Float64Array;
  /** labor force at start (weighted), anchor for participation */
  lf0: Float64Array;
  /** BLS 2016 unemployment rate target by county */
  uTarget: Float64Array;

  /** months simulated since the start */
  t = 0;
  /** calendar month index (0 = Jan) of t = 0 */
  startMonth = 0;
  startYear = 2016;
  seed: number;

  constructor(n: number, nc: number, ns: number, seed: number) {
    this.n = n;
    this.nc = nc;
    this.ns = ns;
    this.seed = seed;
    this.county = new Uint16Array(n);
    this.sex = new Uint8Array(n);
    this.age = new Uint8Array(n);
    this.birthMonth = new Uint8Array(n);
    this.race = new Uint8Array(n);
    this.edu = new Uint8Array(n);
    this.status = new Uint8Array(n);
    this.sector = new Int8Array(n);
    this.wage = new Float32Array(n);
    this.prod = new Float32Array(n);
    this.dur = new Uint16Array(n);
    this.tenure = new Uint16Array(n);
    this.health = new Uint8Array(n);
    this.vote = new Uint8Array(n);
    this.countyStart = new Uint32Array(nc + 1);
    this.weight = new Float64Array(nc);
    this.mu = new Float64Array(nc);
    this.L0 = new Float64Array(nc * ns);
    this.sectorWage = new Float64Array(nc * ns);
    this.prodRef = new Float64Array(nc * ns);
    this.lf0 = new Float64Array(nc);
    this.uTarget = new Float64Array(nc);
  }

  /** Calendar label for month t, e.g. "2020-04". */
  label(t = this.t): string {
    const m = this.startMonth + t;
    const y = this.startYear + Math.floor(m / 12);
    return `${y}-${String((m % 12) + 1).padStart(2, '0')}`;
  }

  /** Deep copy: used to fork timelines and for assimilation trial steps. */
  clone(): World {
    const w = Object.create(World.prototype) as World;
    for (const [k, v] of Object.entries(this)) {
      (w as unknown as Record<string, unknown>)[k] = ArrayBuffer.isView(v)
        ? (v as unknown as { slice(): unknown }).slice()
        : v;
    }
    return w;
  }

  /** Copy the mutable person state from another world of the same shape. */
  copyDynamicFrom(o: World): void {
    this.age.set(o.age);
    this.status.set(o.status);
    this.sector.set(o.sector);
    this.wage.set(o.wage);
    this.dur.set(o.dur);
    this.tenure.set(o.tenure);
    this.sex.set(o.sex);
    this.race.set(o.race);
    this.edu.set(o.edu);
    this.prod.set(o.prod);
    this.health.set(o.health);
    this.vote.set(o.vote);
    this.t = o.t;
  }
}
