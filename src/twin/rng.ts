/**
 * Small, fast, seedable PRNG (mulberry32). Every stochastic choice in the
 * twin goes through one of these, so a run is reproducible from its seed.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Index drawn from a cumulative-weight array (last entry = total). */
  pickCdf(cdf: ArrayLike<number>, u = this.next()): number {
    const target = u * cdf[cdf.length - 1];
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}

/** Mix a seed with a step index so each month gets its own stream. */
export function hashSeed(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

export function cumulative(weights: ArrayLike<number>): Float64Array {
  const out = new Float64Array(weights.length);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i] || 0);
    out[i] = acc;
  }
  return out;
}
