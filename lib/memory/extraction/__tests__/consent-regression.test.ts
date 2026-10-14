/**
 * Regression for mechanism 6 of the anti-committee spec (manufactured
 * consent in memory extraction). See
 * docs/developer/features/complete/prompt-trust-and-anti-committee.md §10.2.
 *
 * What this can prove deterministically: the real transcript builder puts the
 * proposal last and the renderer tells the extractor the user's line came
 * first. What it cannot prove: that a model obeys. The parser is shown NOT to
 * filter invented assent — the prompt is the control (§8.5); the opt-in live
 * eval in __tests__/eval/memory-consent/ measures whether it holds.
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
import { ORDERED_TURN_TRANSCRIPT_HEADING } from '../window';
import { parseOtherDraftsBySubject, passCap, HARD_CANDIDATE_CAP } from '../parse';
import {
  buildProposalNoReplyTranscript,
  fridaySubjects,
  FRIDAY_ID,
  INVENTED_ASSENT_RESPONSE,
  OWEN_ID,
  PROPOSAL_LINE,
} from '@/__tests__/unit/lib/fixtures/proposal-no-reply';

/** The per-subject cap the turn passes derive for a 16000-token output budget. */
const CAP = passCap(HARD_CANDIDATE_CAP, 16000);

function fridayOtherMessages(): Array<{ role: string; content: unknown }> {
  const t = buildProposalNoReplyTranscript();
  const friday = t.characterSlices.find((s) => s.characterId === FRIDAY_ID)!;
  return buildOtherTurnMessages({
    transcript: t,
    observer: { name: friday.characterName, pronouns: friday.characterPronouns ?? null },
    subjects: fridaySubjects,
    cap: CAP,
    inAutonomousRoom: false,
  });
}

describe('proposal-no-reply fixture', () => {
  it('builds a turn whose user line opens it and whose proposal closes it', () => {
    const t = buildProposalNoReplyTranscript();
    expect(t.characterSlices[0].characterId).toBe(OWEN_ID);
    expect(t.characterSlices[0].isUserControlled).toBe(true);
    const last = t.characterSlices[t.characterSlices.length - 1];
    // The proposal closes Amy's quoted speech, and nothing follows it.
    expect(last.text.endsWith(`${PROPOSAL_LINE}"`)).toBe(true);
  });

  it('renders with the ordered heading, the proposal as the last line', () => {
    const user = fridayOtherMessages().find((m) => m.role === 'user')!.content as string;
    expect(user).toContain(ORDERED_TURN_TRANSCRIPT_HEADING);
    expect(user.trimEnd().endsWith(`${PROPOSAL_LINE}""`)).toBe(true);
    // The user's stage direction precedes every character line.
    expect(user.indexOf('checks the load')).toBeLessThan(user.indexOf('Friday sets her mug'));
  });

  it("gives Owen's own SELF pass the not-yet-responded preamble", () => {
    const messages = buildSelfTurnMessages({
      transcript: buildProposalNoReplyTranscript(),
      holderId: OWEN_ID,
      canonBlock: 'CANON',
      cap: passCap(HARD_CANDIDATE_CAP, undefined),
      inAutonomousRoom: false,
    });
    const system = messages!.find((m) => m.role === 'system')!.content as string;
    expect(system).toContain('the SUBJECT has not yet responded');
  });

  it('documents that the parser does not filter invented assent — the prompt is the control', () => {
    const bySubject = parseOtherDraftsBySubject(INVENTED_ASSENT_RESPONSE, fridaySubjects.map((s) => s.id), CAP);
    const aboutOwen = bySubject.get(OWEN_ID) ?? [];
    expect(aboutOwen.map((c) => c.content)).toEqual([
      'Owen agreed that nothing fires without the household hearing it first',
      'Owen accepted the new household rule',
    ]);
  });
});
