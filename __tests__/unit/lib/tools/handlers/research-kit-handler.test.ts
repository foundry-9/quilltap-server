/** @jest-environment node */

import {
  RESEARCH_DOCUMENT_HANDLERS,
  RESEARCH_DOCUMENT_TOOL_NAMES,
  RESEARCH_KIT_HANDLERS,
  RESEARCH_KIT_TOOL_NAMES,
  RESEARCH_RECORD_HANDLERS,
  RESEARCH_RECORD_TOOL_NAMES,
} from '@/lib/tools/handlers/research-kit-handler';
import { findDocuments, listDocuments } from '@/lib/research/documents';
import { lookupChatState } from '@/lib/research/chat-state';
import { lookupAtlas, lookupConversations, lookupGroup, lookupProject, lookupWardrobe } from '@/lib/research/records';

jest.mock('@/lib/research/documents', () => ({ findDocuments: jest.fn(), listDocuments: jest.fn() }));
jest.mock('@/lib/research/records', () => ({
  lookupAtlas: jest.fn(),
  lookupConversations: jest.fn(),
  lookupGroup: jest.fn(),
  lookupProject: jest.fn(),
  lookupWardrobe: jest.fn(),
}));
jest.mock('@/lib/research/chat-state', () => ({ lookupChatState: jest.fn() }));
jest.mock('@/lib/research/scope', () => ({
  // Faithful to the real resolver's rules; the real module pulls in repositories.
  resolveResearchScope: (ctx: { operatorSurface?: boolean; mountPool?: unknown }) => {
    if (ctx.operatorSurface && ctx.mountPool) return { ok: false, error: 'misconfigured' };
    if (ctx.operatorSurface) return { ok: true, scope: { kind: 'everything' } };
    if (ctx.mountPool) return { ok: true, scope: { kind: 'pool', pool: ctx.mountPool } };
    return { ok: false, error: 'not available' };
  },
}));

const op = { userId: 'u', operatorSurface: true };
const pool = { userId: 'u', mountPool: {} as never };
const ok = { ok: true as const, text: 'result text' };

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of [findDocuments, listDocuments, lookupAtlas, lookupConversations, lookupGroup, lookupProject, lookupWardrobe, lookupChatState]) {
    (fn as jest.Mock).mockResolvedValue(ok);
  }
});

describe('handler map exports', () => {
  it('names the expected tools', () => {
    expect([...RESEARCH_DOCUMENT_TOOL_NAMES].sort()).toEqual(['find_documents', 'list_documents']);
    expect([...RESEARCH_RECORD_TOOL_NAMES].sort()).toEqual([
      'lookup_atlas',
      'lookup_chat_state',
      'lookup_conversations',
      'lookup_group',
      'lookup_project',
      'lookup_wardrobe',
    ]);
  });

  it('keeps document and record names disjoint, both inside the kit', () => {
    const kit = new Set(RESEARCH_KIT_TOOL_NAMES);
    for (const n of RESEARCH_DOCUMENT_TOOL_NAMES) expect(kit.has(n)).toBe(true);
    for (const n of RESEARCH_RECORD_TOOL_NAMES) expect(kit.has(n)).toBe(true);
    expect(RESEARCH_DOCUMENT_TOOL_NAMES.filter((n) => RESEARCH_RECORD_TOOL_NAMES.includes(n))).toEqual([]);
    expect(kit.size).toBe(RESEARCH_DOCUMENT_TOOL_NAMES.length + RESEARCH_RECORD_TOOL_NAMES.length);
    expect(Object.keys(RESEARCH_KIT_HANDLERS).sort()).toEqual([...kit].sort());
  });

  it('reuses the same handler functions in the kit map', () => {
    for (const [n, h] of Object.entries({ ...RESEARCH_DOCUMENT_HANDLERS, ...RESEARCH_RECORD_HANDLERS })) {
      expect(RESEARCH_KIT_HANDLERS[n]).toBe(h);
    }
  });
});

describe('routing', () => {
  it('find_documents -> findDocuments with scope, parsed input and ctx', async () => {
    const res = await RESEARCH_KIT_HANDLERS.find_documents({ text: 'hat' }, op);
    expect(res).toEqual({ success: true, text: 'result text' });
    expect(findDocuments).toHaveBeenCalledWith({ kind: 'everything' }, { text: 'hat' }, op);
  });

  it('list_documents -> listDocuments, accepting undefined input', async () => {
    const res = await RESEARCH_KIT_HANDLERS.list_documents(undefined, pool);
    expect(res.success).toBe(true);
    expect(listDocuments).toHaveBeenCalledWith({ kind: 'pool', pool: pool.mountPool }, {}, pool);
  });

  it('lookup_group / lookup_project pass only the name', async () => {
    await RESEARCH_KIT_HANDLERS.lookup_group({ group: 'Staff' }, op);
    await RESEARCH_KIT_HANDLERS.lookup_project({ project: 'Estate' }, op);
    expect(lookupGroup).toHaveBeenCalledWith('Staff');
    expect(lookupProject).toHaveBeenCalledWith('Estate');
  });

  it('lookup_conversations / wardrobe / atlas route to their functions', async () => {
    await RESEARCH_KIT_HANDLERS.lookup_conversations(undefined, op);
    await RESEARCH_KIT_HANDLERS.lookup_wardrobe({ owner: 'Amy' }, op);
    await RESEARCH_KIT_HANDLERS.lookup_atlas(undefined, op);
    expect(lookupConversations).toHaveBeenCalledWith({});
    expect(lookupWardrobe).toHaveBeenCalledWith({ owner: 'Amy' }, op);
    expect(lookupAtlas).toHaveBeenCalledWith({}, op);
  });

  it('lookup_chat_state carries the calling chat as its default conversation', async () => {
    const here = { ...op, chatId: 'chat-1' };
    await RESEARCH_KIT_HANDLERS.lookup_chat_state(undefined, here);
    expect(lookupChatState).toHaveBeenCalledWith({}, here);
    const res = await RESEARCH_KIT_HANDLERS.lookup_chat_state({}, { ...pool, chatId: 'chat-1' });
    expect(res).toEqual({ success: false, error: "lookup_chat_state is only available on the operator's surfaces." });
  });
});

describe('guards and failures as data', () => {
  it('refuses record tools on a mount pool without calling the function', async () => {
    const res = await RESEARCH_KIT_HANDLERS.lookup_group({ group: 'x' }, pool);
    expect(res).toEqual({ success: false, error: "lookup_group is only available on the operator's surfaces." });
    expect(lookupGroup).not.toHaveBeenCalled();
  });

  it('returns the scope error when there is no scope', async () => {
    const res = await RESEARCH_KIT_HANDLERS.find_documents({ text: 'x' }, { userId: 'u' });
    expect(res).toEqual({ success: false, error: 'not available' });
  });

  it('reports invalid input with the path and message', async () => {
    const res = await RESEARCH_KIT_HANDLERS.find_documents({}, op);
    expect(res.success).toBe(false);
    expect(res).toMatchObject({ error: expect.stringContaining('Invalid find_documents input:') });
    expect(findDocuments).not.toHaveBeenCalled();

    const res2 = await RESEARCH_KIT_HANDLERS.lookup_group({}, op);
    expect(res2).toMatchObject({ success: false, error: expect.stringContaining('group') });
  });

  it('passes through an {ok:false} outcome', async () => {
    (lookupProject as jest.Mock).mockResolvedValue({ ok: false, error: 'no such project' });
    expect(await RESEARCH_KIT_HANDLERS.lookup_project({ project: 'x' }, op)).toEqual({
      success: false,
      error: 'no such project',
    });
  });

  it('catches thrown errors, including non-Error values', async () => {
    (findDocuments as jest.Mock).mockRejectedValue(new Error('db down'));
    expect(await RESEARCH_KIT_HANDLERS.find_documents({ text: 'x' }, op)).toEqual({
      success: false,
      error: 'find_documents failed: db down',
    });
    (lookupAtlas as jest.Mock).mockRejectedValue('weird');
    expect(await RESEARCH_KIT_HANDLERS.lookup_atlas({}, op)).toEqual({
      success: false,
      error: 'lookup_atlas failed: weird',
    });
  });
});
