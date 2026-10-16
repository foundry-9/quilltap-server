/**
 * `runCustomTool` — the one sequence every custom-tool entrance deals through.
 *
 * The execution core stays real (the outcome table is part of the assertion);
 * the cascade, the applier and the writers are mocked so the ORDER and the
 * provenance can be observed.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/state/state-cascade', () => ({
  resolveStateCascade: jest.fn(),
}));

jest.mock('@/lib/pascal/side-effects', () => ({
  applyCustomToolEffects: jest.fn(),
}));

jest.mock('@/lib/services/pascal/writer', () => ({
  buildPascalResultContent: jest.fn(({ toolTitle, message }: any) => ({
    content: `${toolTitle} — ${message}`,
    opaqueContent: `${toolTitle} — ${message}`,
  })),
  postPascalResult: jest.fn(),
}));

import { runCustomTool, type RunCustomToolParams } from '@/lib/pascal/run-service';
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types';
import type { DiscoveredCustomTool } from '@/lib/pascal/custom-tools';
import { resolveStateCascade } from '@/lib/state/state-cascade';
import { applyCustomToolEffects } from '@/lib/pascal/side-effects';
import { postPascalResult } from '@/lib/services/pascal/writer';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const cascadeMock = resolveStateCascade as jest.Mock;
const applyMock = applyCustomToolEffects as jest.Mock;
const postMock = postPascalResult as jest.Mock;

const CHAT_ID = 'chat-1';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';

const DEFINITION = QtapCustomToolSchema.parse({
  name: 'counter',
  description: 'Count something.',
  roll: { min: 0.5, max: 0.5 },
  outcomes: [{ when: true, message: 'It ticks.', state: 'success' }],
  effects: [{ target: 'state.ticks', value: 1 }],
});

const ENTRY: DiscoveredCustomTool = {
  definition: DEFINITION,
  tier: 'project',
  mountPointId: 'mp-1',
  mountName: 'Project Store',
  definitionPath: 'Tools/counter.tool.json',
} as DiscoveredCustomTool;

function params(overrides: Partial<RunCustomToolParams> = {}): RunCustomToolParams {
  return {
    userId: 'user-1',
    chatId: CHAT_ID,
    chat: { id: CHAT_ID } as never,
    entry: ENTRY,
    parameters: null,
    private: undefined,
    characterId: null,
    metadata: {},
    whisperTargetIds: null,
    invokedBy: 'llm',
    callerParticipantId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  cascadeMock.mockResolvedValue({ merged: {}, chatState: {}, projectState: {}, groupState: {}, generalState: {} });
  applyMock.mockResolvedValue([{ target: 'state.ticks', next: 1, tier: 'chat' }]);
  postMock.mockResolvedValue({ id: 'pascal-msg' });
});

describe('runCustomTool', () => {
  it('deals against {} when the cascade cannot be read', async () => {
    cascadeMock.mockRejectedValue(new Error('store gone'));
    const outcome = await runCustomTool(params());
    expect(outcome.ok).toBe(true);
    expect(applyMock.mock.calls[0][0]).toMatchObject({ cascade: null });
  });

  it('reads the chat itself when the entrance did not hand one over', async () => {
    const findById = jest.fn().mockResolvedValue({ id: CHAT_ID });
    getRepositoriesMock.mockReturnValue({ chats: { findById } });
    await runCustomTool(params({ chat: undefined }));
    expect(findById).toHaveBeenCalledWith(CHAT_ID);
    expect(cascadeMock).toHaveBeenCalled();
  });

  it('scopes the group tier to the rolling character, or to none', async () => {
    await runCustomTool(params({ characterId: 'char-1' }));
    expect(cascadeMock.mock.calls[0][0].groupScope).toEqual({ kind: 'character', characterId: 'char-1' });
    await runCustomTool(params());
    expect(cascadeMock.mock.calls[1][0].groupScope).toEqual({ kind: 'none' });
  });

  it('applies effects before posting', async () => {
    const order: string[] = [];
    applyMock.mockImplementation(async () => { order.push('effects'); return []; });
    postMock.mockImplementation(async () => { order.push('post'); return { id: 'm' }; });
    await runCustomTool(params());
    expect(order).toEqual(['effects', 'post']);
  });

  it('leaves the effects standing when the post fails', async () => {
    postMock.mockResolvedValue(null);
    const outcome = await runCustomTool(params());
    expect(outcome).toMatchObject({ ok: true, posted: null });
    expect(outcome.ok && outcome.appliedEffects).toHaveLength(1);
  });

  it.each(['llm', 'user', 'trigger'] as const)('records invokedBy=%s in pascalMeta', async (invokedBy) => {
    await runCustomTool(params({ invokedBy, triggerPhrase: 'abracadabra', callerParticipantId: PARTICIPANT_ID }));
    const meta = postMock.mock.calls[0][0].pascalMeta;
    expect(meta.invokedBy).toBe(invokedBy);
    expect(meta.callerParticipantId).toBe(PARTICIPANT_ID);
    if (invokedBy === 'trigger') expect(meta.triggerPhrase).toBe('abracadabra');
    else expect(meta.triggerPhrase).toBeUndefined();
  });

  it('whispers to the given targets only when the run is private', async () => {
    await runCustomTool(params({ private: true, whisperTargetIds: [PARTICIPANT_ID] }));
    expect(postMock.mock.calls[0][0].targetParticipantIds).toEqual([PARTICIPANT_ID]);
    await runCustomTool(params({ private: false, whisperTargetIds: [PARTICIPANT_ID] }));
    expect(postMock.mock.calls[1][0].targetParticipantIds).toBeNull();
  });

  describe('the rolling character', () => {
    const NAMED = {
      ...ENTRY,
      definition: QtapCustomToolSchema.parse({
        name: 'suit_up',
        description: 'Suit up.',
        outcomes: [{ when: true, message: '{{character}} is suited.', state: 'success' }],
      }),
    } as DiscoveredCustomTool;
    const ANNOUNCED = {
      ...NAMED,
      definition: { ...NAMED.definition, announceAsCharacter: true },
    } as DiscoveredCustomTool;

    it("renders {{character}} with the name the entrance supplied, without a read", async () => {
      const findByIdRaw = jest.fn();
      getRepositoriesMock.mockReturnValue({ characters: { findByIdRaw } });
      const outcome = await runCustomTool(params({ entry: NAMED, characterId: 'char-1', characterName: 'Charlie' }));
      expect(outcome.ok && outcome.result.message).toBe('Charlie is suited.');
      expect(findByIdRaw).not.toHaveBeenCalled();
    });

    it('reads the name when the entrance did not supply one', async () => {
      const findByIdRaw = jest.fn().mockResolvedValue({ id: 'char-1', name: 'Charlie' });
      getRepositoriesMock.mockReturnValue({ characters: { findByIdRaw } });
      const outcome = await runCustomTool(params({ entry: NAMED, characterId: 'char-1' }));
      expect(findByIdRaw).toHaveBeenCalledWith('char-1');
      expect(outcome.ok && outcome.result.message).toBe('Charlie is suited.');
    });

    it('leaves {{character}} as written when the name cannot be read', async () => {
      getRepositoriesMock.mockReturnValue({
        characters: { findByIdRaw: jest.fn().mockRejectedValue(new Error('vault gone')) },
      });
      const outcome = await runCustomTool(params({ entry: NAMED, characterId: 'char-1' }));
      expect(outcome.ok && outcome.result.message).toBe('{{character}} is suited.');
    });

    it('posts under Pascal unless the tool says the character announces it', async () => {
      await runCustomTool(params({ entry: NAMED, characterId: 'char-1', characterName: 'Charlie' }));
      expect(postMock.mock.calls[0][0].announcerCharacterId).toBeUndefined();
    });

    it('hands the post to the rolling character when announceAsCharacter is on', async () => {
      await runCustomTool(params({ entry: ANNOUNCED, characterId: 'char-1', characterName: 'Charlie' }));
      expect(postMock.mock.calls[0][0].announcerCharacterId).toBe('char-1');
    });

    it('leaves a run nobody made with Pascal, even when announceAsCharacter is on', async () => {
      await runCustomTool(params({ entry: ANNOUNCED, characterId: null }));
      expect(postMock.mock.calls[0][0].announcerCharacterId).toBeUndefined();
    });
  });

  it('returns a refusal, without posting, when the run is refused', async () => {
    const outcome = await runCustomTool(params({ parameters: { nonsense: 1 } }));
    expect(outcome.ok).toBe(false);
    expect(postMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });
});
