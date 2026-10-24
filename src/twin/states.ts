/**
 * States: the layer between counties and the nation.
 *
 * BLS publishes unemployment and the labor force for every state each month.
 * The twin carries one demand dial and one labor-force dial per state, and
 * the assimilator solves them so each state's unemployment rate (relative to
 * the nation) and labor force (relative to its start) match the release.
 * Counties inside a state still differ only through the model, which is what
 * the within-state backtest checks.
 */
import type { World } from './world';
import { STATUS } from './world';

const EMPLOYED = STATUS.EMPLOYED;
const UNEMPLOYED = STATUS.UNEMPLOYED;

export const STATE_POSTAL: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

export class StateMap {
  /** two-digit FIPS per state index */
  readonly codes: string[];
  readonly postal: string[];
  /** state index per county (-1 if the county's state has no release) */
  readonly stateOf: Int16Array;
  readonly n: number;

  constructor(countyFips: string[], codes: string[]) {
    this.codes = codes;
    this.n = codes.length;
    this.postal = codes.map((c) => STATE_POSTAL[c] ?? c);
    const idx = new Map(codes.map((c, i) => [c, i]));
    this.stateOf = Int16Array.from(countyFips, (f) => idx.get(f.slice(0, 2)) ?? -1);
  }
}

export interface StateMeasure {
  /** weighted unemployed per state */
  unemployed: Float64Array;
  /** weighted labor force per state */
  laborForce: Float64Array;
}

export function newStateMeasure(n: number): StateMeasure {
  return { unemployed: new Float64Array(n), laborForce: new Float64Array(n) };
}

/** Weighted unemployment and labor force per state, from the person arrays. */
export function measureStates(w: World, map: StateMap, out: StateMeasure): StateMeasure {
  out.unemployed.fill(0);
  out.laborForce.fill(0);
  for (let c = 0; c < w.nc; c++) {
    const s = map.stateOf[c];
    if (s < 0) continue;
    let e = 0;
    let u = 0;
    for (let i = w.countyStart[c]; i < w.countyStart[c + 1]; i++) {
      const st = w.status[i];
      if (st === EMPLOYED) e++;
      else if (st === UNEMPLOYED) u++;
    }
    out.unemployed[s] += u * w.weight[c];
    out.laborForce[s] += (e + u) * w.weight[c];
  }
  return out;
}

/** County unemployment rates aggregated to states, labor-force weighted. */
export function stateRatesFromCounties(countyU: ArrayLike<number>, countyLf: ArrayLike<number>, map: StateMap): Float64Array {
  const u = new Float64Array(map.n);
  const lf = new Float64Array(map.n);
  for (let c = 0; c < countyU.length; c++) {
    const s = map.stateOf[c];
    if (s < 0 || !(countyLf[c] > 0)) continue;
    u[s] += countyU[c] * countyLf[c];
    lf[s] += countyLf[c];
  }
  for (let s = 0; s < map.n; s++) u[s] = lf[s] > 0 ? u[s] / lf[s] : 0;
  return u;
}
