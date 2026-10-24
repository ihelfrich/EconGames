/** Load the twin data files from disk (tests and the headless CLI). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTwinData, type TwinData } from './data';

export function loadTwinDataFromDisk(dir = join(process.cwd(), 'public', 'twin-data')): Promise<TwinData> {
  return loadTwinData(async (name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}
