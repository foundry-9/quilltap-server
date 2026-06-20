/**
 * Regression test for the SHA-256 recorded by the character-avatar generation
 * handler.
 *
 * The invariant under test (the same "hash the bytes you actually store" rule
 * the mount-store content-hash chokepoint enforces): the handler must hash the
 * *post-WebP-conversion* buffer — the bytes it persists — not the raw provider
 * bytes, and must pass that exact digest to repos.files.create. If someone hashes
 * rawBuffer instead of the converted buffer, the file record's sha256 would no
 * longer match the stored bytes and dedup/integrity would silently rot.
 *
 * Several collaborators are already mocked in jest.setup.ts (file storage
 * manager, character-vault bridge, lantern-store bridge, LLM logging,
 * tag inheritance). We mock the remaining pipeline pieces here with bare
 * jest.fn()s and set their behaviour in beforeEach, and drive the full handler
 * with dangerous-content scanning OFF so it takes the straight
 * generate → convert → hash → save path into the character vault.
 *
 * Mock style matches the other handler suites in this directory: subject imports
 * first, jest.mock() (with bare factories) after, behaviour wired in beforeEach.
 */

import { createHash } from 'node:crypto'
import { handleCharacterAvatarGeneration } from '@/lib/background-jobs/handlers/character-avatar'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { convertToWebP } from '@/lib/files/webp-conversion'
import { buildCharacterAvatarPrompt } from '@/lib/wardrobe/avatar-prompt'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { writeCharacterAvatarToVault } from '@/lib/file-storage/character-vault-bridge'

jest.mock('@/lib/logger', () => {
  const makeLogger = () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/wardrobe/avatar-prompt', () => ({
  buildCharacterAvatarPrompt: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}))

jest.mock('@/lib/llm/plugin-factory', () => ({
  createImageProvider: jest.fn(),
}))

jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: jest.fn(),
}))

jest.mock('@/lib/services/lantern-notifications/writer', () => ({
  postLanternImageNotification: jest.fn().mockResolvedValue(undefined),
}))

const USER = 'user-1'
const CHAT_ID = 'chat-1'
const CHARACTER_ID = 'char-1'

// Distinct raw vs converted bytes so the test proves the hash is taken of the
// converted (stored) bytes, not the raw provider bytes.
const RAW_PROVIDER_BYTES = Buffer.from('raw png bytes from provider')
const CONVERTED_WEBP_BYTES = Buffer.from('converted webp bytes — different from raw')

const filesCreate = jest.fn()

const mockGetRepositories = jest.mocked(getRepositories)
const mockCreateImageProvider = jest.mocked(createImageProvider)
const mockConvertToWebP = jest.mocked(convertToWebP)
const mockBuildPrompt = jest.mocked(buildCharacterAvatarPrompt)
const mockResolveDanger = jest.mocked(resolveDangerousContentSettings)
const mockWriteVault = jest.mocked(writeCharacterAvatarToVault)

function makeJob() {
  return {
    id: 'job-1',
    userId: USER,
    payload: {
      chatId: CHAT_ID,
      characterId: CHARACTER_ID,
      imageProfileId: 'profile-1',
      equippedSlotsOverride: {}, // truthy → skips getEquippedOutfitForCharacter
    },
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()

  filesCreate.mockResolvedValue({ id: 'file-1' })

  mockGetRepositories.mockReturnValue({
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: CHAT_ID,
        projectId: null, // → routes the avatar into the character vault
        characterAvatars: {},
        messageCount: 0,
        title: 'A Chat',
      }),
      getEquippedOutfitForCharacter: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue(undefined),
    },
    characters: {
      findById: jest.fn().mockResolvedValue({
        id: CHARACTER_ID,
        name: 'Tess',
        pronouns: null,
        avatarOverrides: [],
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    imageProfiles: {
      findById: jest.fn().mockResolvedValue({
        id: 'profile-1',
        apiKeyId: 'key-1',
        modelName: 'image-model',
        provider: 'openai',
        name: 'Default Image Profile',
      }),
    },
    connections: {
      findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test' }),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue(null),
    },
    folders: {
      findByPath: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
    },
    files: {
      create: filesCreate,
    },
  } as any)

  mockBuildPrompt.mockResolvedValue({
    prompt: 'a 3/4 portrait of Tess',
    hasAppearance: true,
    leafCounts: {},
  } as any)

  // Dangerous-content scanning OFF → the entire classifier block is skipped.
  mockResolveDanger.mockReturnValue({ settings: { mode: 'OFF', scanImagePrompts: false } } as any)

  mockCreateImageProvider.mockReturnValue({
    generateImage: jest.fn().mockResolvedValue({
      images: [
        { b64Json: RAW_PROVIDER_BYTES.toString('base64'), mimeType: 'image/png', revisedPrompt: null },
      ],
    }),
  } as any)

  mockConvertToWebP.mockResolvedValue({
    buffer: CONVERTED_WEBP_BYTES,
    mimeType: 'image/webp',
    filename: 'avatar_Tess.webp',
    wasConverted: true,
  } as any)

  // The vault writer's own returned sha is intentionally NOT what the file record
  // uses — the handler records its own hash of the converted bytes.
  mockWriteVault.mockResolvedValue({
    storageKey: 'mount-blob:mock-vault:blob-1',
    mountPointId: 'mock-vault',
    blobId: 'blob-1',
    linkId: 'link-1',
    relativePath: 'images/avatar.webp',
    storedMimeType: 'image/webp',
    sizeBytes: CONVERTED_WEBP_BYTES.length,
    sha256: 'unused-bridge-sha',
  } as any)
})

describe('character-avatar handler — sha256 of stored bytes', () => {
  it('records the sha256 of the converted (stored) buffer, not the raw provider bytes', async () => {
    await handleCharacterAvatarGeneration(makeJob())

    expect(filesCreate).toHaveBeenCalledTimes(1)
    const arg = filesCreate.mock.calls[0][0] as { sha256: string; source: string; category: string }

    const expectedConverted = createHash('sha256').update(new Uint8Array(CONVERTED_WEBP_BYTES)).digest('hex')
    const rawHash = createHash('sha256').update(new Uint8Array(RAW_PROVIDER_BYTES)).digest('hex')

    expect(arg.sha256).toBe(expectedConverted)
    expect(arg.sha256).not.toBe(rawHash)
    expect(arg.source).toBe('GENERATED')
    expect(arg.category).toBe('IMAGE')
  })

  it('hands the converted bytes (matching the recorded hash) to the vault writer', async () => {
    await handleCharacterAvatarGeneration(makeJob())

    expect(mockWriteVault).toHaveBeenCalledTimes(1)
    const vaultArg = mockWriteVault.mock.calls[0][0] as { content: Buffer }
    // The bytes stored in the vault are exactly the bytes whose hash was recorded.
    expect(Buffer.compare(vaultArg.content, CONVERTED_WEBP_BYTES)).toBe(0)
  })
})

describe('character-avatar handler — orientation + measured dimensions', () => {
  it('stores the measured dimensions from the converted buffer, not a hard-coded portrait size', async () => {
    mockConvertToWebP.mockResolvedValue({
      buffer: CONVERTED_WEBP_BYTES,
      mimeType: 'image/webp',
      filename: 'avatar_Tess.webp',
      wasConverted: true,
      width: 768,
      height: 1024,
    } as any)

    await handleCharacterAvatarGeneration(makeJob())

    const arg = filesCreate.mock.calls[0][0] as { width: number | null; height: number | null }
    expect(arg.width).toBe(768)
    expect(arg.height).toBe(1024)
    // The old hard-coded 1024x1792 must be gone.
    expect(arg.height).not.toBe(1792)
  })

  it('records null dimensions when the converter could not measure them', async () => {
    // beforeEach's convertToWebP mock returns no width/height.
    await handleCharacterAvatarGeneration(makeJob())

    const arg = filesCreate.mock.calls[0][0] as { width: number | null; height: number | null }
    expect(arg.width ?? null).toBeNull()
    expect(arg.height ?? null).toBeNull()
  })

  it('requests portrait orientation (no hard-coded size) and appends the portrait hint when the provider is unknown to the registry', async () => {
    await handleCharacterAvatarGeneration(makeJob())

    const providerInstance = mockCreateImageProvider.mock.results[0].value as { generateImage: jest.Mock }
    const genArg = providerInstance.generateImage.mock.calls[0][0] as { prompt: string; size?: string }

    // No registry plugin in the unit env → host fallback (prompt hint, no size).
    expect(genArg.size).toBeUndefined()
    expect(genArg.prompt).toMatch(/portrait/i)
  })
})
