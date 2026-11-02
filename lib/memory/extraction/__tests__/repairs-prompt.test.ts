/**
 * Mechanism 7 of the probation spec: offenses were extracted at 0.85–0.95 and
 * the later forgiveness had no rule, so a character's book filled with hurts
 * and no resolutions. These tests lock the repair instructions into every body
 * that reads seat lines. See docs/developer/features/prompt-trust-the-probation.md §9.
 *
 * As with the consent regression beside it, this proves the instruction is
 * sent, not that a model obeys it — the live eval (§11.2) measures that.
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

import { buildSelfTurnMessages } from '../prompts/self';
import { buildOtherTurnMessages } from '../prompts/other';
import { buildEpisodeFoldMessages } from '../prompts/episode';
import { REPAIRS_INSTRUCTION_BLOCK } from '../prompts/shared';
import { passCap, HARD_CANDIDATE_CAP } from '../parse';
import {
  buildProposalNoReplyTranscript,
  fridaySubjects,
  FRIDAY_ID,
  OWEN_ID,
} from '@/__tests__/unit/lib/fixtures/proposal-no-reply';

function systemOf(messages: Array<{ role: string; content: unknown }> | null | undefined): string {
  return messages!.find((m) => m.role === 'system')!.content as string;
}

function selfSystem(): string {
  return systemOf(
    buildSelfTurnMessages({
      transcript: buildProposalNoReplyTranscript(),
      holderId: OWEN_ID,
      canonBlock: 'CANON',
      cap: passCap(HARD_CANDIDATE_CAP, undefined),
      inAutonomousRoom: false,
    }),
  );
}

function otherSystem(): string {
  const t = buildProposalNoReplyTranscript();
  const friday = t.characterSlices.find((s) => s.characterId === FRIDAY_ID)!;
  return systemOf(
    buildOtherTurnMessages({
      transcript: t,
      observer: { name: friday.characterName, pronouns: friday.characterPronouns ?? null },
      subjects: fridaySubjects,
      cap: passCap(HARD_CANDIDATE_CAP, 16000),
      inAutonomousRoom: false,
    }),
  );
}

describe('repairs and resolutions in memory extraction', () => {
  it('the shared block makes a repair a hinge and refuses manufactured forgiveness', () => {
    expect(REPAIRS_INSTRUCTION_BLOCK).toMatch(/a repair is a hinge/);
    expect(REPAIRS_INSTRUCTION_BLOCK).toMatch(/at least as important as the hurt it resolves/);
    expect(REPAIRS_INSTRUCTION_BLOCK).toMatch(/An apology alone is not\s+forgiveness/);
    expect(REPAIRS_INSTRUCTION_BLOCK).toMatch(/not provisional/);
  });

  it('SELF carries the block and a repair anchor, but not the observer reliability carve-out', () => {
    const system = selfSystem();
    expect(system).toContain(REPAIRS_INSTRUCTION_BLOCK);
    expect(system).toMatch(/or made a repair: forgave, accepted an\s+apology, or made amends/);
    expect(system).not.toMatch(/Kept promises/);
  });

  it('OTHER carries the block, a repair anchor, and the reliability carve-out', () => {
    const system = otherSystem();
    expect(system).toContain(REPAIRS_INSTRUCTION_BLOCK);
    expect(system).toMatch(/A repair — forgiveness given or an apology\s+accepted — is scored at least as high/);
    expect(system).toMatch(/Kept promises,\s+a time the subject turned out to be right/);
  });

  it('the episode pass records a repair that ended the episode', () => {
    const messages = buildEpisodeFoldMessages({
      stretch: [],
      clock: { timelineMode: 'real', nowIso: '2026-11-01T12:00:00.000Z' } as any,
    });
    expect(systemOf(messages)).toMatch(/ended in a repair/);
  });
});
