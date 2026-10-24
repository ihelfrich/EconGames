/** Shapes of the files that pipeline/build_twin_data.py writes to public/twin-data. */

export interface SectorMeta {
  id: string;
  label: string;
  group: string;
}

export interface CountyData {
  meta: {
    built: string;
    sectors: SectorMeta[];
    ageBins: string[];
    races: string[];
    eduLevels: string[];
    laborYears: number[];
    health: string[];
    attribution: string[];
  };
  fips: string[];
  name: string[];
  state: string[];
  /** centroid in Albers map units (same space as the grid) */
  cx: number[];
  cy: number[];
  pop: number[];
  male: number[];
  /** share of population in each 5-year age bin */
  age: number[][];
  /** shares: white NH, black, asian, hispanic, other */
  race: number[][];
  /** shares of adults 25+: <HS, HS, some college, BA+ */
  edu: number[][];
  /** BLS LAUS annual labor force / unemployed for laborYears (2004..2020) */
  lf: (number | null)[][];
  unemp: (number | null)[][];
  income: (number | null)[];
  poverty: (number | null)[];
  /** CBP employees by twin sector (government imputed) */
  jobs: number[][];
  /** average annual pay by twin sector */
  wage: number[][];
  /** obesity, smoking, fair/poor health, uninsured (shares) */
  health: (number | null)[][];
  lifeExp: (number | null)[];
  /** [dem, gop, total] */
  vote2020: ([number, number, number] | null)[];
  vote2024: ([number, number, number] | null)[];
  altitude: (number | null)[];
  landArea: (number | null)[];
}

export interface GridData {
  w: number;
  h: number;
  cell: number;
  x0: number;
  y0: number;
  /** county index per tile, -1 = water */
  cells: number[];
}

export interface Releases {
  months: string[];
  unrate: (number | null)[];
  payems: (number | null)[];
  laborForce: (number | null)[];
  employed: (number | null)[];
  meanDuration: (number | null)[];
  longTerm: (number | null)[];
  cpi: (number | null)[];
  fedfunds: (number | null)[];
  /** payroll employment by release group, aligned with months */
  sectorGroups: Record<string, number[]>;
  sectorSeries: Record<string, string>;
  sources: string[];
}

export interface TwinData {
  counties: CountyData;
  grid: GridData;
  releases: Releases;
}

export async function loadTwinData(read: (name: string) => Promise<unknown>): Promise<TwinData> {
  const [counties, grid, releases] = await Promise.all([
    read('counties.json'),
    read('grid.json'),
    read('releases.json'),
  ]);
  return { counties: counties as CountyData, grid: grid as GridData, releases: releases as Releases };
}
