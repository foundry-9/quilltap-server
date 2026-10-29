/**
 * The importance rubric every memory-writing prompt calibrates to
 * (inner-circle-recall.md Part A).
 *
 * Before the recalibration the SELF, OTHER and consolidation prompts gave 0.90
 * to "a commitment the subject spoke", so every "agreed to build X" landed
 * beside marriages and pregnancies, and the frozen archive's importance fill
 * became the newest build-session rows. These tests hold the four prompts to
 * one scale: the top band is life-and-bond facts, work agreements never sit
 * above the ceiling, and the prompts' own worked examples obey both.
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
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

// ── Subject ───────────────────────────────────────────────────────────────────
import { buildSelfTurnMessages } from '../prompts/self';
import { buildOtherTurnMessages, type OtherSubjectInput } from '../prompts/other';
import { buildEpisodeFoldMessages } from '../prompts/episode';
import {
  IMPORTANCE_FACT_NOT_TELLING_NOTE,
  IMPORTANCE_WORK_CEILING_NOTE,
  WORK_IMPORTANCE_CEILING,
} from '../prompts/shared';
import { CONSOLIDATION_SYSTEM_PROMPT } from '@/lib/memory/cheap-llm-tasks/consolidation-tasks';
import { passCap, HARD_CANDIDATE_CAP } from '../parse';
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript';

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

const CAP = passCap(HARD_CANDIDATE_CAP, 8000);

function systemOf(messages: Array<{ role: string; content: unknown }> | null): string {
  return messages!.find((m) => m.role === 'system')!.content as string;
}

const SELF = systemOf(buildSelfTurnMessages({
  transcript: TRANSCRIPT, holderId: 'obs', canonBlock: 'CANON', cap: CAP, inAutonomousRoom: false,
}));
const OTHER = systemOf(buildOtherTurnMessages({
  transcript: TRANSCRIPT, observer: { name: 'Friday', pronouns: null }, subjects: SUBJECTS, cap: CAP, inAutonomousRoom: false,
}));
const EPISODE = systemOf(buildEpisodeFoldMessages({
  stretch: [{ speaker: 'Friday', content: 'We filed the deed.', createdAt: '2026-10-21T13:00:00.000Z' }],
  clock: { nowIso: '2026-10-21T13:00:00.000Z', timelineMode: 'realtime', timeZone: 'UTC' },
}));

const RUBRICS: Array<[string, string]> = [
  ['SELF', SELF],
  ['OTHER', OTHER],
  ['episode', EPISODE],
  ['consolidation', CONSOLIDATION_SYSTEM_PROMPT],
];

/** The JSON array that follows "EXAMPLE — good extraction" in a prompt body. */
function goodExamples(prompt: string): Array<{ importance: number; context?: string; keywords?: string[] }> {
  const start = prompt.indexOf('EXAMPLE — good extraction');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = prompt.indexOf('[', start);
  const close = prompt.indexOf('\n]', open);
  return JSON.parse(prompt.slice(open, close + 2));
}

describe('importance rubric — one scale across every memory-writing prompt', () => {
  it('states the work ceiling at 0.65', () => {
    expect(WORK_IMPORTANCE_CEILING).toBe(0.65);
    expect(IMPORTANCE_WORK_CEILING_NOTE).toContain('never score above 0.65');
  });

  it.each(RUBRICS)('%s carries the work-ceiling note verbatim', (_name, prompt) => {
    expect(prompt).toContain(IMPORTANCE_WORK_CEILING_NOTE);
  });

  it.each(RUBRICS)('%s scores the fact, not the telling', (_name, prompt) => {
    expect(prompt).toContain(IMPORTANCE_FACT_NOT_TELLING_NOTE);
    // The rule must sit after the ladder it qualifies, not before it.
    expect(prompt.indexOf(IMPORTANCE_FACT_NOT_TELLING_NOTE)).toBeGreaterThan(prompt.indexOf('0.95'));
  });

  it('the fact-not-telling rule routes a revealed pregnancy to 0.95, not the revelation band', () => {
    expect(IMPORTANCE_FACT_NOT_TELLING_NOTE).toMatch(/pregnancy[^.]*is a 0\.95 fact/);
    expect(IMPORTANCE_FACT_NOT_TELLING_NOTE).toMatch(/revealed/);
    expect(IMPORTANCE_FACT_NOT_TELLING_NOTE).toMatch(/0\.85 band is for revelations whose content is not itself such a fact/);
  });

  it.each(RUBRICS)('%s reserves the top band for life-and-bond facts', (_name, prompt) => {
    expect(prompt).toMatch(/0\.95[^\n]*\n?[^\n]*(marriage|wedding)/);
    expect(prompt).toMatch(/pregnan/);
  });

  it.each(RUBRICS)('%s no longer anchors 0.90 to a spoken commitment', (_name, prompt) => {
    expect(prompt).not.toMatch(/0\.90[^\n]*commitment/);
    expect(prompt).not.toMatch(/0\.90\s+(The subject made a major|An explicit new commitment)/);
  });

  it.each([['SELF', SELF], ['OTHER', OTHER]])('%s anchors work agreements in passing at 0.45', (_name, prompt) => {
    expect(prompt).toMatch(/0\.45\s+[^\n]*work decision, ruling, or task agreement/);
  });
});

describe('importance rubric — the prompts\' own examples obey it', () => {
  it.each([['SELF', SELF], ['OTHER', OTHER]])('%s good examples above the ceiling are relationship facts only', (_name, prompt) => {
    const examples = goodExamples(prompt);
    const aboveCeiling = examples.filter((e) => e.importance > WORK_IMPORTANCE_CEILING);
    expect(aboveCeiling.length).toBeGreaterThan(0);
    for (const e of aboveCeiling) {
      expect(e.context).toBe('relationships');
    }
  });

  it.each([['SELF', SELF], ['OTHER', OTHER]])('%s scores its architecture example at or under the ceiling', (_name, prompt) => {
    const work = goodExamples(prompt).filter((e) =>
      (e.keywords ?? []).some((k) => ['architecture', 'summarizer', 'rename', 'cache'].includes(k)),
    );
    expect(work.length).toBeGreaterThan(0);
    for (const e of work) {
      expect(e.importance).toBeLessThanOrEqual(WORK_IMPORTANCE_CEILING);
    }
  });
});
