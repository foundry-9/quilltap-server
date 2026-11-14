/**
 * Unit tests for `chooseLLMOutfit`'s response parser.
 *
 * The parser is the gate that decides which of the model's picks survive, and
 * it's the reason `llm_choose` couldn't equip shared items: ids outside the
 * candidate pool are dropped. Now that the pool spans all three tiers, the
 * pool-membership check has to accept shared ids too.
 *
 * Strategy: mock `./core-execution` to capture the `parseResponse` callback and
 * drive it directly with model output — no provider, no network.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

const { chooseLLMOutfit } = require('@/lib/memory/cheap-llm-tasks/outfit-selection');
const { executeCheapLLMTask } = require('@/lib/memory/cheap-llm-tasks/core-execution');

const mockExecute = executeCheapLLMTask as jest.Mock;

type Slots = { top: string[]; bottom: string[]; footwear: string[]; accessories: string[]; hair: string[] };
type Choice = { slots: Slots; deliberatelyUnclothed: boolean };

const EMPTY: Slots = { top: [], bottom: [], footwear: [], accessories: [], hair: [] };

function item(id: string, types: string[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    characterId: null,
    title: id,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const POOL = [
  // A shared (characterId: null) item — the case that used to be unreachable.
  item('general-coat', ['top']),
  item('own-jeans', ['bottom'], { characterId: 'char-1' }),
  item('own-boots', ['footwear'], { characterId: 'char-1' }),
  item('own-braids', ['hair'], { characterId: 'char-1' }),
];

/** Run `chooseLLMOutfit` far enough to capture the parser, then drive it. */
async function parserFor(pool = POOL): Promise<(content: string) => Choice> {
  mockExecute.mockResolvedValue({ success: true, result: null });
  await chooseLLMOutfit(
    'Bertie',
    'd',
    'p',
    'm',
    pool,
    'a formal evening',
    null,
    { profileId: 'cheap' },
    'user-1',
    'chat-1',
    'char-1',
  );
  return mockExecute.mock.calls[0][3] as (content: string) => Choice;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('chooseLLMOutfit — response parsing', () => {
  it('accepts a shared item id present in the pool', async () => {
    const parse = await parserFor();
    expect(parse('{"top":["general-coat"],"bottom":[],"footwear":[],"accessories":[]}')).toEqual({
      slots: { ...EMPTY, top: ['general-coat'] },
      deliberatelyUnclothed: false,
    });
  });

  it('drops an id that is not in the pool', async () => {
    const parse = await parserFor();
    expect(
      parse('{"top":["hallucinated-cape"],"bottom":[],"footwear":[],"accessories":[]}').slots.top,
    ).toEqual([]);
  });

  it('drops an ARCHIVED id a model conjured out of nowhere', async () => {
    // The pool handed to this task never contains archived garments, so an
    // archived id can only arrive by hallucination — and pool membership is
    // the gate that stops it. Archiving is the one rule the model gets no
    // say in: no parameter, no override.
    const parse = await parserFor();
    expect(
      parse('{"top":["shelved-cape"],"bottom":[],"footwear":[],"accessories":[]}').slots.top,
    ).toEqual([]);
  });

  it('would not accept an archived garment even if one leaked into the pool', async () => {
    // Belt-and-braces: pool membership is by id, so a leaked archived item
    // WOULD be accepted here. This case documents that the pool is the only
    // guard — which is why the filtering lives in `mergeWearablePool` and is
    // pinned end-to-end in `__tests__/unit/lib/wardrobe/archived-never-auditions.test.ts`.
    const leaked = [item('shelved-cape', ['top'], { archivedAt: '2026-02-01T00:00:00.000Z' })];
    const parse = await parserFor(leaked);
    expect(
      parse('{"top":["shelved-cape"],"bottom":[],"footwear":[],"accessories":[]}').slots.top,
    ).toEqual(['shelved-cape']);
  });

  it('drops an id whose types do not cover the slot it was placed in', async () => {
    const parse = await parserFor();
    // own-boots is footwear; the model put it in `top`.
    expect(parse('{"top":["own-boots"],"footwear":["own-boots"]}').slots).toEqual({
      ...EMPTY,
      footwear: ['own-boots'],
    });
  });

  it('tolerates the legacy single-id scalar shape', async () => {
    const parse = await parserFor();
    expect(parse('{"top":"general-coat","bottom":null}').slots).toEqual({
      ...EMPTY,
      top: ['general-coat'],
    });
  });

  it('dedupes repeated ids within a slot', async () => {
    const parse = await parserFor();
    expect(parse('{"top":["general-coat","general-coat"]}').slots.top).toEqual(['general-coat']);
  });

  it('strips markdown fences before parsing', async () => {
    const parse = await parserFor();
    const fenced = '```json\n{"bottom":["own-jeans"]}\n```';
    expect(parse(fenced).slots.bottom).toEqual(['own-jeans']);
  });

  it('returns empty slots for a non-object response', async () => {
    const parse = await parserFor();
    expect(parse('["general-coat"]')).toEqual({
      slots: EMPTY,
      deliberatelyUnclothed: false,
    });
  });

  // ─────────────────────────────────────────── deliberate nudity

  it('reports a flagged empty answer as deliberate', async () => {
    const parse = await parserFor();
    expect(
      parse('{"deliberate":true,"top":[],"bottom":[],"footwear":[],"accessories":[]}'),
    ).toEqual({ slots: EMPTY, deliberatelyUnclothed: true });
  });

  it('does not report an unflagged empty answer as deliberate', async () => {
    const parse = await parserFor();
    expect(parse('{"top":[],"bottom":[],"footwear":[],"accessories":[]}').deliberatelyUnclothed).toBe(
      false,
    );
  });

  // ─────────────────────────────────────────── the hair slot

  it('accepts a hair-typed item placed in the hair slot', async () => {
    const parse = await parserFor();
    expect(parse('{"hair":["own-braids"]}').slots).toEqual({
      ...EMPTY,
      hair: ['own-braids'],
    });
  });

  it('rejects a hair-typed item offered to a clothing slot', async () => {
    const parse = await parserFor();
    expect(parse('{"top":["own-braids"]}').slots).toEqual(EMPTY);
  });

  it('keeps a styled hairdo alongside a deliberate-nudity flag', async () => {
    const parse = await parserFor();
    const out = parse('{"deliberate":true,"top":[],"bottom":[],"footwear":[],"accessories":[],"hair":["own-braids"]}');
    expect(out.deliberatelyUnclothed).toBe(true);
    expect(out.slots).toEqual({ ...EMPTY, hair: ['own-braids'] });
  });

  it('requires a real boolean — a stringy "true" is not a deliberate claim', async () => {
    const parse = await parserFor();
    expect(parse('{"deliberate":"true","top":[]}').deliberatelyUnclothed).toBe(false);
  });

  it('keeps picked items alongside a deliberate flag', async () => {
    const parse = await parserFor();
    const out = parse('{"deliberate":true,"top":["general-coat"]}');
    expect(out.slots.top).toEqual(['general-coat']);
    expect(out.deliberatelyUnclothed).toBe(true);
  });

  it('includes a Dressing Instructions block when instructions are provided', async () => {
    mockExecute.mockResolvedValue({ success: true, result: null });
    await chooseLLMOutfit(
      'Bertie',
      null,
      null,
      null,
      POOL,
      null,
      'You prefer tweeds for fieldwork.',
      { profileId: 'cheap' },
      'user-1',
    );
    const messages = mockExecute.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === 'user')!;
    expect(userMessage.content).toContain('Dressing Instructions');
    expect(userMessage.content).toContain('You prefer tweeds for fieldwork.');
    expect(userMessage.content).toContain('"you" is Bertie');
  });

  it('emits a byte-identical user message when instructions are null or blank', async () => {
    const runWith = async (instructions: string | null) => {
      mockExecute.mockClear();
      mockExecute.mockResolvedValue({ success: true, result: null });
      await chooseLLMOutfit(
        'Bertie',
        null,
        null,
        null,
        POOL,
        null,
        instructions,
        { profileId: 'cheap' },
        'user-1',
        undefined,
        undefined,
        undefined,
        { random: () => 0.5 }, // a fixed shuffle, so only the instructions can differ
      );
      const messages = mockExecute.mock.calls[0][1] as Array<{ role: string; content: string }>;
      return messages.find((m) => m.role === 'user')!.content;
    };
    const withNull = await runWith(null);
    const withBlank = await runWith('   \n  ');
    expect(withBlank).toBe(withNull);
    expect(withNull).not.toContain('Dressing Instructions');
  });

  it('short-circuits to empty slots without calling the model for an empty pool', async () => {
    mockExecute.mockResolvedValue({ success: true, result: null });
    const result = await chooseLLMOutfit(
      'Bertie',
      null,
      null,
      null,
      [],
      null,
      null,
      { profileId: 'cheap' },
      'user-1',
    );
    expect(mockExecute).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      result: { slots: EMPTY, deliberatelyUnclothed: false },
    });
  });
});

describe('chooseLLMOutfit — variety', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ success: true, result: null });
  });

  async function promptFor(options: Record<string, unknown> = {}) {
    await chooseLLMOutfit(
      'Bertie', 'd', 'p', 'm', POOL, 'a formal evening', null,
      { profileId: 'cheap' }, 'user-1', 'chat-1', 'char-1', null, options,
    );
    const call = mockExecute.mock.calls[0];
    return {
      system: call[1][0].content as string,
      user: call[1][1].content as string,
      options: call[10] as { temperature?: number },
    };
  }

  it('asks for a higher-than-default temperature', async () => {
    const { options } = await promptFor();
    const { OUTFIT_SELECTION_TEMPERATURE } = require('@/lib/memory/cheap-llm-tasks/outfit-selection');
    expect(options.temperature).toBe(OUTFIT_SELECTION_TEMPERATURE);
    expect(OUTFIT_SELECTION_TEMPERATURE).toBeGreaterThan(0.3);
  });

  it('tells the model to vary the outfit', async () => {
    const { system } = await promptFor();
    expect(system).toMatch(/Vary the outfit/);
    expect(system).toMatch(/never decides whether the scene calls for clothes/);
  });

  it('lists recent openings newest first, unclothed ones marked', async () => {
    const { user } = await promptFor({
      recentOpenings: [
        { when: 'yesterday', titles: ['Navy Sweater', 'Jeans'], unclothed: false },
        { when: '3 days ago', titles: ['Wedding Ring'], unclothed: true },
      ],
    });
    expect(user).toContain('Recent Openings (what Bertie arrived in');
    expect(user).toContain('1. (yesterday) Navy Sweater, Jeans');
    expect(user).toContain('2. (3 days ago) nothing but Wedding Ring (unclothed)');
  });

  it('omits the section when there are no recent openings', async () => {
    const { user } = await promptFor({ recentOpenings: [] });
    expect(user).not.toContain('Recent Openings');
  });

  it('shuffles the wardrobe listing with the injected randomness', async () => {
    const order = (user: string) => Array.from(user.matchAll(/ID: ([a-z-]+) \|/g)).map((m) => m[1]);
    const { user: asIs } = await promptFor({ random: () => 0.999999 });
    expect(order(asIs)).toEqual(POOL.map((i) => i.id));
    mockExecute.mockClear();
    const { user: reversed } = await promptFor({ random: () => 0 });
    expect(order(reversed)).not.toEqual(POOL.map((i) => i.id));
    expect([...order(reversed)].sort()).toEqual(POOL.map((i) => i.id).sort());
  });
});

describe('chooseLLMOutfit — outfit sets', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ success: true, result: null });
  });

  async function promptFor(pool: ReturnType<typeof item>[]) {
    await chooseLLMOutfit(
      'Bertie', 'd', 'p', 'm', pool, 'a garden party', null,
      { profileId: 'cheap' }, 'user-1', 'chat-1', 'char-1', null, {},
    );
    const call = mockExecute.mock.calls[0];
    return { system: call[1][0].content as string, user: call[1][1].content as string };
  }

  it("names a set's pieces by title, counting the ones not offered", async () => {
    const { user } = await promptFor([
      item('blazer', ['top'], { title: 'Linen Blazer' }),
      item('trousers', ['bottom'], { title: 'Linen Trousers' }),
      item('suit', ['top', 'bottom', 'footwear'], {
        title: 'Linen Suit',
        componentItemIds: ['blazer', 'trousers', 'held-back-loafers'],
      }),
    ]);
    expect(user).toContain('"Linen Suit" [composite — bundles "Linen Blazer", "Linen Trousers", 1 other item]');
  });

  it('marks a plain item with no composite note', async () => {
    const { user } = await promptFor([item('blazer', ['top'], { title: 'Linen Blazer' })]);
    expect(user).not.toContain('composite');
  });

  it('tells the model it may wear one piece of a set alone', async () => {
    const { system } = await promptFor([item('blazer', ['top'])]);
    expect(system).toMatch(/You need not take a set whole/);
    expect(system).toMatch(/pick that piece by its own ID/);
  });
});
