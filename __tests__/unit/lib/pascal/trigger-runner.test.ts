/**
 * `runTriggeredCustomTools` — the gate, the speaker's perspective, the order of
 * the deal, and the failure path. The scanner is real; the roster, the run
 * service and the Prospero writer are mocked so what reaches them can be read.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/pascal/custom-tools', () => ({
  resolveCustomToolRoster: jest.fn(),
}));

jest.mock('@/lib/pascal/run-service', () => ({
  runCustomTool: jest.fn(),
}));

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoCustomToolError: jest.fn().mockResolvedValue(null),
}));

import { runTriggeredCustomTools, type RunTriggeredCustomToolsParams } from '@/lib/pascal/trigger-runner';
import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools';
import { runCustomTool } from '@/lib/pascal/run-service';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';
import { MAX_TRIGGER_RUNS_PER_MESSAGE } from '@/lib/pascal/trigger-phrases';
import { CharacterVaultUnavailableError } from '@/lib/database/repositories/vault-overlay/schema';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const rosterMock = resolveCustomToolRoster as jest.Mock;
const runMock = runCustomTool as jest.Mock;
const prosperoMock = postProsperoCustomToolError as jest.Mock;

const PARTICIPANT_ID = 'participant-1';
const CHARACTER_ID = 'char-1';
const ON = { customTools: true, customToolTriggers: true };

function entry(name: string, triggers: string[], defaultVisibility: 'public' | 'whisper' = 'public') {
  return {
    definition: { name, description: '-', triggers, defaultVisibility, outcomes: [] },
    tier: 'project',
    mountPointId: 'mp-1',
    mountName: 'Store',
    definitionPath: `Tools/${name}.tool.json`,
  };
}

function wireRoster(entries: ReturnType<typeof entry>[]) {
  rosterMock.mockResolvedValue({
    tools: new Map(entries.map((e) => [e.definition.name, e])),
    errors: [],
    droppedForCap: [],
  });
}

const findById = jest.fn();

function params(overrides: Partial<RunTriggeredCustomToolsParams> = {}): RunTriggeredCustomToolsParams {
  return {
    userId: 'user-1',
    chatId: 'chat-1',
    content: 'Abracadabra!',
    speaker: { participantId: PARTICIPANT_ID, characterId: CHARACTER_ID },
    projectId: 'proj-1',
    chatSettings: ON,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue({
    id: CHARACTER_ID,
    metadata: { blessed: true },
    characterDocumentMountPointId: 'vault-1',
  });
  getRepositoriesMock.mockReturnValue({ characters: { findById } });
  wireRoster([entry('spell', ['abracadabra'])]);
  runMock.mockImplementation(async (p: any) => ({
    ok: true,
    result: { state: 'success', visibility: 'public' },
    posted: { id: `posted-${p.entry.definition.name}` },
    appliedEffects: [],
  }));
});

describe('runTriggeredCustomTools — the gate', () => {
  it('does nothing, and reads nothing, when the trigger switch is off', async () => {
    expect(await runTriggeredCustomTools(params({ chatSettings: { customTools: true, customToolTriggers: false } }))).toEqual([]);
    expect(await runTriggeredCustomTools(params({ chatSettings: null }))).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('does nothing when the Custom Tools master switch is off', async () => {
    expect(await runTriggeredCustomTools(params({ chatSettings: { customTools: false, customToolTriggers: true } }))).toEqual([]);
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('does nothing for blank content', async () => {
    expect(await runTriggeredCustomTools(params({ content: '   ' }))).toEqual([]);
    expect(rosterMock).not.toHaveBeenCalled();
  });
});

describe('runTriggeredCustomTools — perspective', () => {
  it("resolves a character speaker's roster through their own sheet and vault", async () => {
    await runTriggeredCustomTools(params());
    expect(rosterMock.mock.calls[0][0]).toMatchObject({
      characterId: CHARACTER_ID,
      characterMountPointId: 'vault-1',
      projectId: 'proj-1',
      metadata: { blessed: true },
    });
    // Another participant's vault is never part of the speaker's roster.
    expect(rosterMock.mock.calls[0][0]).not.toHaveProperty('characterIds');
    expect(runMock.mock.calls[0][0]).toMatchObject({ characterId: CHARACTER_ID, metadata: { blessed: true } });
  });

  it('rolls the bare operator against an empty sheet, as nobody', async () => {
    await runTriggeredCustomTools(params({ speaker: { participantId: null, characterId: null } }));
    expect(findById).not.toHaveBeenCalled();
    expect(rosterMock.mock.calls[0][0]).toMatchObject({ characterId: null, characterMountPointId: null, metadata: {} });
    expect(runMock.mock.calls[0][0]).toMatchObject({ characterId: null, metadata: {}, whisperTargetIds: ['user-1'] });
  });

  it('fires nothing, and posts nothing, when the speaker’s vault is broken', async () => {
    findById.mockRejectedValue(new CharacterVaultUnavailableError(CHARACTER_ID, 'gone'));
    expect(await runTriggeredCustomTools(params())).toEqual([]);
    expect(runMock).not.toHaveBeenCalled();
    expect(prosperoMock).not.toHaveBeenCalled();
  });
});

describe('runTriggeredCustomTools — the deal', () => {
  it('runs each hit in order of appearance, with defaults and trigger provenance', async () => {
    wireRoster([entry('oracle', ['consult the oracle']), entry('initiative', ['draw my sword'])]);
    const onPosted = jest.fn();
    const posted = await runTriggeredCustomTools(params({ content: 'I draw my sword, then consult the oracle.', onPosted }));

    expect(runMock.mock.calls.map((c) => c[0].entry.definition.name)).toEqual(['initiative', 'oracle']);
    expect(runMock.mock.calls[0][0]).toMatchObject({
      parameters: null,
      private: undefined,
      invokedBy: 'trigger',
      triggerPhrase: 'draw my sword',
      callerParticipantId: PARTICIPANT_ID,
      whisperTargetIds: [PARTICIPANT_ID],
    });
    // One clock reading for every run this message fires.
    expect(runMock.mock.calls[0][0].nowMs).toBe(runMock.mock.calls[1][0].nowMs);
    expect(posted.map((m) => m.id)).toEqual(['posted-initiative', 'posted-oracle']);
    expect(onPosted).toHaveBeenCalledTimes(2);
  });

  it('caps fired tools per message', async () => {
    const entries = Array.from({ length: MAX_TRIGGER_RUNS_PER_MESSAGE + 1 }, (_, i) => entry(`t${i}`, [`word${i}`]));
    wireRoster(entries);
    await runTriggeredCustomTools(params({ content: entries.map((_, i) => `word${i}`).join(' ') }));
    expect(runMock).toHaveBeenCalledTimes(MAX_TRIGGER_RUNS_PER_MESSAGE);
  });

  it('reports a refused run through Prospero and carries on with the next', async () => {
    wireRoster([entry('broken', ['first'], 'whisper'), entry('fine', ['second'])]);
    runMock
      .mockResolvedValueOnce({ ok: false, reason: 'no such parameter', whisper: true })
      .mockResolvedValueOnce({ ok: true, result: { state: 'success', visibility: 'public' }, posted: { id: 'p2' }, appliedEffects: [] });

    const posted = await runTriggeredCustomTools(params({ content: 'first and second' }));

    expect(prosperoMock).toHaveBeenCalledWith({
      chatId: 'chat-1',
      toolName: 'broken',
      reason: 'no such parameter',
      whisper: true,
      callerParticipantId: PARTICIPANT_ID,
    });
    expect(posted.map((m) => m.id)).toEqual(['p2']);
  });

  it('survives a run that throws', async () => {
    runMock.mockRejectedValueOnce(new Error('boom'));
    expect(await runTriggeredCustomTools(params())).toEqual([]);
    expect(prosperoMock).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'spell', reason: 'boom' }));
  });

  it('never throws, even when the roster cannot be resolved', async () => {
    rosterMock.mockRejectedValue(new Error('index offline'));
    await expect(runTriggeredCustomTools(params())).resolves.toEqual([]);
  });

  it('ignores a Carina query line', async () => {
    expect(await runTriggeredCustomTools(params({ content: '@Alice: abracadabra' }))).toEqual([]);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('runTriggeredCustomTools — a storyteller turn’s effect ceiling (D9)', () => {
  function writingEntry(name: string, triggers: string[]) {
    const e = entry(name, triggers);
    return { ...e, definition: { ...e.definition, effects: [{ target: 'state.door', value: 'open' }] } };
  }

  it('skips a matched tool whose effects exceed the ceiling, without posting', async () => {
    wireRoster([writingEntry('spell', ['abracadabra'])]);
    expect(await runTriggeredCustomTools(params({ effectCeiling: 'read' }))).toEqual([]);
    expect(runMock).not.toHaveBeenCalled();
    expect(prosperoMock).not.toHaveBeenCalled();
  });

  it('runs a read tool under a read ceiling, and a write tool under a write ceiling', async () => {
    wireRoster([entry('peek', ['abracadabra'])]);
    expect(await runTriggeredCustomTools(params({ effectCeiling: 'read' }))).toHaveLength(1);
    wireRoster([writingEntry('spell', ['abracadabra'])]);
    expect(await runTriggeredCustomTools(params({ effectCeiling: 'write' }))).toHaveLength(1);
  });
});

describe('runTriggeredCustomTools — operator intervention', () => {
  it('lets the run hold, and treats a veto as a run that posted nothing', async () => {
    runMock.mockResolvedValue({ ok: 'vetoed' });
    const onPosted = jest.fn();
    expect(await runTriggeredCustomTools(params({ onPosted }))).toEqual([]);
    expect(runMock.mock.calls[0][0].mayHold).toBe(true);
    expect(onPosted).not.toHaveBeenCalled();
    expect(prosperoMock).not.toHaveBeenCalled();
  });
});
