/**
 * generate_image and the Atlas (atlas spec §5.8): a prompt that names a thing
 * is crafted with its look as a reference; a `{{Name}}` naming an Atlas term
 * becomes the canonical name; with the crafter failing, the look is appended;
 * a prompt that names nothing goes out exactly as written.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/llm/plugin-factory', () => ({ createImageProvider: jest.fn() }))
jest.mock('@/lib/plugins/provider-registry', () => ({ getImageProviderConstraints: jest.fn(() => null) }))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/llm/cheap-llm-user-selection', () => ({
  resolveCheapLLMSelectionForUser: jest.fn(async () => ({
    selection: { provider: 'OPENAI', modelName: 'cheap', connectionProfileId: 'cheap-1', isLocal: false },
  })),
  selectCheapLLMFromProfiles: jest.fn(() => ({
    selection: { provider: 'OPENAI', modelName: 'cheap', connectionProfileId: 'cheap-1', isLocal: false },
  })),
}))
jest.mock('@/lib/services/dangerous-content/gatekeeper.service', () => ({
  // Every prompt the pre-screen sees is flagged.
  classifyContent: jest.fn(async () => ({ isDangerous: false, score: 0, categories: [] })),
}))
jest.mock('@/lib/image-gen/params-builder', () => ({
  buildImageGenParams: jest.fn(({ prompt }: { prompt: string }) => ({ params: { prompt, n: 1 } })),
  resolveProfileLoras: jest.fn(() => ({ triggerPhrase: null })),
}))
jest.mock('@/lib/image-gen/appearance-resolution', () => ({
  equippedWardrobeItemsForAppearance: jest.fn(async () => undefined),
  resolveCharacterAppearances: jest.fn(async () => ({
    appearances: [{
      characterId: 'char-1', characterName: 'Amy', physicalDescription: 'a young woman',
      clothingDescription: 'nothing at all',
      clothingSource: 'narrative', wasSanitized: false,
    }],
    llmResolved: true,
  })),
  sanitizeAppearancesIfNeeded: jest.fn(async (a: unknown) => a),
}))
jest.mock('@/lib/image-gen/aesthetic', () => ({
  resolveAesthetic: jest.fn(async () => null),
  resolveDepictionGuidelines: jest.fn(async () => []),
  getProjectOfficialMountPointId: jest.fn(async () => null),
}))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveProjectMountPointIdsForChat: jest.fn(async () => []),
}))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({ craftImagePrompt: jest.fn() }))
jest.mock('@/lib/file-storage/lantern-store-bridge', () => ({
  getLanternBackgroundsStore: jest.fn(async () => ({ mountPointId: 'lantern' })),
  writeLanternBackgroundToMountStore: jest.fn(async () => ({
    storageKey: 'mount-blob:lantern:b1', storedMimeType: 'image/webp', sizeBytes: 4,
  })),
}))
jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: jest.fn(async () => ({
    buffer: Buffer.from('webp'), mimeType: 'image/webp', filename: 'generated.webp', width: 512, height: 512,
  })),
}))
jest.mock('@/lib/files/tag-inheritance', () => ({ getInheritedTags: jest.fn(async () => []) }))
jest.mock('@/lib/services/llm-logging.service', () => ({ logLLMCall: jest.fn(async () => undefined) }))
jest.mock('@/lib/services/lantern-notifications/writer', () => ({
  postLanternImageNotification: jest.fn(async () => undefined),
}))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: jest.fn(async () => null),
}))

jest.mock('@/lib/atlas/image-reference', () => ({
  ...jest.requireActual('@/lib/atlas/image-reference'),
  loadImageAtlasView: jest.fn(),
}))

import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { craftImagePrompt } from '@/lib/memory/cheap-llm-tasks'
import { loadImageAtlasView } from '@/lib/atlas/image-reference'

const USER = 'user-1'
const HOUSE = {
  id: '11111111-1111-4111-8111-111111111111', userId: USER, name: 'House Painter',
  provider: 'GOOGLE', modelName: 'gemini-2.5-flash-image', apiKeyId: 'key-house',
  isDangerousCompatible: false, parameters: {},
}
const origin = { scope: 'general' as const, id: null, name: 'Quilltap General' }
const entry = (name: string, aliases: string[], graphicPrompt: string) =>
  ({ id: name, name, aliases, graphicPrompt, knowledge: null, imageFileId: null, metadata: {}, folder: '', archivedAt: null, createdAt: 'x', updatedAt: 'x', origin, mountPointId: 'mp' })
const VIEW = {
  entries: [entry('Convertible', ['lander', 'car'], "A 1930's roadster, silver."), entry('Lighthouse', [], 'A white tower.')],
  shadowedCount: 0,
}

function wire() {
  ;(getRepositories as jest.Mock).mockReturnValue({
    imageProfiles: { findById: jest.fn(async () => HOUSE), findAll: jest.fn(async () => [HOUSE]) },
    connections: {
      findApiKeyByIdAndUserId: jest.fn(async (id: string) => ({ id, key_value: `sk-${id}` })),
      findByUserId: jest.fn(async () => [{ id: 'cheap-1', provider: 'OPENAI', modelName: 'cheap' }]),
    },
    chatSettings: { findByUserId: jest.fn(async () => null) },
    chats: { findById: jest.fn(async () => null), getMessages: jest.fn(async () => []) },
    characters: { findById: jest.fn(async () => null), findByUserId: jest.fn(async () => [{ id: 'c', name: 'Agatha', aliases: [] }]) },
    files: { create: jest.fn(async (e: Record<string, unknown>, opts: { id: string }) => ({ ...e, id: opts.id })) },
  })
  const painter = {
    generateImage: jest.fn(async () => ({ images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png' }] })),
  }
  ;(createImageProvider as jest.Mock).mockImplementation(() => painter)
  return painter
}

const sentPrompt = (painter: { generateImage: jest.Mock }) => (painter.generateImage.mock.calls[0][0] as { prompt: string }).prompt

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadImageAtlasView as jest.Mock).mockResolvedValue(VIEW)
})

it('crafts a prompt with no placeholders when it names things, handing the crafter their looks', async () => {
  const painter = wire()
  ;(craftImagePrompt as jest.Mock).mockResolvedValue({ success: true, result: 'CRAFTED' })
  const result = await executeImageGenerationTool({ prompt: 'the convertible parked by the lighthouse' }, { userId: USER, profileId: HOUSE.id })
  expect(result.success).toBe(true)
  expect(craftImagePrompt).toHaveBeenCalledTimes(1)
  expect((craftImagePrompt as jest.Mock).mock.calls[0][0].knownThings.map((t: { name: string }) => t.name)).toEqual(['Convertible', 'Lighthouse'])
  expect(sentPrompt(painter)).toBe('CRAFTED')
})

it('sends a prompt that names nothing unchanged, and runs no crafter', async () => {
  const painter = wire()
  await executeImageGenerationTool({ prompt: 'a bowl of fruit' }, { userId: USER, profileId: HOUSE.id })
  expect(craftImagePrompt).not.toHaveBeenCalled()
  expect(sentPrompt(painter)).toBe('a bowl of fruit')
})

it('turns {{Convertible}} into the name and, with the crafter failing, appends the look', async () => {
  const painter = wire()
  ;(craftImagePrompt as jest.Mock).mockResolvedValue({ success: false, error: 'down' })
  await executeImageGenerationTool({ prompt: '{{car}} at dusk' }, { userId: USER, profileId: HOUSE.id })
  expect(sentPrompt(painter)).toBe("Convertible at dusk Convertible: A 1930's roadster, silver.")
})
