/**
 * Operator intervention — the four route actions, through the real route module.
 *
 * The registry is populated directly with `hold(...)` (a real definition, a
 * baseline from the real engine); only the model call (`llm-consult`), the
 * realtime bus and the middleware wrappers are doubled. These pin what the
 * dialog depends on: the list is per-chat, preview is pure and recomputed
 * server-side, a hidden field is a 400 rather than a quiet drop, first resolve
 * wins, and another chat's hold is simply not found (and not touched).
 */

import { GET, POST } from '@/app/api/v1/chats/[id]/custom-tools/route';
import { executeCustomTool, type LlmConsultResult } from '@/lib/pascal/custom-tools';
import { QtapCustomToolSchema, type QtapCustomTool } from '@/lib/pascal/custom-tool.types';
import {
  getIntervention,
  hold,
  interventionStatus,
  listInterventions,
  resetInterventionRegistryForTests,
  type InterventionDecision,
} from '@/lib/pascal/intervention/registry';
import type { RunSnapshot } from '@/lib/pascal/intervention/recompute';
import { buildCustomToolLlmInvoker } from '@/lib/pascal/llm-consult';
import { publishRealtime } from '@/lib/realtime/bus';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler: (handler: unknown) => handler,
}));

jest.mock('@/lib/pascal/llm-consult', () => ({
  buildCustomToolLlmInvoker: jest.fn(),
}));

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}));

jest.mock('@/lib/services/pascal/writer', () => ({
  buildPascalResultContent: jest.fn(() => ({ content: 'c', opaqueContent: null })),
  postPascalResult: jest.fn(),
}));

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoCustomToolError: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function define(doc: unknown): QtapCustomTool {
  const parsed = QtapCustomToolSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`fixture is not a valid definition: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}

function wagerDefinition(extra: Record<string, unknown> = {}): QtapCustomTool {
  return define({
    name: 'wager',
    description: 'A modest wager.',
    roll: { min: 0, max: 100 },
    parameters: {
      bonus: { type: 'number', default: 0, min: 0, max: 10 },
      locked: { type: 'number', default: 0, intervene: false },
    },
    outcomes: [
      { when: { gte: 50 }, message: 'The house pays out at {{value}}.', state: 'success' },
      { when: true, message: 'The house keeps it at {{value}}.', state: 'failure' },
    ],
    intervention: { enabled: true },
    ...extra,
  });
}

function oracleDefinition(): QtapCustomTool {
  return wagerDefinition({
    name: 'oracle',
    llm: { prompt: 'Bonus is {{params.bonus}}. Answer.', errorMessage: 'No reading.' },
    outcomes: [
      { when: { llm: { eq: 'YES' } }, message: 'It assents: {{llm}}', state: 'success' },
      { when: true, message: 'It demurs: {{llm}}', state: 'partial' },
    ],
  });
}

const SNAPSHOT: RunSnapshot = {
  params: null,
  private: undefined,
  metadata: {},
  progress: {},
  now: 1_000,
  character: null,
  state: {},
  inventory: null,
};

const FIRST_CONSULT: LlmConsultResult = { ok: true, output: 'YES', prompt: 'Bonus is 0. Answer.' };

/** Deal the tool for real, then hold it for the given chat. */
async function holdRun(
  chatId: string,
  definition: QtapCustomTool = wagerDefinition(),
  consult?: LlmConsultResult
): Promise<{ id: string; decision: Promise<InterventionDecision> }> {
  const baseline = await executeCustomTool(definition, null, {
    metadata: SNAPSHOT.metadata,
    progress: SNAPSHOT.progress,
    now: SNAPSHOT.now,
    state: SNAPSHOT.state,
    inventory: null,
    draw: { form: 'range', unit: 0.7 },
    ...(consult ? { consult } : {}),
  });
  return hold({
    chatId,
    userId: 'user-1',
    entrance: 'llm',
    characterId: null,
    characterName: null,
    definition,
    definitionTier: 'global',
    definitionMountId: 'mount-1',
    snapshot: SNAPSHOT,
    draw: baseline.draw,
    baseline,
    consults: consult ? [consult] : [],
  });
}

function req(chatId: string, action: string, body?: unknown) {
  const url = `http://localhost/api/v1/chats/${chatId}/custom-tools${action ? `?action=${action}` : ''}`;
  return { url, nextUrl: new URL(url), json: async () => body } as never;
}

const ctx = { user: { id: 'user-1' }, repos: {} } as never;

type Handler = (r: unknown, c: unknown, p: unknown) => Promise<Response>;
const get = (chatId: string, action: string) => (GET as unknown as Handler)(req(chatId, action), ctx, { id: chatId });
const post = (chatId: string, action: string, body: unknown) =>
  (POST as unknown as Handler)(req(chatId, action, body), ctx, { id: chatId });

beforeEach(() => {
  jest.clearAllMocks();
  resetInterventionRegistryForTests();
});

afterEach(() => {
  resetInterventionRegistryForTests();
});

// ---------------------------------------------------------------------------
// GET ?action=interventions
// ---------------------------------------------------------------------------

describe('GET ?action=interventions', () => {
  it("lists this chat's holds only, oldest first", async () => {
    const a = await holdRun('chat-1');
    await holdRun('chat-2');
    const c = await holdRun('chat-1');

    const res = await get('chat-1', 'interventions');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.holds.map((h: { id: string }) => h.id);
    expect([...ids].sort()).toEqual([a.id, c.id].sort());
    const stamps = body.holds.map((h: { createdAt: number }) => h.createdAt);
    expect(stamps).toEqual([...stamps].sort((x: number, y: number) => x - y));
    expect(body.holds).toHaveLength(2);
    expect(body.holds[0]).toMatchObject({ tool: 'wager', entrance: 'llm', hasCharacter: false });
  });

  it('answers an empty list for a chat with nothing held', async () => {
    await holdRun('chat-2');
    const body = await (await get('chat-1', 'interventions')).json();
    expect(body.holds).toEqual([]);
  });

  it('carries the eligible set, honouring the author\'s flags', async () => {
    await holdRun('chat-1', wagerDefinition({ intervention: { enabled: true, fields: { roll: false } } }));
    const { holds } = await (await get('chat-1', 'interventions')).json();
    expect(holds[0].eligible.fields).not.toContain('roll');
    expect(holds[0].eligible.fields).toContain('outcome');
    expect(holds[0].eligible.params).toEqual(['bonus']);
  });
});

// ---------------------------------------------------------------------------
// POST ?action=intervention-preview
// ---------------------------------------------------------------------------

describe('POST ?action=intervention-preview', () => {
  it('recomputes under the overrides and writes nothing', async () => {
    const { id } = await holdRun('chat-1');
    jest.mocked(publishRealtime).mockClear();

    const res = await post('chat-1', 'intervention-preview', { id, overrides: { outcomeIndex: 1 } });
    expect(res.status).toBe(200);
    const { preview } = await res.json();
    expect(preview.run.message).toBe('The house keeps it at 70.');
    expect(preview.run.state).toBe('failure');
    expect(preview.run.outcomeIndex).toBe(1);
    expect(preview.run.tableOutcomeIndex).toBe(0);

    // Pure: still pending, baseline untouched, no realtime hint, no decision.
    expect(interventionStatus(id)).toBe('pending');
    expect(getIntervention(id)!.baseline.message).toBe('The house pays out at 70.');
    expect(publishRealtime).not.toHaveBeenCalled();
  });

  it('keeps the recorded luck when a parameter changes', async () => {
    const { id } = await holdRun('chat-1');
    const { preview } = await (
      await post('chat-1', 'intervention-preview', { id, overrides: { params: { bonus: 4 } } })
    ).json();
    expect(preview.run.params.bonus).toBe(4);
    // Same unit draw (0.7) on the same bounds: same value.
    expect(preview.run.value).toBe(70);
  });

  it('refuses an override naming a field the author hid (400)', async () => {
    const { id } = await holdRun(
      'chat-1',
      wagerDefinition({ intervention: { enabled: true, fields: { roll: false } } })
    );
    const res = await post('chat-1', 'intervention-preview', { id, overrides: { roll: 10 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/roll/);
  });

  it('refuses an override of a parameter flagged intervene: false (400)', async () => {
    const { id } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-preview', { id, overrides: { params: { locked: 3 } } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/locked/);
  });

  it('refuses an outcome row the table does not have (400)', async () => {
    const { id } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-preview', { id, overrides: { outcomeIndex: 9 } });
    expect(res.status).toBe(400);
  });

  it('refuses a malformed body (400) and an unknown override key', async () => {
    const { id } = await holdRun('chat-1');
    expect((await post('chat-1', 'intervention-preview', { id, overrides: { nonsense: 1 } })).status).toBe(400);
    expect((await post('chat-1', 'intervention-preview', { overrides: {} })).status).toBe(400);
  });

  it('404s an unknown id', async () => {
    const res = await post('chat-1', 'intervention-preview', { id: 'nope', overrides: {} });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST ?action=intervention-reask
// ---------------------------------------------------------------------------

describe('POST ?action=intervention-reask', () => {
  it('poses the consult through the invoker builder and adds a consult', async () => {
    const invoke = jest.fn(async () => ({ ok: true as const, output: 'NO' }));
    jest.mocked(buildCustomToolLlmInvoker).mockReturnValue(invoke as never);
    const { id } = await holdRun('chat-1', oracleDefinition(), FIRST_CONSULT);

    const res = await post('chat-1', 'intervention-reask', { id, overrides: { params: { bonus: 3 } } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(buildCustomToolLlmInvoker).toHaveBeenCalledWith({ userId: 'user-1', chatId: 'chat-1' });
    // The prompt is the one rendered under the overrides, not the stale one.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0] as unknown as [string])[0]).toBe('Bonus is 3. Answer.');
    expect(getIntervention(id)!.consults).toHaveLength(2);
    expect(body.consults).toHaveLength(2);
    expect(body.consults[1]).toMatchObject({ ok: true, output: 'NO' });
    // The recompute uses the fresh answer.
    expect(body.preview.run.message).toBe('It demurs: NO');
    expect(body.preview.staleAnswer).toBe(false);
    expect(interventionStatus(id)).toBe('pending');
  });

  it('unpins a pinned answer: a fresh answer replaces it', async () => {
    jest.mocked(buildCustomToolLlmInvoker).mockReturnValue((async () => ({ ok: true, output: 'NO' })) as never);
    const { id } = await holdRun('chat-1', oracleDefinition(), FIRST_CONSULT);
    const res = await post('chat-1', 'intervention-reask', {
      id,
      overrides: { llmAnswer: { ok: true, output: 'YES' } },
    });
    const body = await res.json();
    expect(body.preview.run.message).toBe('It demurs: NO');
  });

  it('refuses a tool that consults no model (400)', async () => {
    const { id } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-reask', { id, overrides: {} });
    expect(res.status).toBe(400);
    expect(buildCustomToolLlmInvoker).not.toHaveBeenCalled();
  });

  it('refuses a consult the author hid (400)', async () => {
    const hidden = wagerDefinition({
      name: 'oracle',
      llm: { prompt: 'Answer.', errorMessage: 'No reading.' },
      outcomes: [{ when: true, message: 'x {{llm}}', state: 'info' }],
      intervention: { enabled: true, fields: { llmPrompt: false, llmAnswer: false } },
    });
    const { id } = await holdRun('chat-1', hidden, { ok: true, output: 'YES', prompt: 'Answer.' });
    const res = await post('chat-1', 'intervention-reask', { id, overrides: {} });
    expect(res.status).toBe(400);
  });

  it("404s another chat's hold", async () => {
    const { id } = await holdRun('chat-2', oracleDefinition(), FIRST_CONSULT);
    const res = await post('chat-1', 'intervention-reask', { id, overrides: {} });
    expect(res.status).toBe(404);
    expect(buildCustomToolLlmInvoker).not.toHaveBeenCalled();
    expect(getIntervention(id)!.consults).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST ?action=intervention-resolve
// ---------------------------------------------------------------------------

describe('POST ?action=intervention-resolve', () => {
  it('deal: recomputes server-side and settles with the recomputed run', async () => {
    const { id, decision } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-resolve', {
      id,
      decision: { kind: 'deal', overrides: { outcomeIndex: 1 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).resolved).toBe('deal');

    const settled = await decision;
    expect(settled.kind).toBe('deal');
    if (settled.kind !== 'deal') throw new Error('unreachable');
    expect(settled.overrides).toEqual({ outcomeIndex: 1 });
    expect(settled.run.result.message).toBe('The house keeps it at 70.');
    expect(settled.reasks).toBe(0);
    expect(interventionStatus(id)).toBe('settled');
    expect(listInterventions('chat-1')).toHaveLength(0);
  });

  it('deal: counts re-asks beyond the original consult', async () => {
    jest.mocked(buildCustomToolLlmInvoker).mockReturnValue((async () => ({ ok: true, output: 'NO' })) as never);
    const { id, decision } = await holdRun('chat-1', oracleDefinition(), FIRST_CONSULT);
    await post('chat-1', 'intervention-reask', { id, overrides: {} });
    await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'deal', overrides: {} } });
    const settled = await decision;
    expect(settled.kind === 'deal' && settled.reasks).toBe(1);
  });

  it('deal: refuses a hidden field (400) and leaves the hold pending', async () => {
    const { id } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-resolve', {
      id,
      decision: { kind: 'deal', overrides: { params: { locked: 1 } } },
    });
    expect(res.status).toBe(400);
    expect(interventionStatus(id)).toBe('pending');
  });

  it('as-rolled settles with kind as-rolled', async () => {
    const { id, decision } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'as-rolled' } });
    expect(res.status).toBe(200);
    expect((await res.json()).resolved).toBe('as-rolled');
    expect(await decision).toEqual({ kind: 'as-rolled' });
  });

  it('veto settles as a dialog veto', async () => {
    const { id, decision } = await holdRun('chat-1');
    const res = await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'veto' } });
    expect(res.status).toBe(200);
    expect((await res.json()).resolved).toBe('veto');
    expect(await decision).toEqual({ kind: 'veto', cause: 'dialog' });
  });

  it('a second resolve is a 409 and the first decision stands', async () => {
    const { id, decision } = await holdRun('chat-1');
    expect((await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'as-rolled' } })).status).toBe(200);
    const second = await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'veto' } });
    expect(second.status).toBe(409);
    expect(await decision).toEqual({ kind: 'as-rolled' });
  });

  it('404s an unknown id', async () => {
    const res = await post('chat-1', 'intervention-resolve', { id: 'never-held', decision: { kind: 'veto' } });
    expect(res.status).toBe(404);
  });

  it("404s another chat's hold and does NOT settle it", async () => {
    const { id } = await holdRun('chat-2');
    const res = await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'veto' } });
    expect(res.status).toBe(404);
    expect(interventionStatus(id)).toBe('pending');
    expect(listInterventions('chat-2')).toHaveLength(1);
  });

  it('400s a malformed decision', async () => {
    const { id } = await holdRun('chat-1');
    expect((await post('chat-1', 'intervention-resolve', { id, decision: { kind: 'dance' } })).status).toBe(400);
    expect(interventionStatus(id)).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

describe('action dispatch', () => {
  it('400s an unknown ?action= on POST and on GET', async () => {
    expect((await post('chat-1', 'intervention-explode', {})).status).toBe(400);
    expect((await get('chat-1', 'intervention-explode')).status).toBe(400);
  });
});
