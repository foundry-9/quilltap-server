/**
 * Stated particulars: what a story character told others as fact, and what a
 * Carina answerer answered, recorded as the telling so it can be told the
 * same way later (docs/developer/features/roleplay-character-latitude.md §13).
 *
 *  - Who is asked: every Carina answer; a roleplay character an LLM plays;
 *    never an assistant's ordinary turn or a human-played seat.
 *  - The prompt: the block is appended after the body, so the body's bytes
 *    (the provider's cached prefix) do not move; a call that asks for nothing
 *    is byte-identical to one built before this existed.
 *  - The parse: one marked item rides beside the cap, never inside it.
 */

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

import {
  STATED_PARTICULARS_CARINA_BLOCK,
  STATED_PARTICULARS_STORY_BLOCK,
  PRIOR_TELLINGS_SHOWN,
  buildSelfTurnMessages,
  selectPriorTellings,
  type StatedParticularsMode,
} from '../prompts/self';
import { statedParticularsFor } from '../passes/self-turn';
import { STATED_PARTICULARS_EXTRA_SLOT, STATED_PARTICULARS_KEYWORD, parseSelfDrafts } from '../parse';
import type { TurnTranscript, TurnCharacterSlice } from '@/lib/services/chat-message/turn-transcript';

const slice: TurnCharacterSlice = {
  characterId: 'obs',
  characterName: 'Odile',
  characterPronouns: null,
  text: 'The lighthouse was raised in 1799.',
  contributingMessageIds: ['m1'],
};

const transcript = {
  characterSlices: [slice],
  userMessage: null,
  userCharacterId: undefined,
  userCharacterName: undefined,
  userCharacterPronouns: null,
  turnOpenerMessageId: null,
  latestAssistantMessageId: 'm1',
} as unknown as TurnTranscript;

function system(statedParticulars?: StatedParticularsMode | null, priorTellings?: string[]): string {
  const messages = buildSelfTurnMessages({
    transcript,
    holderId: 'obs',
    canonBlock: 'CANON',
    cap: 1,
    inAutonomousRoom: false,
    ...(statedParticulars === undefined ? {} : { statedParticulars }),
    ...(priorTellings ? { priorTellings } : {}),
  });
  return messages!.find((m) => m.role === 'system')!.content as string;
}

describe('statedParticularsFor', () => {
  it('asks every Carina answerer, whatever their kind', () => {
    expect(statedParticularsFor('carina', { kind: 'roleplay' }, false)).toBe('carina');
    expect(statedParticularsFor('carina', { kind: 'assistant' }, false)).toBe('carina');
  });

  it('asks a roleplay character an LLM plays, and one with no kind recorded', () => {
    expect(statedParticularsFor('self-turn', { kind: 'roleplay' }, false)).toBe('story');
    expect(statedParticularsFor('self-turn', {}, false)).toBe('story');
  });

  it('asks neither an assistant nor a human-played seat on an ordinary turn', () => {
    expect(statedParticularsFor('self-turn', { kind: 'assistant' }, false)).toBeNull();
    expect(statedParticularsFor('self-turn', { kind: 'roleplay' }, true)).toBeNull();
  });
});

describe('the SELF prompt', () => {
  it('is byte-identical when nothing is asked for', () => {
    expect(system(null)).toBe(system());
    expect(system()).not.toContain('STATED PARTICULARS');
    expect(system()).not.toContain('REFERENCE ANSWER');
  });

  it.each([
    ['story', STATED_PARTICULARS_STORY_BLOCK],
    ['carina', STATED_PARTICULARS_CARINA_BLOCK],
  ] as const)('adds only the %s block, after the body', (mode, block) => {
    const plain = system(null);
    const asked = system(mode);

    expect(asked).toContain(block);
    expect(asked.replace(`${block}\n\n`, '')).toBe(plain);
    // The body — everything up to the block — is the cached prefix.
    const bodyEnd = asked.indexOf(block);
    expect(asked.slice(0, bodyEnd)).toBe(plain.slice(0, bodyEnd));
    expect(asked.indexOf(block)).toBeLessThan(asked.indexOf('CONTEXT\nSUBJECT:'));
  });

  it('records the telling, never the bare fact, in both forms', () => {
    expect(STATED_PARTICULARS_STORY_BLOCK).toContain('Record the telling, never the bare fact');
    expect(STATED_PARTICULARS_STORY_BLOCK).toContain('"I told Sam that');
    expect(STATED_PARTICULARS_CARINA_BLOCK).toContain('Record the answer as given, never as bare fact');
    expect(STATED_PARTICULARS_CARINA_BLOCK).toContain('I answered that');
  });

  it('keeps the story form narrow and to the subject\'s own lines', () => {
    expect(STATED_PARTICULARS_STORY_BLOCK).toContain('only when ALL of these hold');
    expect(STATED_PARTICULARS_STORY_BLOCK).toContain('anything another speaker stated');
    expect(STATED_PARTICULARS_STORY_BLOCK).toContain('jokes, exaggeration, guesses');
    expect(STATED_PARTICULARS_STORY_BLOCK).toContain('withdraw, correct or admit');
  });

  it('skips a Carina answer that was "I do not know"', () => {
    expect(STATED_PARTICULARS_CARINA_BLOCK).toContain('Unless the answer was that the subject does not know');
  });

  it.each([STATED_PARTICULARS_STORY_BLOCK, STATED_PARTICULARS_CARINA_BLOCK])(
    'asks for one marked object at a modest importance',
    (block) => {
      expect(block).toContain('"stated": true');
      expect(block).toContain('return at most one such object');
      expect(block).toContain('0.35, or 0.45');
    },
  );
});

describe('parseSelfDrafts with the stated slot', () => {
  const item = (content: string, extra: Record<string, unknown> = {}) => ({
    content,
    summary: content.toLowerCase(),
    keywords: [],
    importance: 0.4,
    ...extra,
  });
  const raw = (items: unknown[]) => JSON.stringify(items);

  it('keeps one marked item beside a full cap', () => {
    const drafts = parseSelfDrafts(raw([item('hinge'), item('told', { stated: true })]), 1, { statedSlot: true });
    expect(drafts.map((d) => d.content)).toEqual(['hinge', 'told']);
  });

  it('keeps a marked item even when it comes first', () => {
    const drafts = parseSelfDrafts(raw([item('told', { stated: true }), item('hinge'), item('extra')]), 1, { statedSlot: true });
    expect(drafts.map((d) => d.content)).toEqual(['hinge', 'told']);
  });

  it('drops marked items past the slot instead of letting them into the cap', () => {
    const drafts = parseSelfDrafts(
      raw([item('told one', { stated: true }), item('told two', { stated: true }), item('told three', { stated: true })]),
      2,
      { statedSlot: true },
    );
    expect(drafts.map((d) => d.content)).toEqual(['told one']);
    expect(drafts).toHaveLength(STATED_PARTICULARS_EXTRA_SLOT);
  });

  it('treats a marked item as an ordinary candidate when the call did not ask', () => {
    const items = [item('hinge'), item('told', { stated: true })];
    expect(parseSelfDrafts(raw(items), 1).map((d) => d.content)).toEqual(['hinge']);
    expect(parseSelfDrafts(raw(items), 2).map((d) => d.content)).toEqual(['hinge', 'told']);
  });

  it('only a literal true is a mark', () => {
    const drafts = parseSelfDrafts(raw([item('hinge'), item('told', { stated: 'true' })]), 1, { statedSlot: true });
    expect(drafts.map((d) => d.content)).toEqual(['hinge']);
  });

  it('stores the mark as the reserved keyword and nothing else', () => {
    const [draft] = parseSelfDrafts(
      raw([item('told', { stated: true, keywords: ['deed', STATED_PARTICULARS_KEYWORD] })]),
      1,
      { statedSlot: true },
    );
    expect(draft).not.toHaveProperty('stated');
    expect(draft.keywords).toEqual(['deed', STATED_PARTICULARS_KEYWORD]);
  });

  it('gives an unmarked item no keyword', () => {
    const [draft] = parseSelfDrafts(raw([item('hinge')]), 1, { statedSlot: true });
    expect(draft.keywords).not.toContain(STATED_PARTICULARS_KEYWORD);
  });
});

describe('selectPriorTellings', () => {
  const gaunt = "I told Sam that the boathouse deed is in Oren Gaunt's name, freehold, registered in the second book.";
  const lighthouse = 'Asked when the Carrow lighthouse was built, I answered that it was completed in 1870 by Kavanagh & Son.';
  const bread = 'I told Sam that the baker on Quay Street shuts at noon on Thursdays.';

  it('picks the telling that shares names with the exchange', () => {
    const picked = selectPriorTellings([bread, lighthouse, gaunt], 'Remind me whose name was on the boathouse deed? Oren Gaunt, freehold.');
    expect(picked).toEqual([gaunt]);
  });

  it('returns nothing when the exchange is about something else', () => {
    expect(selectPriorTellings([gaunt, lighthouse], 'Lovely weather. Window seat or aisle?')).toEqual([]);
    expect(selectPriorTellings([], 'the boathouse deed')).toEqual([]);
  });

  it('needs more than one shared word', () => {
    expect(selectPriorTellings([gaunt], 'She looked at the boathouse.')).toEqual([]);
  });

  it('shows at most the cap, most shared first, and cuts a long one', () => {
    const many = Array.from({ length: 10 }, (_, i) => `I told Sam the boathouse deed entry number ${i} names Gaunt. ${'x'.repeat(600)}`);
    const best = "I told Sam the boathouse deed names Oren Gaunt freehold in the second book.";
    const picked = selectPriorTellings([...many, best], 'The boathouse deed: Oren Gaunt, freehold, second book.');
    expect(picked).toHaveLength(PRIOR_TELLINGS_SHOWN);
    expect(picked[0]).toBe(best);
    expect(picked[1].endsWith('…')).toBe(true);
  });
});

describe('the ALREADY TOLD footer', () => {
  const told = 'Asked when the Carrow lighthouse was built, I answered that it was raised in 1799 by Isaac Coombe.';

  it('appears after the canon when a relevant telling exists, and tells the extractor to skip a retelling', () => {
    const prompt = system('carina', [told]);
    expect(prompt).toContain('ALREADY TOLD by the subject');
    expect(prompt).toContain(`- ${told}`);
    expect(prompt).toContain('record NOTHING under STATED PARTICULARS');
    expect(prompt).toContain('say what it\nreplaces');
    expect(prompt.indexOf('ALREADY TOLD')).toBeGreaterThan(prompt.indexOf('CANON'));
  });

  it('is absent with no relevant telling, leaving the prompt byte-identical', () => {
    expect(system('carina', ['I told Sam the baker shuts at noon on Thursdays.'])).toBe(system('carina'));
    expect(system('story', [])).toBe(system('story'));
  });

  it('is never shown to a call that does not ask for stated particulars', () => {
    expect(system(null, [told])).toBe(system(null));
  });
});
