/**
 * Unit Tests for Appearance Resolution Module
 * Tests lib/image-gen/appearance-resolution.ts
 * Context-aware character appearance resolution for image generation
 */

import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

// Mock the dependencies using the same pattern as other codebase tests
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  resolveAppearance: jest.fn(),
  sanitizeAppearance: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/gatekeeper.service', () => ({
  classifyContent: jest.fn(),
}))
jest.mock('@/lib/logger')

// Import the mocked modules and cast to get typed mock functions
import { resolveAppearance, sanitizeAppearance } from '@/lib/memory/cheap-llm-tasks'
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service'

const mockResolveAppearance = resolveAppearance as jest.MockedFunction<typeof resolveAppearance>
const mockSanitizeAppearance = sanitizeAppearance as jest.MockedFunction<typeof sanitizeAppearance>
const mockClassifyContent = classifyContent as jest.MockedFunction<typeof classifyContent>

// Import types
import type {
  ChatMessage,
  CharacterAppearanceInput,
  AppearanceResolutionItem,
} from '@/lib/memory/cheap-llm-tasks'

// Import the module under test
import {
  resolveCharacterAppearances,
  sanitizeAppearancesIfNeeded,
  type ResolvedCharacterAppearance,
  type AppearanceResolutionInput,
  type AppearanceResolutionResult,
} from '@/lib/image-gen/appearance-resolution'

// Import prompt expansion for integration testing
import { buildExpansionContext } from '@/lib/image-gen/prompt-expansion'

// Test fixtures
const testSelection: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
  connectionProfileId: 'test-profile-id',
  isLocal: false,
}

const testUserId = 'test-user-id'
const testChatId = 'test-chat-id'

const dangerOffSettings: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

const dangerOnSettings: DangerousContentSettings = {
  mode: 'DETECT_ONLY',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

// Helper to add required timestamp fields
const ts = '2025-01-01T00:00:00.000Z'

// Sample character input data
const sampleCharacter1: AppearanceResolutionInput = {
  characterId: 'char-1',
  characterName: 'Alice',
  physicalDescriptions: [
    {
      id: 'desc-1',
      name: 'Default',
      usageContext: 'General appearance',
      shortPrompt: 'A woman with red hair',
      mediumPrompt: 'A young woman with flowing red hair and green eyes',
      longPrompt: 'A young woman with long flowing red hair, vibrant green eyes, and fair skin',
      completePrompt: 'A young woman with long flowing red hair, vibrant green eyes, fair skin, wearing casual clothes',
      fullDescription: null,
      createdAt: ts,
      updatedAt: ts,
    },
  ],
  equippedWardrobeItems: [
    { slot: 'top', title: 'Casual Outfit', description: 'Blue jeans and a white t-shirt' },
  ],
}

const sampleCharacter2: AppearanceResolutionInput = {
  characterId: 'char-2',
  characterName: 'Bob',
  physicalDescriptions: [
    {
      id: 'desc-2a',
      name: 'Work appearance',
      usageContext: 'Office settings',
      shortPrompt: 'A man in a suit',
      mediumPrompt: 'A middle-aged man with gray hair in a formal suit',
      longPrompt: 'A middle-aged man with short gray hair, wearing glasses and a formal navy suit',
      completePrompt: 'A middle-aged professional man with short gray hair, rectangular glasses, wearing a formal navy suit with a red tie',
      fullDescription: null,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'desc-2b',
      name: 'Casual appearance',
      usageContext: 'Weekend activities',
      shortPrompt: 'A man in casual clothes',
      mediumPrompt: 'A middle-aged man with gray hair in casual weekend wear',
      longPrompt: 'A middle-aged man with short gray hair, wearing jeans and a plaid shirt',
      completePrompt: 'A middle-aged man with short gray hair, rectangular glasses, wearing comfortable jeans and a plaid flannel shirt',
      fullDescription: null,
      createdAt: ts,
      updatedAt: ts,
    },
  ],
  equippedWardrobeItems: [
    { slot: 'top', title: 'Navy Suit Jacket', description: 'Navy suit jacket with red tie' },
    { slot: 'bottom', title: 'Navy Suit Trousers', description: 'Matching navy trousers' },
    { slot: 'footwear', title: 'Oxford Shoes', description: 'Black Oxford shoes' },
  ],
}

const sampleMessages: ChatMessage[] = [
  { role: 'user', content: 'Hey Alice, how are you today?' },
  { role: 'assistant', content: 'I am doing well, thanks for asking!' },
  { role: 'user', content: 'Want to grab coffee?' },
]

describe('Appearance Resolution Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('resolveCharacterAppearances', () => {
    describe('Skip optimization', () => {
      it('should skip LLM call when all characters have 1 description, 0-1 clothing, and no messages', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter1]
        const noMessages: ChatMessage[] = []

        const result = await resolveCharacterAppearances(
          characters,
          noMessages,
          'Alice sitting on a bench',
          testSelection,
          testUserId,
          testChatId
        )

        // Should not call mockResolveAppearance
        expect(mockResolveAppearance).not.toHaveBeenCalled()

        // Should return default appearances with llmResolved=true (skip is intentional, not a failure)
        expect(result.llmResolved).toBe(true)
        expect(result.appearances).toHaveLength(1)
        expect(result.appearances[0]).toEqual({
          characterId: 'char-1',
          characterName: 'Alice',
          physicalDescription: 'A young woman with long flowing red hair, vibrant green eyes, fair skin, wearing casual clothes',
          physicalDescriptionName: 'Default',
          clothingDescription: '- **top:** Casual Outfit (Blue jeans and a white t-shirt)\n- **bottom:** bottomless\n- **footwear:** barefoot\n- **accessories:** no accessories\n',
          clothingSource: 'stored',
          wasSanitized: false,
        })
      })

      it('should NOT skip when character has multiple descriptions', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter2]
        const noMessages: ChatMessage[] = []

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: [
            {
              characterId: 'char-2',
              selectedDescriptionId: 'desc-2b',
              clothingDescription: 'Comfortable weekend clothes',
              clothingSource: 'stored',
            },
          ],
        })

        await resolveCharacterAppearances(
          characters,
          noMessages,
          'Bob at a coffee shop',
          testSelection,
          testUserId,
          testChatId
        )

        // Should call mockResolveAppearance because multiple descriptions/clothing exist
        expect(mockResolveAppearance).toHaveBeenCalled()
      })

      it('should NOT skip when there are chat messages', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter1]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: [
            {
              characterId: 'char-1',
              selectedDescriptionId: null,
              clothingDescription: 'Blue jeans and white t-shirt',
              clothingSource: 'stored',
            },
          ],
        })

        await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Alice at the park',
          testSelection,
          testUserId,
          testChatId
        )

        // Should call mockResolveAppearance because messages exist
        expect(mockResolveAppearance).toHaveBeenCalled()
      })
    })

    describe('LLM resolution with multiple descriptions', () => {
      it('should call mockResolveAppearance and map results correctly', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter2]

        const llmResult: AppearanceResolutionItem[] = [
          {
            characterId: 'char-2',
            selectedDescriptionId: 'desc-2b', // Weekend appearance
            clothingDescription: 'Comfortable jeans and plaid shirt',
            clothingSource: 'stored',
          },
        ]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: llmResult,
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Bob relaxing at home',
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockResolveAppearance).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              characterId: 'char-2',
              characterName: 'Bob',
            }),
          ]),
          sampleMessages,
          'Bob relaxing at home',
          testSelection,
          testUserId,
          testChatId
        )

        expect(result.llmResolved).toBe(true)
        expect(result.appearances).toHaveLength(1)
        expect(result.appearances[0]).toEqual({
          characterId: 'char-2',
          characterName: 'Bob',
          // Should use the selected description (desc-2b)
          physicalDescription: 'A middle-aged man with short gray hair, rectangular glasses, wearing comfortable jeans and a plaid flannel shirt',
          physicalDescriptionName: 'Casual appearance',
          clothingDescription: 'Comfortable jeans and plaid shirt',
          clothingSource: 'stored',
          wasSanitized: false,
        })
      })

      it('should handle narrative clothing source', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter1]

        const llmResult: AppearanceResolutionItem[] = [
          {
            characterId: 'char-1',
            selectedDescriptionId: null,
            clothingDescription: 'A flowing summer dress mentioned in conversation',
            clothingSource: 'narrative', // From chat context
          },
        ]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: llmResult,
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Alice in her new dress',
          testSelection,
          testUserId,
          testChatId
        )

        expect(result.llmResolved).toBe(true)
        expect(result.appearances[0].clothingSource).toBe('narrative')
        expect(result.appearances[0].clothingDescription).toBe('A flowing summer dress mentioned in conversation')
      })

      it('should fall back to first description when selectedDescriptionId is null', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter2]

        const llmResult: AppearanceResolutionItem[] = [
          {
            characterId: 'char-2',
            selectedDescriptionId: null, // Use default
            clothingDescription: 'Business suit',
            clothingSource: 'stored',
          },
        ]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: llmResult,
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Bob at work',
          testSelection,
          testUserId,
          testChatId
        )

        // Should use first description (desc-2a)
        expect(result.appearances[0].physicalDescription).toBe(
          'A middle-aged professional man with short gray hair, rectangular glasses, wearing a formal navy suit with a red tie'
        )
        expect(result.appearances[0].physicalDescriptionName).toBe('Work appearance')
      })

      it('should handle invalid selectedDescriptionId by falling back to first', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter2]

        const llmResult: AppearanceResolutionItem[] = [
          {
            characterId: 'char-2',
            selectedDescriptionId: 'invalid-id', // Does not exist
            clothingDescription: 'Some clothes',
            clothingSource: 'default',
          },
        ]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: llmResult,
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Bob somewhere',
          testSelection,
          testUserId,
          testChatId
        )

        // Should fall back to first description
        expect(result.appearances[0].physicalDescriptionName).toBe('Work appearance')
      })
    })

    describe('Fallback on LLM failure', () => {
      it('should return defaults with llmResolved=false when mockResolveAppearance fails', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter1]

        mockResolveAppearance.mockResolvedValue({
          success: false,
          error: 'LLM API error',
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Alice at the park',
          testSelection,
          testUserId,
          testChatId
        )

        expect(result.llmResolved).toBe(false)
        expect(result.appearances).toHaveLength(1)
        expect(result.appearances[0]).toEqual({
          characterId: 'char-1',
          characterName: 'Alice',
          physicalDescription: 'A young woman with long flowing red hair, vibrant green eyes, fair skin, wearing casual clothes',
          physicalDescriptionName: 'Default',
          clothingDescription: '- **top:** Casual Outfit (Blue jeans and a white t-shirt)\n- **bottom:** bottomless\n- **footwear:** barefoot\n- **accessories:** no accessories\n',
          clothingSource: 'stored',
          wasSanitized: false,
        })
      })

      it('should return defaults with llmResolved=false when mockResolveAppearance returns empty result', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter1]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: [], // Empty — likely content refusal
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Alice somewhere',
          testSelection,
          testUserId,
          testChatId
        )

        expect(result.llmResolved).toBe(false)
        expect(result.appearances).toHaveLength(1)
        expect(result.appearances[0].physicalDescriptionName).toBe('Default')
      })

      it('should return defaults with llmResolved=false when mockResolveAppearance result is undefined', async () => {
        const characters: AppearanceResolutionInput[] = [sampleCharacter1]

        mockResolveAppearance.mockResolvedValue({
          success: true,
          result: undefined,
        })

        const result = await resolveCharacterAppearances(
          characters,
          sampleMessages,
          'Alice somewhere',
          testSelection,
          testUserId,
          testChatId
        )

        expect(result.llmResolved).toBe(false)
        expect(result.appearances).toHaveLength(1)
        expect(result.appearances[0].physicalDescriptionName).toBe('Default')
      })
    })

    describe('Empty characters array', () => {
      it('should return empty result without calling LLM', async () => {
        const result = await resolveCharacterAppearances(
          [],
          sampleMessages,
          'Empty scene',
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockResolveAppearance).not.toHaveBeenCalled()
        expect(result.llmResolved).toBe(true)
        expect(result.appearances).toEqual([])
      })
    })

    describe('Character with no descriptions', () => {
      it('should use character name as fallback description', async () => {
        const noDescChar: AppearanceResolutionInput = {
          characterId: 'char-3',
          characterName: 'Charlie',
          physicalDescriptions: [],
          equippedWardrobeItems: [],
        }

        const result = await resolveCharacterAppearances(
          [noDescChar],
          [],
          'Charlie appears',
          testSelection,
          testUserId,
          testChatId
        )

        expect(result.appearances[0].physicalDescription).toBe('Charlie')
        expect(result.appearances[0].physicalDescriptionName).toBe('default')
        expect(result.appearances[0].clothingDescription).toBe('')
      })
    })

    describe('Tier fallback logic', () => {
      it('should use completePrompt if available', async () => {
        const result = await resolveCharacterAppearances(
          [sampleCharacter1],
          [],
          'Test',
          testSelection,
          testUserId
        )

        expect(result.appearances[0].physicalDescription).toBe(
          'A young woman with long flowing red hair, vibrant green eyes, fair skin, wearing casual clothes'
        )
      })

      it('should fall back through tiers if higher tiers missing', async () => {
        const charWithPartialTiers: AppearanceResolutionInput = {
          characterId: 'char-4',
          characterName: 'Diana',
          physicalDescriptions: [
            {
              id: 'desc-4',
              name: 'Default',
              usageContext: null,
              shortPrompt: 'A person',
              mediumPrompt: null,
              longPrompt: null,
              completePrompt: null,
              fullDescription: null,
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          equippedWardrobeItems: [],
        }

        const result = await resolveCharacterAppearances(
          [charWithPartialTiers],
          [],
          'Test',
          testSelection,
          testUserId
        )

        expect(result.appearances[0].physicalDescription).toBe('A person')
      })
    })
  })

  describe('sanitizeAppearancesIfNeeded', () => {
    const sampleAppearances: ResolvedCharacterAppearance[] = [
      {
        characterId: 'char-1',
        characterName: 'Alice',
        physicalDescription: 'A young woman with red hair',
        physicalDescriptionName: 'Default',
        clothingDescription: 'Blue jeans and t-shirt',
        clothingSource: 'stored',
        wasSanitized: false,
      },
    ]

    describe('Sanitization skipped when OFF', () => {
      it('should return unchanged when Concierge mode is OFF', async () => {
        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOffSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockClassifyContent).not.toHaveBeenCalled()
        expect(mockSanitizeAppearance).not.toHaveBeenCalled()
        expect(result).toBe(sampleAppearances) // Same reference
      })
    })

    describe('Sanitization skipped for dangerous chat with uncensored provider', () => {
      it('should return unchanged when isDangerousChat=true and hasUncensoredImageProvider=true', async () => {
        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          true, // isDangerousChat
          true, // hasUncensoredImageProvider
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockClassifyContent).not.toHaveBeenCalled()
        expect(mockSanitizeAppearance).not.toHaveBeenCalled()
        expect(result).toBe(sampleAppearances)
      })
    })

    describe('Content classification', () => {
      it('should classify concatenated appearance text', async () => {
        mockClassifyContent.mockResolvedValue({
          isDangerous: false,
          score: 0.2,
          categories: [],
        })

        await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockClassifyContent).toHaveBeenCalledWith(
          'A young woman with red hair Blue jeans and t-shirt',
          testSelection,
          testUserId,
          dangerOnSettings,
          testChatId
        )
      })

      it('should return unchanged when content classified as safe', async () => {
        mockClassifyContent.mockResolvedValue({
          isDangerous: false,
          score: 0.1,
          categories: [],
        })

        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockSanitizeAppearance).not.toHaveBeenCalled()
        expect(result).toBe(sampleAppearances)
      })
    })

    describe('Sanitization triggered', () => {
      it('should sanitize when content is dangerous and no uncensored provider', async () => {
        mockClassifyContent.mockResolvedValue({
          isDangerous: true,
          score: 0.9,
          categories: [{ category: 'sexual', score: 0.9 }],
        })

        const sanitizedResult = [
          {
            characterId: 'char-1',
            appearanceText: 'A young woman with red hair wearing casual clothes',
          },
        ]

        mockSanitizeAppearance.mockResolvedValue({
          success: true,
          result: sanitizedResult,
        })

        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockSanitizeAppearance).toHaveBeenCalledWith(
          [
            {
              characterId: 'char-1',
              appearanceText: 'A young woman with red hair. Blue jeans and t-shirt',
            },
          ],
          testSelection,
          testUserId,
          testChatId
        )

        expect(result[0].wasSanitized).toBe(true)
        expect(result[0].physicalDescription).toBe('A young woman with red hair wearing casual clothes')
        expect(result[0].clothingDescription).toBe('') // Cleared
      })

      it('should NOT sanitize when dangerous but uncensored provider available', async () => {
        mockClassifyContent.mockResolvedValue({
          isDangerous: true,
          score: 0.9,
          categories: [{ category: 'sexual', score: 0.9 }],
        })

        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          true, // hasUncensoredImageProvider
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockSanitizeAppearance).not.toHaveBeenCalled()
        expect(result).toBe(sampleAppearances)
      })

      it('should only sanitize changed appearances', async () => {
        const multiAppearances: ResolvedCharacterAppearance[] = [
          {
            characterId: 'char-1',
            characterName: 'Alice',
            physicalDescription: 'Safe description',
            physicalDescriptionName: 'Default',
            clothingDescription: 'Safe clothes',
            clothingSource: 'stored',
            wasSanitized: false,
          },
          {
            characterId: 'char-2',
            characterName: 'Bob',
            physicalDescription: 'Another safe description',
            physicalDescriptionName: 'Default',
            clothingDescription: 'Safe outfit',
            clothingSource: 'stored',
            wasSanitized: false,
          },
        ]

        mockClassifyContent.mockResolvedValue({
          isDangerous: true,
          score: 0.9,
          categories: [{ category: 'sexual', score: 0.9 }],
        })

        // Only char-1 gets sanitized
        const sanitizedResult = [
          {
            characterId: 'char-1',
            appearanceText: 'Sanitized safe description and clothes',
          },
          {
            characterId: 'char-2',
            appearanceText: 'Another safe description. Safe outfit', // Unchanged
          },
        ]

        mockSanitizeAppearance.mockResolvedValue({
          success: true,
          result: sanitizedResult,
        })

        const result = await sanitizeAppearancesIfNeeded(
          multiAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(result[0].wasSanitized).toBe(true)
        expect(result[1].wasSanitized).toBe(false) // Not changed
      })
    })

    describe('Sanitization fail-safe', () => {
      it('should return original when classification fails', async () => {
        mockClassifyContent.mockRejectedValue(new Error('Classification service down'))

        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(mockSanitizeAppearance).not.toHaveBeenCalled()
        expect(result).toBe(sampleAppearances)
      })

      it('should return original when sanitization fails', async () => {
        mockClassifyContent.mockResolvedValue({
          isDangerous: true,
          score: 0.9,
          categories: [{ category: 'sexual', score: 0.9 }],
        })

        mockSanitizeAppearance.mockResolvedValue({
          success: false,
          error: 'Sanitization service error',
        })

        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(result).toBe(sampleAppearances) // Pass through on error
      })

      it('should return original when sanitization result is undefined', async () => {
        mockClassifyContent.mockResolvedValue({
          isDangerous: true,
          score: 0.9,
          categories: [{ category: 'sexual', score: 0.9 }],
        })

        mockSanitizeAppearance.mockResolvedValue({
          success: true,
          result: undefined,
        })

        const result = await sanitizeAppearancesIfNeeded(
          sampleAppearances,
          dangerOnSettings,
          false,
          false,
          testSelection,
          testUserId,
          testChatId
        )

        expect(result).toBe(sampleAppearances)
      })
    })
  })

  describe('Integration with buildExpansionContext', () => {
    it('should override tiers and clothing with resolved appearances', () => {
      const resolvedPlaceholders = [
        {
          placeholder: '{{Alice}}',
          name: 'Alice',
          entityId: 'char-1',
          type: 'character' as const,
          descriptions: [
            {
              id: 'desc-1',
              name: 'Default',
              usageContext: 'General',
              shortPrompt: 'A woman',
              mediumPrompt: 'A woman with red hair',
              longPrompt: 'A woman with long red hair and green eyes',
              completePrompt: 'A woman with long red hair, green eyes, and fair skin',
              fullDescription: null,
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          equippedWardrobeItems: [
            { slot: 'top', title: 'White Shirt', description: 'A plain white shirt' },
            { slot: 'bottom', title: 'Blue Jeans', description: 'Blue jeans' },
          ],
        },
      ]

      const resolvedAppearances: ResolvedCharacterAppearance[] = [
        {
          characterId: 'char-1',
          characterName: 'Alice',
          physicalDescription: 'A woman with red hair wearing a summer dress',
          physicalDescriptionName: 'Context-resolved',
          clothingDescription: 'A flowing yellow summer dress',
          clothingSource: 'narrative',
          wasSanitized: false,
        },
      ]

      const context = buildExpansionContext(
        '{{Alice}} walking in the park',
        resolvedPlaceholders,
        'OPENAI',
        resolvedAppearances
      )

      expect(context.placeholders).toHaveLength(1)
      expect(context.placeholders[0]).toEqual({
        placeholder: '{{Alice}}',
        name: 'Alice',
        usageContext: 'Context-resolved',
        tiers: {
          complete: 'A woman with red hair wearing a summer dress',
        },
        clothing: [
          {
            name: 'Current outfit (from story)',
            usageContext: null,
            description: 'A flowing yellow summer dress',
          },
        ],
      })
    })

    it('should use stored clothing source naming', () => {
      const resolvedPlaceholders = [
        {
          placeholder: '{{Bob}}',
          name: 'Bob',
          entityId: 'char-2',
          type: 'character' as const,
          descriptions: [],
          equippedWardrobeItems: [],
        },
      ]

      const resolvedAppearances: ResolvedCharacterAppearance[] = [
        {
          characterId: 'char-2',
          characterName: 'Bob',
          physicalDescription: 'A man with gray hair',
          physicalDescriptionName: 'Default',
          clothingDescription: 'Navy suit and red tie',
          clothingSource: 'stored',
          wasSanitized: false,
        },
      ]

      const context = buildExpansionContext(
        '{{Bob}} at the office',
        resolvedPlaceholders,
        'OPENAI',
        resolvedAppearances
      )

      expect(context.placeholders[0].clothing).toEqual([
        {
          name: 'Current outfit',
          usageContext: null,
          description: 'Navy suit and red tie',
        },
      ])
    })

    it('should omit clothing when description is empty', () => {
      const resolvedPlaceholders = [
        {
          placeholder: '{{Alice}}',
          name: 'Alice',
          entityId: 'char-1',
          type: 'character' as const,
          descriptions: [],
          equippedWardrobeItems: [],
        },
      ]

      const resolvedAppearances: ResolvedCharacterAppearance[] = [
        {
          characterId: 'char-1',
          characterName: 'Alice',
          physicalDescription: 'A woman',
          physicalDescriptionName: 'Default',
          clothingDescription: '', // Empty
          clothingSource: 'default',
          wasSanitized: false,
        },
      ]

      const context = buildExpansionContext(
        '{{Alice}}',
        resolvedPlaceholders,
        'OPENAI',
        resolvedAppearances
      )

      expect(context.placeholders[0].clothing).toBeUndefined()
    })

    it('should fall back to raw data when no resolved appearance found', () => {
      const resolvedPlaceholders = [
        {
          placeholder: '{{Alice}}',
          name: 'Alice',
          entityId: 'char-1',
          type: 'character' as const,
          descriptions: [
            {
              id: 'desc-1',
              name: 'Default',
              usageContext: 'General',
              shortPrompt: 'A woman',
              mediumPrompt: 'A woman with red hair',
              longPrompt: 'A woman with long red hair',
              completePrompt: 'A woman with long red hair and green eyes',
              fullDescription: null,
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          equippedWardrobeItems: [
            { slot: 'top', title: 'Casual Top', description: 'Casual clothes' },
          ],
        },
      ]

      const resolvedAppearances: ResolvedCharacterAppearance[] = [
        // No match for char-1
      ]

      const context = buildExpansionContext(
        '{{Alice}}',
        resolvedPlaceholders,
        'OPENAI',
        resolvedAppearances
      )

      // Should fall back to raw description data
      expect(context.placeholders[0].tiers).toEqual({
        short: 'A woman',
        medium: 'A woman with red hair',
        long: 'A woman with long red hair',
        complete: 'A woman with long red hair and green eyes',
      })
      // clothing field removed from placeholders — wardrobe items are loaded separately via equipped state
      expect(context.placeholders[0].clothing).toBeUndefined()
    })

    it('should work without resolved appearances parameter', () => {
      const resolvedPlaceholders = [
        {
          placeholder: '{{Alice}}',
          name: 'Alice',
          entityId: 'char-1',
          type: 'character' as const,
          descriptions: [
            {
              id: 'desc-1',
              name: 'Default',
              usageContext: null,
              shortPrompt: 'A woman',
              mediumPrompt: null,
              longPrompt: null,
              completePrompt: null,
              fullDescription: null,
              createdAt: ts,
              updatedAt: ts,
            },
          ],
          equippedWardrobeItems: [],
        },
      ]

      const context = buildExpansionContext(
        '{{Alice}}',
        resolvedPlaceholders,
        'OPENAI'
        // No resolvedAppearances
      )

      expect(context.placeholders[0].tiers).toEqual({
        short: 'A woman',
      })
    })
  })
})
