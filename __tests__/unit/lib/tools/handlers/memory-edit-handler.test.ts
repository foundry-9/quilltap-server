/**
 * @jest-environment node
 *
 * read_memory / edit_memory: the object read_memory hands out is the one
 * edit_memory takes; both are scoped to the calling character; an edit sends
 * only the changed fields to the edit chokepoint, refuses a keystone and an
 * unknown subject.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/admission', () => ({ requestMemoryEdit: jest.fn() }))

import { getRepositories } from '@/lib/repositories/factory'
import { requestMemoryEdit } from '@/lib/memory/admission'
import { executeEditMemoryTool, executeReadMemoryTool } from '@/lib/tools/handlers/memory-edit-handler'
import { editMemoryToolInputSchema } from '@/lib/tools/edit-memory-tool'

const CHAR = 'char-1'
const ctx = { userId: 'user-1', characterId: CHAR }

const baseMemory = {
  id: 'mem-1',
  characterId: CHAR,
  content: 'Charlie proposed on the lighthouse gallery.',
  summary: 'Charlie proposed at Lighthouse Point',
  keywords: ['lighthouse'],
  importance: 0.8,
  aboutCharacterId: 'char-2',
  relatedMemoryIds: ['mem-2'],
  chatId: 'chat-9',
  source: 'AUTO',
  kind: 'episodic',
  tier: 'hot',
  keystone: false,
  createdAt: '2026-09-14T22:10:03.000Z',
  occurredAt: '2026-09-14T21:58:40.000Z',
  narrativeTime: null,
  reinforcementCount: 2,
}

let rows: Record<string, typeof baseMemory>
const characters: Record<string, { name: string }> = { 'char-2': { name: 'Charlie' } }

beforeEach(() => {
  jest.clearAllMocks()
  rows = { 'mem-1': { ...baseMemory } }
  ;(getRepositories as jest.Mock).mockReturnValue({
    memories: {
      findByIdForCharacter: jest.fn(async (characterId: string, id: string) =>
        rows[id] && rows[id].characterId === characterId ? rows[id] : null),
    },
    characters: { findByIdRaw: jest.fn(async (id: string) => characters[id] ?? null) },
  })
  ;(requestMemoryEdit as jest.Mock).mockImplementation(async ({ memoryId }: { memoryId: string }) => ({ ok: true, memory: rows[memoryId] }))
})

describe('read_memory', () => {
  it('returns the editable object and the read-only context', async () => {
    const out = await executeReadMemoryTool({ id: 'mem-1' }, ctx)
    expect(out.success).toBe(true)
    expect(out.memory).toEqual({
      id: 'mem-1',
      content: baseMemory.content,
      summary: baseMemory.summary,
      keywords: ['lighthouse'],
      importance: 0.8,
      about_character_id: 'char-2',
      related_memory_ids: ['mem-2'],
    })
    expect(out.context).toMatchObject({
      kind: 'episodic',
      archived: false,
      keystone: false,
      about_character_name: 'Charlie',
      source_conversation_id: 'chat-9',
      reinforcement_count: 2,
    })
  })

  it('hands out exactly what edit_memory accepts', async () => {
    const out = await executeReadMemoryTool({ id: 'mem-1' }, ctx)
    expect(editMemoryToolInputSchema.safeParse(out.memory).success).toBe(true)
  })

  it("reads another character's memory as missing", async () => {
    const out = await executeReadMemoryTool({ id: 'mem-1' }, { ...ctx, characterId: 'char-other' })
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/no memory with the id mem-1/)
  })
})

describe('edit_memory', () => {
  const whole = () => ({
    id: 'mem-1',
    content: baseMemory.content,
    summary: baseMemory.summary,
    keywords: ['lighthouse'],
    importance: 0.8,
    about_character_id: 'char-2',
    related_memory_ids: ['mem-2'],
  })

  it('sends only the changed fields to updateMemory', async () => {
    const out = await executeEditMemoryTool({ ...whole(), summary: 'Charlie proposed; I said yes', importance: 0.95 }, ctx)
    expect(out).toEqual({ success: true, id: 'mem-1', changed: ['summary', 'importance'] })
    expect(requestMemoryEdit).toHaveBeenCalledWith({
      characterId: CHAR,
      memoryId: 'mem-1',
      patch: { summary: 'Charlie proposed; I said yes', importance: 0.95 },
      userId: 'user-1',
    })
  })

  it('writes nothing when nothing changed', async () => {
    const out = await executeEditMemoryTool(whole(), ctx)
    expect(out).toEqual({ success: true, id: 'mem-1', changed: [] })
    expect(requestMemoryEdit).not.toHaveBeenCalled()
  })

  it('refuses a partial object', async () => {
    const out = await executeEditMemoryTool({ id: 'mem-1', summary: 'x' }, ctx)
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/read_memory/)
    expect(requestMemoryEdit).not.toHaveBeenCalled()
  })

  it('refuses a keystone', async () => {
    rows['mem-1'].keystone = true
    const out = await executeEditMemoryTool({ ...whole(), summary: 'changed' }, ctx)
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/keystone/)
    expect(requestMemoryEdit).not.toHaveBeenCalled()
  })

  it('refuses an unknown subject', async () => {
    const out = await executeEditMemoryTool({ ...whole(), about_character_id: 'nobody' }, ctx)
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/no character with the id nobody/)
    expect(requestMemoryEdit).not.toHaveBeenCalled()
  })

  it("cannot reach another character's memory", async () => {
    const out = await executeEditMemoryTool({ ...whole(), summary: 'changed' }, { ...ctx, characterId: 'char-other' })
    expect(out.success).toBe(false)
    expect(requestMemoryEdit).not.toHaveBeenCalled()
  })

  it("reports the chokepoint's refusal", async () => {
    ;(requestMemoryEdit as jest.Mock).mockResolvedValue({ ok: false, reason: 'invalid-related', invalidIds: ['mem-x'] })
    const out = await executeEditMemoryTool({ ...whole(), related_memory_ids: ['mem-x'] }, ctx)
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/mem-x/)
  })
})
