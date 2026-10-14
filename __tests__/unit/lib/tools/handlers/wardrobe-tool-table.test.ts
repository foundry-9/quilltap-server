/**
 * The executor's wardrobe table (lib/tools/handlers/wardrobe-tool-table.ts).
 *
 * Bug 193: a wardrobe tool that changed an outfit without the turn's
 * announcement set enqueued its own announcement instead of joining the
 * turn's one. The table is the single place the executor hands a context to a
 * wardrobe_* tool, so every entry must forward that context — set included —
 * to its handler untouched.
 */

const { WARDROBE_TOOL_TABLE } = require('@/lib/tools/handlers/wardrobe-tool-table')

jest.mock('@/lib/tools/handlers/wardrobe-list-handler', () => ({
  executeWardrobeListTool: jest.fn(),
  formatWardrobeListResults: jest.fn(() => 'list'),
}))
jest.mock('@/lib/tools/handlers/wardrobe-read-handler', () => ({
  executeWardrobeReadTool: jest.fn(),
  formatWardrobeReadResults: jest.fn(() => 'read'),
}))
jest.mock('@/lib/tools/handlers/wardrobe-create-handler', () => ({
  executeWardrobeCreateTool: jest.fn(),
  formatWardrobeCreateResults: jest.fn(() => 'create'),
}))
jest.mock('@/lib/tools/handlers/wardrobe-update-handler', () => ({
  executeWardrobeUpdateTool: jest.fn(),
  formatWardrobeUpdateResults: jest.fn(() => 'update'),
}))
jest.mock('@/lib/tools/handlers/wardrobe-archive-handler', () => ({
  executeWardrobeArchiveTool: jest.fn(),
  formatWardrobeArchiveResults: jest.fn(() => 'archive'),
}))
jest.mock('@/lib/tools/handlers/wardrobe-wear-handler', () => ({
  executeWardrobeWearTool: jest.fn(),
  formatWardrobeWearResults: jest.fn(() => 'wear'),
}))
jest.mock('@/lib/tools/handlers/wardrobe-take-off-handler', () => ({
  executeWardrobeTakeOffTool: jest.fn(),
  formatWardrobeTakeOffResults: jest.fn(() => 'take-off'),
}))

const HANDLERS: Record<string, { module: string; fn: string }> = {
  wardrobe_list: { module: '@/lib/tools/handlers/wardrobe-list-handler', fn: 'executeWardrobeListTool' },
  wardrobe_read: { module: '@/lib/tools/handlers/wardrobe-read-handler', fn: 'executeWardrobeReadTool' },
  wardrobe_create: { module: '@/lib/tools/handlers/wardrobe-create-handler', fn: 'executeWardrobeCreateTool' },
  wardrobe_update: { module: '@/lib/tools/handlers/wardrobe-update-handler', fn: 'executeWardrobeUpdateTool' },
  wardrobe_archive: { module: '@/lib/tools/handlers/wardrobe-archive-handler', fn: 'executeWardrobeArchiveTool' },
  wardrobe_wear: { module: '@/lib/tools/handlers/wardrobe-wear-handler', fn: 'executeWardrobeWearTool' },
  wardrobe_take_off: { module: '@/lib/tools/handlers/wardrobe-take-off-handler', fn: 'executeWardrobeTakeOffTool' },
}

describe('WARDROBE_TOOL_TABLE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('covers exactly the seven wardrobe_* tools', () => {
    expect(Object.keys(WARDROBE_TOOL_TABLE).sort()).toEqual(Object.keys(HANDLERS).sort())
  })

  it.each(Object.keys(HANDLERS))('%s forwards the turn\'s announcement set to its handler (bug 193)', async (name) => {
    const { module, fn } = HANDLERS[name]
    const handler = require(module)[fn] as jest.Mock
    handler.mockResolvedValue({
      success: true,
      items: [],
      total_count: 0,
      operations: [],
      current_state: {},
      coverage_summary: '',
    })

    const pending = new Set<string>()
    const context = { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1', pendingWardrobeAnnouncements: pending }
    const input = { marker: name }

    const run = await WARDROBE_TOOL_TABLE[name](input, context)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBe(input)
    expect(handler.mock.calls[0][1]).toEqual(context)
    expect(handler.mock.calls[0][1].pendingWardrobeAnnouncements).toBe(pending)
    expect(run.success).toBe(true)
    expect(run.result.formattedText).toEqual(expect.any(String))
  })
})
