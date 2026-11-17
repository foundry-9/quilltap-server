/**
 * Seeded randomness for dynamic backgrounds.
 *
 * A collage is a pure function of its seed: the same seed string plus the same
 * pool yields the same layout. These helpers turn a string into a
 * deterministic random stream and shuffle with it. No imports, no I/O.
 *
 * @module dynamic-backgrounds/seed
 */

/** Standard mulberry32 PRNG; returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit unsigned string hash (FNV-1a over UTF-16 code units). */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A random stream seeded from a string. */
export function seededRandom(input: string): () => number {
  return mulberry32(hashSeed(input));
}

/** Fisher-Yates shuffle on a copy; the input is not modified. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
