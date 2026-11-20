/** @jest-environment node */

import {
  planCollage,
  BAND_RANGES,
  CANVAS,
  MIN_COLLAGE_POOL,
  type CollageMode,
  type CollageOrientation,
  type PlannedTile,
} from '@/lib/dynamic-backgrounds/layout';
import { hashSeed, mulberry32, seededRandom, shuffle } from '@/lib/dynamic-backgrounds/seed';

const ASPECTS = [1.78, 1.5, 1, 0.67, 0.56, 2.1, 1.33, 0.8];

function sources(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `p${i}`, aspect: ASPECTS[i % ASPECTS.length] }));
}

function plan(mode: CollageMode, o: CollageOrientation, seed: string, n = 8, srcs = sources(n)) {
  return planCollage({ mode, canvas: CANVAS[o], sources: srcs, random: seededRandom(seed) });
}

/** Group tiles into bands by the band-axis origin. */
function bands(tiles: PlannedTile[], mode: CollageMode) {
  const map = new Map<number, PlannedTile[]>();
  for (const t of tiles) {
    const k = mode === 'rows' ? t.y : t.x;
    map.set(k, [...(map.get(k) ?? []), t]);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/**
 * Check every layout invariant of one plan in plain JS and assert once.
 *
 * Thousands of plans are checked, so a per-cell or per-tile `expect` would run
 * millions of matchers (about 110 s); the problems are gathered instead and the
 * list is asserted empty, which still names every violation on failure.
 */
function checkPlan(tiles: PlannedTile[], mode: CollageMode, o: CollageOrientation) {
  const problems: string[] = [];
  const fail = (msg: string) => {
    if (problems.length < 20) problems.push(msg);
  };
  const { width, height } = CANVAS[o];
  let area = 0;
  for (const t of tiles) {
    const id = `${t.key}@${t.x},${t.y} ${t.width}x${t.height}`;
    if (![t.x, t.y, t.width, t.height].every(Number.isInteger)) fail(`non-integer tile ${id}`);
    if (t.width < 1 || t.height < 1) fail(`empty tile ${id}`);
    if (t.x + t.width > width || t.y + t.height > height) fail(`tile off canvas ${id}`);
    area += t.width * t.height;
  }
  if (area !== width * height) fail(`area ${area} !== ${width * height}`);

  // Coarse occupancy grid: every cell covered exactly once.
  const step = 30;
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const grid = new Uint8Array(cols * rows);
  for (const t of tiles) {
    for (let cy = Math.floor(t.y / step); cy <= Math.floor((t.y + t.height - 1) / step); cy++) {
      for (let cx = Math.floor(t.x / step); cx <= Math.floor((t.x + t.width - 1) / step); cx++) {
        // only count a cell for the tile that owns its top-left sample point
        const sx = cx * step;
        const sy = cy * step;
        if (sx >= t.x && sx < t.x + t.width && sy >= t.y && sy < t.y + t.height) grid[cy * cols + cx]++;
      }
    }
  }
  grid.forEach((c, i) => {
    if (c !== 1) fail(`cell ${i % cols},${Math.floor(i / cols)} covered ${c} times`);
  });

  const bs = bands(tiles, mode);
  const [lo, hi] = BAND_RANGES[mode][o];
  if (bs.length < lo || bs.length > hi) fail(`${bs.length} bands outside [${lo}, ${hi}]`);

  const full = mode === 'rows' ? width : height;
  const total = mode === 'rows' ? height : width;
  const thickness = Math.floor(total / bs.length);
  const remainder = total - thickness * bs.length;
  bs.forEach((band, i) => {
    const thick = mode === 'rows' ? band[0].height : band[0].width;
    const want = i === bs.length - 1 ? thickness + remainder : thickness;
    if (thick !== want) fail(`band ${i} thickness ${thick} !== ${want}`);
    const ordered = [...band].sort((a, b) => (mode === 'rows' ? a.x - b.x : a.y - b.y));
    let pos = 0;
    ordered.forEach((t, j) => {
      const at = mode === 'rows' ? t.x : t.y;
      if (at !== pos) fail(`band ${i} tile ${j} at ${at}, expected ${pos}`);
      pos += mode === 'rows' ? t.width : t.height;
      if (j > 0 && t.key === ordered[j - 1].key) fail(`band ${i} repeats ${t.key} side by side`);
    });
    if (pos !== full) fail(`band ${i} spans ${pos} !== ${full}`);
  });

  expect(problems).toEqual([]);
}

const CASES: Array<[CollageMode, CollageOrientation]> = [
  ['rows', 'landscape'],
  ['rows', 'portrait'],
  ['columns', 'landscape'],
  ['columns', 'portrait'],
];

describe('planCollage', () => {
  describe.each(CASES)('%s %s', (mode, o) => {
    it('holds the invariants across many seeds', () => {
      for (let s = 0; s < 200; s++) checkPlan(plan(mode, o, `seed-${s}`), mode, o);
    });

    it('works with a pool of exactly 3', () => {
      for (let s = 0; s < 200; s++) checkPlan(plan(mode, o, `three-${s}`, 3), mode, o);
    });

    it('survives extreme aspects', () => {
      const srcs = [
        { key: 'a', aspect: 0.1 },
        { key: 'b', aspect: 10 },
        { key: 'c', aspect: 0 },
        { key: 'd', aspect: NaN },
        { key: 'e', aspect: -2 },
      ];
      for (let s = 0; s < 200; s++) checkPlan(plan(mode, o, `ext-${s}`, 0, srcs), mode, o);
    });

    it('is deterministic', () => {
      expect(plan(mode, o, 'same')).toEqual(plan(mode, o, 'same'));
    });

    it('varies with the seed', () => {
      const plans = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(plan(mode, o, `v${i}`))));
      expect(plans.size).toBeGreaterThan(1);
    });
  });

  it('throws for fewer than 3 distinct keys', () => {
    expect(MIN_COLLAGE_POOL).toBe(3);
    const random = seededRandom('x');
    const canvas = CANVAS.landscape;
    expect(() => planCollage({ mode: 'rows', canvas, sources: sources(2), random })).toThrow();
    expect(() =>
      planCollage({
        mode: 'rows',
        canvas,
        sources: [
          { key: 'a', aspect: 1 },
          { key: 'a', aspect: 1 },
          { key: 'b', aspect: 1 },
        ],
        random,
      }),
    ).toThrow();
  });

  it('honours an explicit bandRange', () => {
    const tiles = planCollage({
      mode: 'rows',
      canvas: CANVAS.landscape,
      sources: sources(5),
      random: seededRandom('r'),
      bandRange: [2, 2],
    });
    expect(bands(tiles, 'rows')).toHaveLength(2);
  });
});

describe('seed', () => {
  it('mulberry32 yields floats in [0,1) and is repeatable', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(b());
    }
  });

  it('hashSeed is stable, unsigned 32-bit and discriminating', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    const h = hashSeed('deadbeef:home:landscape');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('shuffle returns a permutation and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const copy = [...input];
    const out = shuffle(input, seededRandom('s'));
    expect(input).toEqual(copy);
    expect([...out].sort((a, b) => a - b)).toEqual(copy);
  });
});
