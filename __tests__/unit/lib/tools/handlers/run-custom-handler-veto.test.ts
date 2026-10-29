/**
 * `run_custom` — the operator set the table aside (operator intervention, I13).
 *
 * A veto is not a failure: no Prospero bubble. The model hears only that the
 * tool did not run, unless the caller already knows the chat is a game — a
 * `systemTransparency` character or a user-controlled seat — and a failed
 * transparency read counts as plain.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/pascal/custom-tools', () => {
  const actual = jest.requireActual('@/lib/pascal/custom-tools');
  return { ...actual, resolveCustomToolRoster: jest.fn() };
});

jest.mock('@/lib/pascal/run-service', () => ({ runCustomTool: jest.fn() }));

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoCustomToolError: jest.fn().mockResolvedValue(undefined),
}));

import { executeRunCustomTool, formatRunCustomResults } from '@/lib/tools/handlers/run-custom-handler';
import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools';
import { runCustomTool } from '@/lib/pascal/run-service';
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';
import { VETO_RESULT_PLAIN, VETO_RESULT_TRANSPARENT } from '@/lib/pascal/intervention/veto-result';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';

const DEFINITION = QtapCustomToolSchema.parse({
  name: 'pick',
  description: 'Pick the lock.',
  intervention: { enabled: true },
  outcomes: [{ when: true, message: 'Still locked.', state: 'failure' }],
});

function wire(options: { controlledBy?: 'llm' | 'user'; transparency?: boolean; rawThrows?: boolean }) {
  getRepositoriesMock.mockReturnValue({
    characters: {
      findById: jest.fn().mockResolvedValue({ id: CHARACTER_ID, metadata: {} }),
      findByIdRaw: options.rawThrows
        ? jest.fn().mockRejectedValue(new Error('vault gone'))
        : jest.fn().mockResolvedValue({ id: CHARACTER_ID, systemTransparency: options.transparency === true }),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        participants: [{ id: PARTICIPANT_ID, characterId: CHARACTER_ID, controlledBy: options.controlledBy ?? 'llm' }],
      }),
    },
  });
}

async function veto() {
  return executeRunCustomTool({ tool: 'pick' }, {
    userId: 'user-1',
    chatId: 'chat-1',
    characterId: CHARACTER_ID,
    callerParticipantId: PARTICIPANT_ID,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (resolveCustomToolRoster as jest.Mock).mockResolvedValue({
    tools: new Map([['pick', { definition: DEFINITION, tier: 'project', mountPointId: 'mp', mountName: 'S', definitionPath: 'Tools/pick.tool.json' }]]),
    errors: [],
    droppedForCap: [],
  });
  (runCustomTool as jest.Mock).mockResolvedValue({ ok: 'vetoed' });
});

describe('run_custom — a vetoed run', () => {
  it('asks the run service to hold', async () => {
    wire({});
    await veto();
    expect((runCustomTool as jest.Mock).mock.calls[0][0].mayHold).toBe(true);
  });

  it('tells a plain character only that the tool did not run, with no Prospero bubble', async () => {
    wire({});
    const out = await veto();
    expect(out).toEqual({ success: false, tool: 'pick', error: VETO_RESULT_PLAIN });
    expect(postProsperoCustomToolError).not.toHaveBeenCalled();
  });

  it('treats a failed transparency read as plain', async () => {
    wire({ rawThrows: true });
    expect((await veto()).error).toBe(VETO_RESULT_PLAIN);
  });

  it('tells a systemTransparency character the table is closed', async () => {
    wire({ transparency: true });
    expect((await veto()).error).toBe(VETO_RESULT_TRANSPARENT);
  });

  it('tells a user-controlled seat the table is closed', async () => {
    wire({ controlledBy: 'user' });
    expect((await veto()).error).toBe(VETO_RESULT_TRANSPARENT);
  });

  it('keeps the plain wording free of any hint of a game', () => {
    for (const word of ['table', 'game', 'pascal', 'operator']) {
      expect(VETO_RESULT_PLAIN.toLowerCase()).not.toContain(word);
    }
    expect(formatRunCustomResults({ success: false, tool: 'pick', error: VETO_RESULT_PLAIN })).toBe(
      'Custom tool error: The tool did not run.',
    );
  });
});
