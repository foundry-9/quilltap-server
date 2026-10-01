/**
 * Regression for mechanism 6 of the anti-committee spec (manufactured
 * consent in memory extraction). See
 * docs/developer/features/prompt-trust-and-anti-committee.md §10.2.
 *
 * What this can prove deterministically: the real transcript builder puts the
 * proposal last and the renderer tells the extractor the user's line came
 * first. What it cannot prove: that a model obeys. The parser is shown NOT to
 * filter invented assent — the prompt is the control (§8.5); the opt-in live
 * eval in __tests__/eval/memory-consent/ measures whether it holds.
 */

import {
  extractOtherMemoriesFromTurn,
  extractSelfMemoriesFromTurn,
  ORDERED_TURN_TRANSCRIPT_HEADING,
} from '../memory-tasks';

jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

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

import { executeCheapLLMTask } from '../core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';
import type { CheapLLMTaskResult, MemoryCandidate } from '../types';
import {
  buildProposalNoReplyTranscript,
  fridaySubjects,
  FRIDAY_ID,
  INVENTED_ASSENT_RESPONSE,
  OWEN_ID,
  PROPOSAL_LINE,
} from '@/__tests__/unit/lib/fixtures/proposal-no-reply';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

let nextResponse = '[]';

beforeEach(() => {
  jest.clearAllMocks();
  nextResponse = '[]';
  jest.mocked(executeCheapLLMTask).mockImplementation(
    async (_sel, _msgs, _uid, parse) =>
      ({ success: true, result: (parse as (c: string) => unknown)(nextResponse) }) as never,
  );
});

function lastMessages(): Array<{ role: string; content: string }> {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls;
  return calls[calls.length - 1][1] as Array<{ role: string; content: string }>;
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

  it('renders with the ordered heading, the proposal as the last line', async () => {
    await extractOtherMemoriesFromTurn(
      buildProposalNoReplyTranscript(), FRIDAY_ID, fridaySubjects, SELECTION, 'user-1', undefined, 'chat-1', 16000,
    );
    const user = lastMessages().find((m) => m.role === 'user')!.content;
    expect(user).toContain(ORDERED_TURN_TRANSCRIPT_HEADING);
    expect(user.trimEnd().endsWith(`${PROPOSAL_LINE}""`)).toBe(true);
    // The user's stage direction precedes every character line.
    expect(user.indexOf('checks the load')).toBeLessThan(user.indexOf('Friday sets her mug'));
  });

  it("gives Owen's own SELF pass the not-yet-responded preamble", async () => {
    await extractSelfMemoriesFromTurn(buildProposalNoReplyTranscript(), OWEN_ID, 'CANON', SELECTION, 'user-1');
    const system = lastMessages().find((m) => m.role === 'system')!.content;
    expect(system).toContain('the SUBJECT has not yet responded');
  });

  it('documents that the parser does not filter invented assent — the prompt is the control', async () => {
    nextResponse = INVENTED_ASSENT_RESPONSE;
    const res = (await extractOtherMemoriesFromTurn(
      buildProposalNoReplyTranscript(), FRIDAY_ID, fridaySubjects, SELECTION, 'user-1', undefined, 'chat-1', 16000,
    )) as CheapLLMTaskResult<Map<string, MemoryCandidate[]>>;
    const aboutOwen = res.result!.get(OWEN_ID) ?? [];
    expect(aboutOwen.map((c) => c.content)).toEqual([
      'Owen agreed that nothing fires without the household hearing it first',
      'Owen accepted the new household rule',
    ]);
  });
});
