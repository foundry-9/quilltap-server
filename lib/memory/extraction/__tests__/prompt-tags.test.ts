/**
 * Memory-extraction targeting-tag normalization and the orienting-context /
 * TAGS prompt structure. The SELF/OTHER parsers are fed canned model JSON
 * directly, and the system prompts are read off the pure message builders
 * (memory refactor Phase D — the bodies are unchanged from the retired
 * `cheap-llm-tasks/memory-tasks.ts`), so the cache-safe footer placement is
 * asserted on exactly what the runner would send.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
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

// ── Subject ───────────────────────────────────────────────────────────────────
import { buildSelfTurnMessages } from '../prompts/self';
import { buildOtherTurnMessages, type OtherSubjectInput } from '../prompts/other';
import type { OrientingContext } from '../prompts/shared';
import { parseSelfDrafts, parseOtherDraftsBySubject, passCap, HARD_CANDIDATE_CAP } from '../parse';
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript';
import type { MemoryDraft } from '@/lib/memory/cheap-llm-tasks/types';

const TRANSCRIPT: TurnTranscript = {
  characterSlices: [
    { characterId: 'obs', characterName: 'Friday', characterPronouns: null, text: 'I made a call.', contributingMessageIds: ['m1'] },
  ],
  userMessage: null,
  userCharacterId: undefined,
  userCharacterName: undefined,
  userCharacterPronouns: null,
  latestAssistantMessageId: 'm1',
} as unknown as TurnTranscript;

const SUBJECTS: OtherSubjectInput[] = [
  { id: 's1', name: 'Amy', pronouns: null, isUser: false, canonBlock: 'ALREADY ESTABLISHED about Amy\n[IDENTITY] An engineer.' },
];

/** The cap the turn passes derive for an 8000-token output budget. */
const CAP = passCap(HARD_CANDIDATE_CAP, 8000);

function systemOf(messages: Array<{ role: string; content: unknown }> | null): string {
  return messages!.find((m) => m.role === 'system')!.content as string;
}

function selfSystem(opts?: OrientingContext): string {
  return systemOf(buildSelfTurnMessages({
    transcript: TRANSCRIPT, holderId: 'obs', canonBlock: 'CANON', cap: CAP, inAutonomousRoom: false, orienting: opts,
  }));
}

function otherSystem(opts?: OrientingContext): string {
  return systemOf(buildOtherTurnMessages({
    transcript: TRANSCRIPT, observer: { name: 'Friday', pronouns: null }, subjects: SUBJECTS, cap: CAP, inAutonomousRoom: false, orienting: opts,
  }));
}

function parseSelf(raw: string): MemoryDraft[] {
  return parseSelfDrafts(raw, CAP);
}

function parseOther(raw: string): Map<string, MemoryDraft[]> {
  return parseOtherDraftsBySubject(raw, SUBJECTS.map((s) => s.id), CAP);
}

describe('SELF tag normalization → targeting (never keywords)', () => {
  it('passes valid tags through onto targeting, leaving the free keywords alone', () => {
    const [candidate] = parseSelf(JSON.stringify([
      { content: 'I committed to X.', summary: 'committed to x', keywords: ['alpha', 'beta'], importance: 0.8, temporal: 'future', scope: 'narrow', context: 'philosophy' },
    ]));
    expect(candidate.keywords).toEqual(['alpha', 'beta']);
    expect(candidate.targeting).toEqual({ temporal: 'future', scope: 'narrow', context: 'philosophy' });
  });

  it('defaults invalid values to present / wide / information', () => {
    const [candidate] = parseSelf(JSON.stringify([
      { content: 'I did Y.', summary: 'did y', keywords: ['alpha'], importance: 0.5, temporal: 'someday', scope: 'galaxy', context: 'gossip' },
    ]));
    expect(candidate.keywords).toEqual(['alpha']);
    expect(candidate.targeting).toEqual({ temporal: 'present', scope: 'wide', context: 'information' });
  });

  it('defaults missing tags (and missing keywords) to the fallbacks', () => {
    const [candidate] = parseSelf(JSON.stringify([
      { content: 'I did Z.', summary: 'did z', importance: 0.5 },
    ]));
    expect(candidate.keywords).toEqual([]);
    expect(candidate.targeting).toEqual({ temporal: 'present', scope: 'wide', context: 'information' });
  });

  it('lowercases valid-but-uppercased tags', () => {
    const [candidate] = parseSelf(JSON.stringify([
      { content: 'I changed.', summary: 'changed', keywords: [], importance: 0.5, temporal: 'PAST', scope: 'WIDE', context: 'History' },
    ]));
    expect(candidate.keywords).toEqual([]);
    expect(candidate.targeting).toEqual({ temporal: 'past', scope: 'wide', context: 'history' });
  });
});

describe('OTHER tag normalization → targeting (routed by subjectIndex)', () => {
  it('passes valid tags through for the addressed subject', () => {
    const result = parseOther(JSON.stringify([
      { subjectIndex: 1, content: 'Amy proposed a layout.', summary: 'proposed layout', keywords: ['cache'], importance: 0.7, temporal: 'moment', scope: 'narrow', context: 'philosophy' },
    ]));
    const amy = result.get('s1') ?? [];
    expect(amy[0].keywords).toEqual(['cache']);
    expect(amy[0].targeting).toEqual({ temporal: 'moment', scope: 'narrow', context: 'philosophy' });
  });

  it('defaults invalid/missing tags', () => {
    const result = parseOther(JSON.stringify([
      { subjectIndex: 1, content: 'Amy did a thing.', summary: 'did a thing', keywords: ['x'], importance: 0.5 },
    ]));
    const amy = result.get('s1') ?? [];
    expect(amy[0].keywords).toEqual(['x']);
    expect(amy[0].targeting).toEqual({ temporal: 'present', scope: 'wide', context: 'information' });
  });
});

describe('Prompt structure — TAGS block, skip bullet, and cache-safe ORIENTING footer', () => {
  it('always includes the TAGS block and the orienting-context skip bullet', () => {
    const system = selfSystem();
    expect(system).toContain('TAGS — every memory object MUST carry exactly one value from each axis.');
    expect(system).toContain('Never extract a memory whose only source is the ORIENTING CONTEXT block.');
  });

  it('omits the ORIENTING CONTEXT block entirely when no context is supplied', () => {
    const system = selfSystem();
    expect(system).not.toContain('ORIENTING CONTEXT — background only');
  });

  it('renders the ORIENTING CONTEXT footer after the body and before the CONTEXT footer', () => {
    const system = selfSystem({ projectDescription: 'My project desc', chatContextSummary: 'The story summary' });
    expect(system).toContain('ORIENTING CONTEXT — background only, never a source of memories');
    expect(system).toContain('PROJECT: My project desc');
    expect(system).toContain('STORY SO FAR: The story summary');
    // The footer must sit between the body's TAGS block and the CONTEXT/SUBJECT block.
    const tagsAt = system.indexOf('TAGS — every memory object');
    const orientingAt = system.indexOf('ORIENTING CONTEXT — background only');
    const contextAt = system.indexOf('\nCONTEXT\nSUBJECT:');
    expect(tagsAt).toBeGreaterThanOrEqual(0);
    expect(orientingAt).toBeGreaterThan(tagsAt);
    expect(contextAt).toBeGreaterThan(orientingAt);
  });

  it('keeps the cached body prefix byte-identical with and without orienting context', () => {
    const without = selfSystem();
    const withCtx = selfSystem({ projectDescription: 'My project desc', chatContextSummary: 'The story summary' });
    // The body ends at this literal line; everything up to it is the cacheable prefix.
    const marker = 'the bar, return [].';
    const idxWithout = without.indexOf(marker);
    const idxWith = withCtx.indexOf(marker);
    expect(idxWithout).toBeGreaterThanOrEqual(0);
    expect(idxWith).toBeGreaterThanOrEqual(0);
    expect(withCtx.slice(0, idxWith)).toBe(without.slice(0, idxWithout));
  });

  it('truncates an over-long project description to 1500 chars with an ellipsis', () => {
    const long = 'x'.repeat(2000);
    const system = selfSystem({ projectDescription: long, chatContextSummary: null });
    expect(system).toContain(`PROJECT: ${'x'.repeat(1500)}…`);
    expect(system).not.toContain('x'.repeat(1501));
  });
});

describe('agreements, proposals, and conditions (anti-committee §8.3)', () => {
  it('SELF prompt carries the AGREEMENTS section between WHAT TO SKIP and DEDUPLICATION', () => {
    const system = selfSystem();
    const skip = system.indexOf('WHAT TO SKIP');
    const agreements = system.indexOf('AGREEMENTS, PROPOSALS, AND CONDITIONS');
    const dedup = system.indexOf('DEDUPLICATION');
    expect(skip).toBeGreaterThan(-1);
    expect(agreements).toBeGreaterThan(skip);
    expect(dedup).toBeGreaterThan(agreements);
    expect(system).toContain('had not yet responded');
    expect(system).toContain('(one the subject spoke');
  });

  it('OTHER prompt carries the AGREEMENTS section, the spoken-assent hinge, and the 0.55 anchor', () => {
    const system = otherSystem();
    expect(system).toContain('AGREEMENTS, PROPOSALS, AND CONDITIONS');
    expect(system).toContain('agreement (spoken by the agreeing');
    expect(system).toContain('A proposal made TO the subject is not the subject\'s');
    expect(system).toMatch(/0\.55 {2}A proposal, condition, or demand the subject stated, not yet\s+answered\./);
    expect(system).toContain('Charlie had not yet responded when the exchange ended');
    expect(system).toContain('recording assent invents');
  });

  it('TAGS block reserves `future` for the speaker\'s own intent', () => {
    expect(selfSystem()).toContain("a proposal awaiting someone\n                      else's answer is `moment`");
  });
});
