/** Messages between the UI thread and the simulation worker. */
import type { Policy } from './world';

export interface InitOptions {
  scale: number;
  minPerCounty: number;
  seed: number;
}

export interface ShockSpec {
  demand: number;
  sector: number[];
  /** state postal code -> multiplier */
  states: Record<string, number>;
  policy: Policy | null;
  matchBoost: number;
}

export type ToWorker =
  | { type: 'init'; base: string; options: InitOptions }
  | { type: 'step' }
  | { type: 'fork'; shocks: ShockSpec }
  | { type: 'setShocks'; shocks: ShockSpec }
  | { type: 'unfork' }
  | { type: 'residents'; county: number; count: number; nonce: number }
  | { type: 'county'; county: number; nonce: number }
  | { type: 'follow'; person: number | null };

export interface NationalStats {
  unemploymentRate: number;
  laborForce: number;
  employed: number;
  participationRate: number;
  meanDurationWeeks: number;
  longTermShare: number;
  hires: number;
  separations: number;
  avgWage: number;
  sectorEmployment: number[];
}

export interface MonthMessage {
  type: 'month';
  t: number;
  label: string;
  mode: 'spinup' | 'replay' | 'forecast' | 'branch';
  national: NationalStats;
  observed: { unrate: number | null; longTermShare: number | null; meanDurationWeeks: number | null; laborForceRatio: number | null } | null;
  demand: number;
  participation: number;
  policy: Policy;
  policyNote: string;
  evaluations: number;
  countyU: Float32Array;
  branch: { national: NationalStats; countyU: Float32Array } | null;
  followed: PersonView | null;
  lastRelease: string;
  /** per state (order of the ready message's states): twin and published rates, and the solved demand dial */
  states: { twin: Float32Array; observed: Float32Array | null; demand: Float32Array | null; error: number | null } | null;
  /** per race (meta.races order): twin rate, CPS rate (NaN where not published) and the incidence dial */
  race: { twin: number[]; observed: number[] | null; risk: number[] } | null;
}

export interface PersonView {
  id: number;
  county: number;
  age: number;
  sex: number;
  race: number;
  edu: number;
  status: number;
  sector: number;
  wage: number;
  dur: number;
  tenure: number;
  health: number;
  vote: number;
}

export interface CountyDetail {
  type: 'county';
  nonce: number;
  county: number;
  /** synthetic people in the county and how many real people each stands for */
  agents: number;
  weight: number;
  /** [male, female] counts per 5-year age bin, weighted */
  pyramid: [number, number][];
  status: number[];
  sector: number[];
  avgWageBySector: number[];
  race: number[];
  edu: number[];
  vote: number[];
  health: number[];
  matchingEfficiency: number;
  uTarget: number;
}

export type FromWorker =
  | { type: 'progress'; message: string }
  | { type: 'ready'; n: number; nc: number; startLabel: string; lastRelease: string; states: string[] | null }
  | MonthMessage
  | CountyDetail
  | { type: 'residents'; nonce: number; people: PersonView[] }
  | { type: 'error'; message: string };
