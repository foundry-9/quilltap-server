/**
 * The wardrobe_* tool handlers against the new seams: one wearable pool per
 * tool call (real lib/wardrobe/pool over a fake repository), the character's
 * vault location (mocked lib/wardrobe/location), the displacement chokepoint
 * (mocked applyDisplacement) and the outfit-change effects (mocked
 * notifyWardrobeChanged).
 */

// CommonJS require resolves AFTER jest.mock factories have run.
const { executeWardrobeListTool, formatWardrobeListResults } = require('@/lib/tools/handlers/wardrobe-list-handler')
const { executeWardrobeReadTool, formatWardrobeReadResults } = require('@/lib/tools/handlers/wardrobe-read-handler')
const { executeWardrobeCreateTool, formatWardrobeCreateResults } = require('@/lib/tools/handlers/wardrobe-create-handler')
const { executeWardrobeUpdateTool } = require('@/lib/tools/handlers/wardrobe-update-handler')
const { executeWardrobeArchiveTool } = require('@/lib/tools/handlers/wardrobe-archive-handler')
const { executeWardrobeWearTool } = require('@/lib/tools/handlers/wardrobe-wear-handler')
const { executeWardrobeTakeOffTool } = require('@/lib/tools/handlers/wardrobe-take-off-handler')

jest.mock('@/lib/logger', () => {
  const logger: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  logger.child = () => logger
  return { logger }
})

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/wardrobe/outfit-change-effects', () => ({
  notifyWardrobeChanged: jest.fn(),
}))

// The decision itself is covered in tool-image-generation.test.ts; here we
// only check what the handlers hand it and how they report the answer.
jest.mock('@/lib/wardrobe/tool-image-generation', () => {
  const actual = jest.requireActual('@/lib/wardrobe/tool-image-generation') as Record<string, unknown>
  return { ...actual, maybeQueueWardrobeToolImage: jest.fn() }
})

// Tier resolution: no groups / project unless a test says so; General is one mount.
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveGroupMountsForCharacter: jest.fn(),
  resolveProjectMountPointIds: jest.fn(),
}))

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}))

jest.mock('@/lib/projects/roster-access', () => ({
  rosterGatedProjectId: jest.fn(),
}))

// The character's vault, as a location the item mutations write through.
jest.mock('@/lib/wardrobe/location', () => ({
  resolveWardrobeLocation: jest.fn(),
}))

// The one chokepoint that commits `chats.equippedOutfit`.
jest.mock('@/lib/wardrobe/outfit-displacement', () => ({
  applyDisplacement: jest.fn(),
}))

const { getRepositories } = require('@/lib/repositories/factory')
const { notifyWardrobeChanged } = require('@/lib/wardrobe/outfit-change-effects')
const toolImages = require('@/lib/wardrobe/tool-image-generation')
const tieredMountPool = require('@/lib/mount-index/tiered-mount-pool')
const { getGeneralMountPointId } = require('@/lib/instance-settings')
const { resolveWardrobeLocation } = require('@/lib/wardrobe/location')
const { applyDisplacement } = require('@/lib/wardrobe/outfit-displacement')

const mockGetRepositories = getRepositories as jest.Mock
const mockNotify = notifyWardrobeChanged as jest.Mock
const mockApplyDisplacement = applyDisplacement as jest.Mock
const mockMaybeQueueImage = toolImages.maybeQueueWardrobeToolImage as jest.Mock

const now = '2026-04-07T00:00:00.000Z'
const GENERAL_MOUNT = 'general-mount'

const makeWardrobeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  characterId: 'char-1',
  title: 'Evening Dress',
  description: 'A formal velvet dress',
  imagePrompt: null,
  types: ['top', 'bottom'],
  componentItemIds: [],
  appropriateness: 'formal evening',
  isDefault: false,
  replace: false,
  archivedAt: null,
  migratedFromClothingRecordId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const emptySlots = () => ({ top: [], bottom: [], footwear: [], accessories: [], hair: [] })

describe('wardrobe tool handlers', () => {
  const context = {
    userId: 'user-1',
    chatId: 'chat-1',
    characterId: 'char-1',
  }

  let repos: any
  /** The character's own vault items (archived included). */
  let ownItems: any[]
  /** Shared-tier items keyed by mount point id. */
  let sharedByMount: Record<string, any[]>
  let location: any

  beforeEach(() => {
    jest.clearAllMocks()
    ownItems = []
    sharedByMount = {}

    tieredMountPool.resolveGroupMountsForCharacter.mockResolvedValue([])
    tieredMountPool.resolveProjectMountPointIds.mockResolvedValue([])
    getGeneralMountPointId.mockResolvedValue(GENERAL_MOUNT)
    mockMaybeQueueImage.mockResolvedValue(undefined)
    mockNotify.mockResolvedValue(undefined)
    mockApplyDisplacement.mockResolvedValue(emptySlots())

    repos = {
      wardrobe: {
        findByCharacterId: jest.fn(async () => ownItems),
        readSharedTiers: jest.fn(async (mountIds: string[], _includeArchived: boolean, originOf: (mp: string) => unknown) =>
          mountIds.flatMap((mp) => (sharedByMount[mp] ?? []).map((item) => ({ ...item, origin: originOf(mp) }))),
        ),
      },
      chats: {
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(emptySlots()),
        findById: jest.fn().mockResolvedValue({ id: 'chat-1', projectId: null, participants: [] }),
      },
      characters: {
        findById: jest.fn().mockResolvedValue(null),
        findByIdRaw: jest.fn().mockResolvedValue(null),
      },
      projects: {},
      wardrobeWear: {
        findSummariesForWearer: jest.fn(async (ids: string[]) =>
          new Map(ids.map((id) => [id, {
            household: { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null },
            yours: { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null },
          }]))
        ),
        findHistory: jest.fn().mockResolvedValue({
          wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null, wearers: [],
        }),
      },
    }
    mockGetRepositories.mockReturnValue(repos as any)

    location = {
      scope: 'character',
      characterId: 'char-1',
      mountPointId: 'vault-1',
      writableMountPointId: 'vault-1',
      origin: { scope: 'character', id: 'char-1', name: '' },
      create: jest.fn(async (item: any) => item),
      update: jest.fn(async (id: string, patch: any) => {
        const current = ownItems.find((i) => i.id === id)
        return current ? { ...current, ...patch } : null
      }),
      delete: jest.fn(),
    }
    resolveWardrobeLocation.mockResolvedValue(location)
  })

  // ──────────────────────────────────────────────────────────── wardrobe_list

  describe('executeWardrobeListTool', () => {
    it('merges the character\'s own items with shared General items and flags ownership', async () => {
      ownItems = [makeWardrobeItem({ id: 'own-1', title: 'My Coat', imagePrompt: 'worn brass-buttoned coat' })]
      sharedByMount[GENERAL_MOUNT] = [makeWardrobeItem({ id: 'shared-1', title: 'General Hat', characterId: null, types: ['accessories'] })]

      const result = await executeWardrobeListTool({}, context)

      expect(result.success).toBe(true)
      expect(result.total_count).toBe(2)
      const byId = Object.fromEntries(result.items.map((i: any) => [i.item_id, i]))
      expect(byId['own-1'].is_own).toBe(true)
      expect(byId['own-1'].image_prompt).toBe('worn brass-buttoned coat')
      expect(byId['shared-1'].is_own).toBe(false)
      expect(byId['shared-1'].image_prompt).toBeNull()
    })

    it('folds the character\'s group stores into the wearable pool', async () => {
      // The whole point of the group tier: a garment hanging in a group's
      // `Wardrobe/` folder is wearable by every member without any of them
      // owning it.
      tieredMountPool.resolveGroupMountsForCharacter.mockResolvedValueOnce([
        { group: { id: 'grp-1', name: 'The Household' }, mountPointIds: ['grp-mount'] },
      ])
      sharedByMount['grp-mount'] = [makeWardrobeItem({ id: 'grp-item', title: 'House Livery', characterId: null })]

      const result = await executeWardrobeListTool({}, context)

      expect(tieredMountPool.resolveGroupMountsForCharacter).toHaveBeenCalledWith('char-1')
      expect(repos.wardrobe.readSharedTiers).toHaveBeenCalledWith(['grp-mount'], true, expect.any(Function))
      const byId = Object.fromEntries(result.items.map((i: any) => [i.item_id, i]))
      expect(byId['grp-item'].title).toBe('House Livery')
      expect(byId['grp-item'].is_own).toBe(false)
    })

    it('lets a character\'s own item override a shared item on id collision', async () => {
      ownItems = [makeWardrobeItem({ id: 'dup', title: 'Mine' })]
      sharedByMount[GENERAL_MOUNT] = [makeWardrobeItem({ id: 'dup', title: 'Shared', characterId: null })]

      const result = await executeWardrobeListTool({}, context)

      expect(result.total_count).toBe(1)
      expect(result.items[0].title).toBe('Mine')
      expect(result.items[0].is_own).toBe(true)
    })

    it('does not let an archived personal copy hide the shared item', async () => {
      ownItems = [makeWardrobeItem({ id: 'dup', title: 'Mine', archivedAt: now })]
      sharedByMount[GENERAL_MOUNT] = [makeWardrobeItem({ id: 'dup', title: 'Shared', characterId: null })]

      const result = await executeWardrobeListTool({}, context)

      expect(result.total_count).toBe(1)
      expect(result.items[0].title).toBe('Shared')
      expect(result.items[0].is_own).toBe(false)
    })

    it('surfaces each item\'s picture as an image_file_id named for describe_image', async () => {
      ownItems = [
        makeWardrobeItem({ id: 'pictured', imageFileId: 'file-9' }),
        makeWardrobeItem({ id: 'bare', title: 'Bare Shirt' }),
      ]

      const result = await executeWardrobeListTool({}, context)
      const byId = Object.fromEntries(result.items.map((i: any) => [i.item_id, i]))
      expect(byId['pictured'].image_file_id).toBe('file-9')
      expect(byId['bare'].image_file_id).toBeNull()

      const text = formatWardrobeListResults(result)
      expect(text).toMatch(/picture: file-9 \(pass to describe_image/)
      expect(text.split('\n').find((l: string) => l.includes('Bare Shirt'))).not.toMatch(/picture:/)
    })

    it('filters by type', async () => {
      ownItems = [
        makeWardrobeItem({ id: 'a', types: ['top'] }),
        makeWardrobeItem({ id: 'b', types: ['footwear'] }),
      ]

      const result = await executeWardrobeListTool({ type_filter: ['footwear'] }, context)
      expect(result.total_count).toBe(1)
      expect(result.items[0].item_id).toBe('b')
    })
  })

  // ──────────────────────────────────────────────────────────── wardrobe_read

  describe('executeWardrobeReadTool', () => {
    it('returns full detail including the Portrait Cue and ownership', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', imagePrompt: 'a literal cue' })]

      const result = await executeWardrobeReadTool({ item_id: 'item-1' }, context)

      expect(result.success).toBe(true)
      expect(result.image_prompt).toBe('a literal cue')
      expect(result.is_own).toBe(true)
      expect(result.is_composite).toBe(false)
    })

    it('reports the current picture and how to look at it', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', imageFileId: 'file-3' })]

      const result = await executeWardrobeReadTool({ item_id: 'item-1' }, context)

      expect(result.image_file_id).toBe('file-3')
      expect(formatWardrobeReadResults(result)).toMatch(/picture: file-3 \(pass to describe_image/)
    })

    it('fails when the item is not found', async () => {
      const result = await executeWardrobeReadTool({ item_id: 'nope' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })

  // ────────────────────────────────────────────────────────── wardrobe_create

  describe('executeWardrobeCreateTool', () => {
    it('persists imagePrompt from image_prompt input into the character\'s vault', async () => {
      const result = await executeWardrobeCreateTool(
        { title: 'Scarf', types: ['accessories'], image_prompt: 'crimson silk scarf' },
        context
      )

      expect(result.success).toBe(true)
      expect(resolveWardrobeLocation).toHaveBeenCalledWith('character', 'char-1', repos, 'user-1')
      expect(location.create).toHaveBeenCalledWith(
        expect.objectContaining({ imagePrompt: 'crimson silk scarf', title: 'Scarf' })
      )
    })

    it('null imagePrompt when image_prompt omitted', async () => {
      await executeWardrobeCreateTool({ title: 'Plain', types: ['top'] }, context)
      expect(location.create).toHaveBeenCalledWith(
        expect.objectContaining({ imagePrompt: null })
      )
    })

    it('asks for a picture of the new item, defaulting on, for the item\'s owner', async () => {
      mockMaybeQueueImage.mockResolvedValueOnce({ status: 'queued', message: 'Drawing it.' })

      const result = await executeWardrobeCreateTool(
        { title: 'Gloves', types: ['accessories'], generate_image: true },
        context
      )

      expect(mockMaybeQueueImage).toHaveBeenCalledWith(repos, expect.objectContaining({
        characterId: 'char-1',
        itemId: result.item_id,
        requested: true,
        defaultWhenEnabled: true,
      }))
      expect(result.image_generation).toEqual({ status: 'queued', message: 'Drawing it.' })
      expect(formatWardrobeCreateResults(result)).toContain('- Picture: Drawing it.')
    })

    it('equips immediately when equip_now is set', async () => {
      const result = await executeWardrobeCreateTool(
        { title: 'Boots', types: ['footwear'], equip_now: true },
        context
      )

      expect(result.equipped).toBe(true)
      expect(result.effect).toBe('layered')
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      expect(mockApplyDisplacement).toHaveBeenCalledWith(
        repos,
        'chat-1',
        'char-1',
        expect.objectContaining({ mode: 'wear', item: expect.objectContaining({ id: result.item_id }) }),
        'tool',
      )
    })

    it('fires the outfit-change effects with the turn\'s announcement set when equip_now is set (bug 193)', async () => {
      const pending = new Set<string>()

      await executeWardrobeCreateTool(
        { title: 'Boots', types: ['footwear'], equip_now: true },
        { ...context, pendingWardrobeAnnouncements: pending }
      )

      expect(mockNotify).toHaveBeenCalledTimes(1)
      expect(mockNotify).toHaveBeenCalledWith(
        repos,
        {
          userId: 'user-1',
          chatId: 'chat-1',
          characterId: 'char-1',
          pendingWardrobeAnnouncements: pending,
        },
        'wardrobe-create-handler',
      )
    })

    it('does not fire the outfit-change effects when the item is only hung up', async () => {
      await executeWardrobeCreateTool({ title: 'Boots', types: ['footwear'] }, context)

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockApplyDisplacement).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────── wardrobe_update

  describe('executeWardrobeUpdateTool', () => {
    it('updates an owned item and maps image_prompt → imagePrompt', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1' })]

      const result = await executeWardrobeUpdateTool(
        { item_id: 'item-1', image_prompt: 'new cue', appropriateness: 'casual' },
        context
      )

      expect(result.success).toBe(true)
      expect(location.update).toHaveBeenCalledWith(
        'item-1',
        expect.objectContaining({ imagePrompt: 'new cue', appropriateness: 'casual' }),
      )
      expect(result.image_prompt).toBe('new cue')
    })

    it('defaults a redraw on only when the edit changes how the item looks', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1' })]

      await executeWardrobeUpdateTool({ item_id: 'item-1', appropriateness: 'casual' }, context)
      expect(mockMaybeQueueImage).toHaveBeenLastCalledWith(repos, expect.objectContaining({
        itemId: 'item-1',
        requested: undefined,
        defaultWhenEnabled: false,
      }))

      // Same title as stored: not a change.
      await executeWardrobeUpdateTool({ item_id: 'item-1', title: 'Evening Dress' }, context)
      expect(mockMaybeQueueImage).toHaveBeenLastCalledWith(repos, expect.objectContaining({ defaultWhenEnabled: false }))

      await executeWardrobeUpdateTool({ item_id: 'item-1', image_prompt: 'midnight velvet gown' }, context)
      expect(mockMaybeQueueImage).toHaveBeenLastCalledWith(repos, expect.objectContaining({ defaultWhenEnabled: true }))
    })

    it('echoes the picture outcome on the update result', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1' })]
      mockMaybeQueueImage.mockResolvedValueOnce({ status: 'not-enabled', message: 'Not allowed.' })

      const result = await executeWardrobeUpdateTool({ item_id: 'item-1', generate_image: true }, context)

      expect(result.success).toBe(true)
      expect(result.image_generation).toEqual({ status: 'not-enabled', message: 'Not allowed.' })
    })

    it('refuses to edit a shared item and never writes', async () => {
      sharedByMount[GENERAL_MOUNT] = [makeWardrobeItem({ id: 'shared-1', characterId: null })]

      const result = await executeWardrobeUpdateTool({ item_id: 'shared-1', title: 'Hijack' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/shared wardrobe item/i)
      expect(location.update).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────── wardrobe_archive

  describe('executeWardrobeArchiveTool', () => {
    it('archives an owned item by stamping archivedAt and never deletes', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', title: 'Old Cloak' })]

      const result = await executeWardrobeArchiveTool({ item_id: 'item-1' }, context)

      expect(result.success).toBe(true)
      expect(result.action).toBe('archived')
      expect(result.already_archived).toBeUndefined()
      expect(location.update).toHaveBeenCalledWith('item-1', { archivedAt: expect.any(String) })
      expect(location.delete).not.toHaveBeenCalled()
      // Not equipped, so nothing to announce.
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('fires the outfit-change effects when the archived item was equipped', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', title: 'Old Cloak' })]
      repos.chats.getEquippedOutfitForCharacter.mockResolvedValue({ ...emptySlots(), top: ['item-1'] })
      const pending = new Set<string>()

      await executeWardrobeArchiveTool({ item_id: 'item-1' }, { ...context, pendingWardrobeAnnouncements: pending })

      expect(mockNotify).toHaveBeenCalledWith(
        repos,
        expect.objectContaining({ characterId: 'char-1', pendingWardrobeAnnouncements: pending }),
        'wardrobe-archive-handler',
      )
    })

    it('keeps the original date when the item is already archived (bug 188)', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', title: 'Winter Coat', archivedAt: '2026-09-01T00:00:00.000Z' })]

      const result = await executeWardrobeArchiveTool({ item_id: 'item-1' }, context)

      expect(result.success).toBe(true)
      expect(result.already_archived).toBe(true)
      expect(location.update).not.toHaveBeenCalled()
    })

    it('refuses to archive a shared item', async () => {
      sharedByMount[GENERAL_MOUNT] = [makeWardrobeItem({ id: 'shared-1', characterId: null })]

      const result = await executeWardrobeArchiveTool({ item_id: 'shared-1' }, context)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/shared wardrobe item/i)
      expect(location.update).not.toHaveBeenCalled()
    })
  })

  // ──────────────────────────────────────────────────────────── wardrobe_wear

  describe('executeWardrobeWearTool', () => {
    it('wears a single garment (layered) through the displacement chokepoint', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', replace: false })]

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'wear' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations[0].effect).toBe('layered')
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      expect(mockApplyDisplacement.mock.calls[0][3]).toEqual(expect.objectContaining({ mode: 'wear' }))
    })

    it('replace mode commits a replace and reports replaced', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1' })]

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'replace' }] },
        context
      )

      expect(result.operations[0].effect).toBe('replaced')
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      expect(mockApplyDisplacement.mock.calls[0][3]).toEqual(expect.objectContaining({ mode: 'replace' }))
    })

    it('add_to_slot commits into the named slot', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', types: ['top'] })]

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'add_to_slot', slot: 'top' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      expect(mockApplyDisplacement.mock.calls[0][3]).toEqual(
        expect.objectContaining({ mode: 'add_to_slot', slot: 'top' }),
      )
    })

    it('wears a shared (General) item from the pool', async () => {
      sharedByMount[GENERAL_MOUNT] = [makeWardrobeItem({ id: 'shared-1', characterId: null, types: ['accessories'] })]

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'shared-1', mode: 'wear' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
    })

    it('applies a multi-op array and fires the outfit-change effects exactly once', async () => {
      ownItems = [
        makeWardrobeItem({ id: 'a', types: ['top'] }),
        makeWardrobeItem({ id: 'b', types: ['bottom'] }),
      ]
      const pending = new Set<string>()

      const result = await executeWardrobeWearTool(
        {
          operations: [
            { item_id: 'a', mode: 'wear' },
            { item_id: 'b', mode: 'wear' },
          ],
        },
        { ...context, pendingWardrobeAnnouncements: pending }
      )

      expect(result.success).toBe(true)
      expect(result.operations).toHaveLength(2)
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(2)
      expect(mockNotify).toHaveBeenCalledTimes(1)
      expect(mockNotify).toHaveBeenCalledWith(
        repos,
        expect.objectContaining({ pendingWardrobeAnnouncements: pending }),
        'wardrobe-wear-handler',
      )
    })

    it('fails fast on an unresolved item and does not apply later ops', async () => {
      ownItems = [makeWardrobeItem({ id: 'good' })]

      const result = await executeWardrobeWearTool(
        {
          operations: [
            { item_id: 'good', mode: 'wear' },
            { item_id: 'missing', mode: 'wear' },
            { item_id: 'good', mode: 'wear' },
          ],
        },
        context
      )

      expect(result.success).toBe(false)
      // good applied, missing recorded as the failing op, third never reached.
      expect(result.operations).toHaveLength(2)
      expect(result.operations[1].error).toMatch(/not found/i)
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      // Something landed, so the effects still fire once.
      expect(mockNotify).toHaveBeenCalledTimes(1)
    })

    it('rejects an archived item and fires nothing', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', archivedAt: now })]

      const result = await executeWardrobeWearTool(
        { operations: [{ item_id: 'item-1', mode: 'wear' }] },
        context
      )

      expect(result.success).toBe(false)
      expect(result.operations[0].error).toMatch(/archived/i)
      expect(mockApplyDisplacement).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────── wardrobe_take_off

  describe('executeWardrobeTakeOffTool', () => {
    it('removes a worn item across every slot it covers', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', types: ['top', 'bottom'] })]

      const result = await executeWardrobeTakeOffTool(
        { operations: [{ item_id: 'item-1', mode: 'remove' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations[0].effect).toBe('removed')
      // One remove_from_slot commit per covered slot.
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(2)
      expect(mockApplyDisplacement.mock.calls.map((c: any[]) => c[3])).toEqual([
        { mode: 'remove_from_slot', slot: 'top', itemId: 'item-1' },
        { mode: 'remove_from_slot', slot: 'bottom', itemId: 'item-1' },
      ])
      expect(mockNotify).toHaveBeenCalledTimes(1)
    })

    it('clears a slot entirely (no item id)', async () => {
      const result = await executeWardrobeTakeOffTool(
        { operations: [{ mode: 'clear_slot', slot: 'top' }] },
        context
      )

      expect(result.success).toBe(true)
      expect(result.operations[0].effect).toBe('cleared')
      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      expect(mockApplyDisplacement).toHaveBeenCalledWith(repos, 'chat-1', 'char-1', { mode: 'clear_slot', slot: 'top' })
    })

    it('restricts removal to one slot when a slot is given', async () => {
      ownItems = [makeWardrobeItem({ id: 'item-1', types: ['top', 'bottom'] })]

      await executeWardrobeTakeOffTool(
        { operations: [{ item_id: 'item-1', mode: 'remove', slot: 'top' }] },
        context
      )

      expect(mockApplyDisplacement).toHaveBeenCalledTimes(1)
      expect(mockApplyDisplacement.mock.calls[0][3]).toEqual({ mode: 'remove_from_slot', slot: 'top', itemId: 'item-1' })
    })
  })
})
