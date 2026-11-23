/**
 * Collage layout planner for dynamic backgrounds.
 *
 * `planCollage` is pure: given a canvas, the aspect ratios of the pictures in
 * the pool and a seeded random stream, it returns integer rectangles that
 * cover the canvas exactly (no gap, no overlap). Rows mode lays horizontal
 * bands of tiles; columns mode is the same turned ninety degrees. No I/O.
 *
 * @module dynamic-backgrounds/layout
 */

import { shuffle } from './seed';

export type CollageMode = 'rows' | 'columns';
export type CollageOrientation = 'landscape' | 'portrait';

export interface PlannedTile {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollageSourceAspect {
  key: string;
  /** width / height */
  aspect: number;
}

/** Aspect is clamped to this range so one panorama or sliver cannot swallow a band. */
export const ASPECT_MIN = 0.5;
export const ASPECT_MAX = 2.4;

/** Fewest distinct pictures a collage may be planned from. */
export const MIN_COLLAGE_POOL = 3;

/** Band-count ranges, inclusive. */
export const BAND_RANGES = {
  rows: { landscape: [3, 5], portrait: [4, 6] },
  columns: { landscape: [3, 7], portrait: [2, 4] },
} as const;

export const CANVAS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
} as const;

export interface PlanCollageInput {
  mode: CollageMode;
  canvas: { width: number; height: number };
  sources: CollageSourceAspect[];
  random: () => number;
  /** Inclusive band-count range; derived from mode and canvas shape when omitted. */
  bandRange?: readonly [number, number];
}

function normaliseAspect(aspect: number, mode: CollageMode): number {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return mode === 'rows' ? 16 / 9 : 2 / 3;
  }
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));
}

/** Deals cards from a shuffled deck, reshuffling when exhausted. */
function createDealer(cards: CollageSourceAspect[], random: () => number) {
  let deck: CollageSourceAspect[] = [];
  const refill = () => {
    deck = deck.concat(shuffle(cards, random));
  };
  return {
    /** Next card, never the same key as `previousKey`. */
    deal(previousKey: string | null): CollageSourceAspect {
      if (deck.length === 0) refill();
      if (previousKey !== null && deck[0].key === previousKey) {
        let j = deck.findIndex((c, i) => i > 0 && c.key !== previousKey);
        while (j === -1) {
          refill(); // distinct pool of >= 3 guarantees a different key arrives
          j = deck.findIndex((c, i) => i > 0 && c.key !== previousKey);
        }
        const tmp = deck[0];
        deck[0] = deck[j];
        deck[j] = tmp;
      }
      return deck.shift() as CollageSourceAspect;
    },
    /** Return a dealt-but-unused card to the front of the deck. */
    putBack(card: CollageSourceAspect): void {
      deck.unshift(card);
    },
  };
}

/** Split `total` into integer lengths proportional to `naturals`, each >= 1, summing to total. */
function scaleToTotal(naturals: number[], total: number): number[] {
  const running = naturals.reduce((a, b) => a + b, 0);
  const n = naturals.length;
  const out: number[] = [];
  let prev = 0;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += naturals[i];
    let boundary = i === n - 1 ? total : Math.round((cum * total) / running);
    boundary = Math.max(prev + 1, boundary);
    boundary = Math.min(boundary, total - (n - 1 - i));
    boundary = Math.max(boundary, prev + 1);
    out.push(boundary - prev);
    prev = boundary;
  }
  out[n - 1] += total - prev; // exact cover even in degenerate cases
  return out;
}

/** Fill one band: returns tile keys and lengths along the band's axis. */
function fillBand(
  dealer: ReturnType<typeof createDealer>,
  target: number,
  naturalOf: (aspect: number) => number,
): Array<{ key: string; length: number }> {
  const cards: CollageSourceAspect[] = [];
  const naturals: number[] = [];
  let running = 0;
  while (running < target) {
    const card = dealer.deal(cards.length ? cards[cards.length - 1].key : null);
    const natural = naturalOf(card.aspect);
    cards.push(card);
    naturals.push(natural);
    running += natural;
  }
  if (cards.length > 1) {
    const last = naturals[naturals.length - 1];
    if (Math.abs(running - last - target) < Math.abs(running - target)) {
      dealer.putBack(cards.pop() as CollageSourceAspect);
      naturals.pop();
      running -= last;
    }
  }
  const lengths = scaleToTotal(naturals, target);
  return cards.map((c, i) => ({ key: c.key, length: lengths[i] }));
}

export function planCollage(input: PlanCollageInput): PlannedTile[] {
  const { mode, canvas, random } = input;

  const seen = new Set<string>();
  const cards: CollageSourceAspect[] = [];
  for (const s of input.sources) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    cards.push({ key: s.key, aspect: normaliseAspect(s.aspect, mode) });
  }
  if (cards.length < MIN_COLLAGE_POOL) {
    throw new Error(
      `planCollage needs at least ${MIN_COLLAGE_POOL} distinct pictures, got ${cards.length}`,
    );
  }

  const orientation: CollageOrientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
  const [lo, hi] = input.bandRange ?? BAND_RANGES[mode][orientation];
  const bands = lo + Math.floor(random() * (hi - lo + 1));

  const dealer = createDealer(cards, random);
  const tiles: PlannedTile[] = [];

  if (mode === 'rows') {
    const thickness = Math.floor(canvas.height / bands);
    for (let b = 0; b < bands; b++) {
      const y = b * thickness;
      const height = b === bands - 1 ? canvas.height - y : thickness;
      const band = fillBand(dealer, canvas.width, (a) => thickness * a);
      let x = 0;
      for (const t of band) {
        tiles.push({ key: t.key, x, y, width: t.length, height });
        x += t.length;
      }
    }
  } else {
    const thickness = Math.floor(canvas.width / bands);
    for (let b = 0; b < bands; b++) {
      const x = b * thickness;
      const width = b === bands - 1 ? canvas.width - x : thickness;
      const band = fillBand(dealer, canvas.height, (a) => thickness / a);
      let y = 0;
      for (const t of band) {
        tiles.push({ key: t.key, x, y, width, height: t.length });
        y += t.length;
      }
    }
  }
  return tiles;
}
