// Deterministic PRNG so mock data is identical on server render and client
// hydration (Math.random() would desync and trigger hydration mismatches).

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRange(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

export function seededInt(rand: () => number, min: number, max: number): number {
  return Math.floor(seededRange(rand, min, max + 1));
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}
