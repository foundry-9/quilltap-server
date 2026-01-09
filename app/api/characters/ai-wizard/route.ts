/**
 * AI Wizard API Endpoint
 *
 * POST /api/characters/ai-wizard - Generate character content using AI
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm'
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { logger } from '@/lib/logger'
import { notFound, badRequest, serverError, validationError } from '@/lib/api/responses'
import type { ConnectionProfile, FileEntry } from '@/lib/schemas/types'
import type { FileAttachment } from '@/lib/llm/base'

// Request validation schema
const wizardRequestSchema = z.object({
  primaryProfileId: z.string().uuid(),
  visionProfileId: z.string().uuid().optional(),
  sourceType: z.enum(['existing', 'upload', 'gallery', 'skip']),
  imageId: z.string().uuid().optional(),
  characterName: z.string().min(1),
  existingData: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    personality: z.string().optional(),
    scenario: z.string().optional(),
    exampleDialogues: z.string().optional(),
    systemPrompt: z.string().optional(),
  }).optional(),
  background: z.string(),
  fieldsToGenerate: z.array(z.enum([
    'title',
    'description',
    'personality',
    'scenario',
    'exampleDialogues',
    'systemPrompt',
    'physicalDescription',
  ])),
  characterId: z.string().uuid().optional(),
})

type WizardRequest = z.infer<typeof wizardRequestSchema>

interface GeneratedPhysicalDescription {
  name: string
  shortPrompt: string
  mediumPrompt: string
  longPrompt: string
  completePrompt: string
  fullDescription: string
}

interface GeneratedData {
  title?: string
  description?: string
  personality?: string
  scenario?: string
  exampleDialogues?: string
  systemPrompt?: string
  physicalDescription?: GeneratedPhysicalDescription
}

/**
 * Build the context prompt for all generations
 */
function buildContextPrompt(
  characterName: string,
  background: string,
  existingData?: WizardRequest['existingData'],
  imageDescription?: string
): string {
  let context = `You are a character creation assistant for a roleplay/chat application. You are helping create a character profile that will be used by an AI to roleplay as this character.

Character Name: ${characterName}
`

  if (background.trim()) {
    context += `
Background/World Context:
${background}
`
  }

  if (imageDescription) {
    context += `
Visual Reference (from image analysis):
${imageDescription}
`
  }

  if (existingData) {
    const existingFields = []
    if (existingData.title?.trim()) existingFields.push(`Title: ${existingData.title}`)
    if (existingData.description?.trim()) existingFields.push(`Description: ${existingData.description}`)
    if (existingData.personality?.trim()) existingFields.push(`Personality: ${existingData.personality}`)
    if (existingData.scenario?.trim()) existingFields.push(`Scenario: ${existingData.scenario}`)

    if (existingFields.length > 0) {
      context += `
Existing Character Information:
${existingFields.join('\n')}
`
    }
  }

  return context
}

/**
 * Field-specific generation prompts
 */
const FIELD_PROMPTS = {
  title: `Generate a short, evocative title or epithet for this character (2-5 words).
Examples: "The Wandering Scholar", "Knight of the Fallen Star", "Last of the Old Guard"

Respond with ONLY the title, no quotes or explanation.`,

  description: `Write a comprehensive description of this character in 2-3 paragraphs. Include:
- Physical appearance (if visual reference available)
- Background and history
- Current situation/role
- Notable traits or features

Write in third person, present tense. Be vivid and specific.`,

  personality: `Describe this character's personality in 1-2 paragraphs. Include:
- Core personality traits (3-5 dominant traits)
- How they interact with others
- Their emotional tendencies
- Quirks or unique behavioral patterns

Write as instructions for how the character behaves, not as a story.`,

  scenario: `Write a default scenario/setting for interactions with this character in 1-2 paragraphs. Include:
- The typical environment where interactions take place
- The relationship context (stranger, friend, etc.)
- Any ongoing situation or circumstances
- Time period and world details if relevant

Write in present tense, setting the scene for roleplay.`,

  exampleDialogues: `Write 2-3 example dialogue exchanges that demonstrate this character's voice and personality.

Format each exchange as:
{{char}}: [Character's dialogue and actions]
{{user}}: [User's response]
{{char}}: [Character's follow-up]

Show variety in the character's emotional range and speech patterns. Include *actions* and *expressions* in asterisks.`,

  systemPrompt: `Write a system prompt that instructs an AI how to roleplay as this character. Include:
- Core identity and self-perception
- Speech patterns and vocabulary
- Key behaviors and reactions
- Important boundaries or limitations
- Relationship dynamics to maintain

Write as direct instructions to the AI, in second person ("You are...", "You always...").
Keep it under 500 words but comprehensive.`,
}

/**
 * Physical description generation prompts by level
 */
const PHYSICAL_DESCRIPTION_PROMPTS = {
  short: `Create an extremely concise visual description for image generation, maximum 350 characters.
Focus ONLY on: hair, eyes, skin, body type, and one distinctive feature.
Format: [trait], [trait], [trait]...
No sentences, just comma-separated descriptors.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  medium: `Create a concise visual description for image generation, maximum 500 characters.
Include: hair color/style, eye color, skin tone, body type, facial features, one or two clothing/style notes.
Write as a continuous description, no line breaks.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  long: `Create a detailed visual description for image generation, maximum 750 characters.
Include: complete hair description, eye details, skin, facial structure, body type, typical clothing style, posture, any distinctive marks or features.
Write as flowing description suitable for stable diffusion or DALL-E.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  complete: `Create a comprehensive visual description for image generation, maximum 1000 characters.
Include all physical details: hair (color, length, style, texture), eyes (color, shape, expression), face (shape, features, expression), body (type, height, build), skin (tone, texture, any marks), clothing (typical style, colors, accessories), posture and body language.
Optimized for AI image generation.
OUTPUT ONLY THE DESCRIPTION, NO EXPLANATION.`,

  full: `Write a complete, detailed physical description of this character in markdown format.
Structure with headers:
## Overview
Brief 1-2 sentence summary

## Face & Head
Hair, eyes, face shape, expressions, any facial features

## Body
Build, height, posture, distinguishing physical traits

## Style & Appearance
Typical clothing, accessories, grooming

## Distinctive Features
Unique marks, mannerisms, or visual traits

Be thorough and specific. This will be used as reference for consistent character portrayal.`,
}

/**
 * Generate a single field using the LLM
 */
async function generateField(
  provider: any,
  apiKey: string,
  modelName: string,
  contextPrompt: string,
  fieldPrompt: string,
  maxTokens: number = 500
): Promise<string> {
  const response = await provider.sendMessage(
    {
      model: modelName,
      messages: [
        {
          role: 'system',
          content: contextPrompt,
        },
        {
          role: 'user',
          content: fieldPrompt,
        },
      ],
      maxTokens,
      temperature: 0.8,
    },
    apiKey
  )

  if (!response?.content) {
    throw new Error('No response from model')
  }

  return response.content.trim()
}

// Maximum image size for vision models (5MB for most providers)
const MAX_VISION_IMAGE_SIZE = 5 * 1024 * 1024

/**
 * Generate image description using vision model
 */
async function generateImageDescription(
  imageFile: FileEntry,
  visionProfile: ConnectionProfile,
  apiKey: string
): Promise<string> {
  // Download image from storage
  if (!imageFile.storageKey) {
    throw new Error('Image file has no storage key')
  }

  const imageBuffer = await fileStorageManager.downloadFile(imageFile)

  // Check image size - most vision models have a 5MB limit
  if (imageBuffer.length > MAX_VISION_IMAGE_SIZE) {
    const sizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(1)
    throw new Error(
      `Image is too large (${sizeMB}MB). Vision models have a 5MB limit. ` +
      `Please use a smaller image or resize it before uploading.`
    )
  }

  const base64Data = imageBuffer.toString('base64')

  // Create file attachment
  const attachment: FileAttachment = {
    id: imageFile.id,
    filepath: imageFile.storageKey,
    filename: imageFile.originalFilename,
    mimeType: imageFile.mimeType,
    size: imageBuffer.length,
    data: base64Data,
  }

  // Create provider
  const provider = await createLLMProvider(
    visionProfile.provider,
    visionProfile.baseUrl || undefined
  )

  const response = await provider.sendMessage(
    {
      model: visionProfile.modelName,
      messages: [
        {
          role: 'user',
          content: 'Please describe this image in great detail. Focus on the physical appearance of any person or character shown. Include: face shape, eye color/shape, hair color/style/length, skin tone, body type/build, clothing, pose, and any distinctive features. Be thorough and specific.',
          attachments: [attachment],
        },
      ],
      maxTokens: 1000,
      temperature: 0.7,
    },
    apiKey
  )

  if (!response?.content) {
    throw new Error('No response from vision model')
  }

  return response.content.trim()
}

/**
 * Generate physical descriptions at all levels
 */
async function generatePhysicalDescriptions(
  provider: any,
  apiKey: string,
  modelName: string,
  contextPrompt: string
): Promise<GeneratedPhysicalDescription> {
  logger.debug('Starting physical description generation', {
    context: 'POST /api/characters/ai-wizard',
    levelsToGenerate: Object.keys(PHYSICAL_DESCRIPTION_PROMPTS),
  })

  const results: Partial<GeneratedPhysicalDescription> = {
    name: 'AI Generated',
  }

  // Generate each level
  for (const [level, prompt] of Object.entries(PHYSICAL_DESCRIPTION_PROMPTS)) {
    try {
      logger.debug(`Generating physical description level: ${level}`, {
        context: 'POST /api/characters/ai-wizard',
        level,
      })

      const maxTokens = level === 'full' ? 1500 : level === 'complete' ? 400 : 300
      const content = await generateField(provider, apiKey, modelName, contextPrompt, prompt, maxTokens)

      switch (level) {
        case 'short':
          results.shortPrompt = content.substring(0, 350)
          break
        case 'medium':
          results.mediumPrompt = content.substring(0, 500)
          break
        case 'long':
          results.longPrompt = content.substring(0, 750)
          break
        case 'complete':
          results.completePrompt = content.substring(0, 1000)
          break
        case 'full':
          results.fullDescription = content
          break
      }

      logger.debug(`Generated physical description level: ${level}`, {
        context: 'POST /api/characters/ai-wizard',
        level,
        contentLength: content.length,
      })
    } catch (error) {
      logger.error(`Failed to generate physical description level: ${level}`, {
        context: 'POST /api/characters/ai-wizard',
        level,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error // Re-throw to be caught by the main error handler
    }
  }

  logger.debug('Completed physical description generation', {
    context: 'POST /api/characters/ai-wizard',
    hasShort: !!results.shortPrompt,
    hasMedium: !!results.mediumPrompt,
    hasLong: !!results.longPrompt,
    hasComplete: !!results.completePrompt,
    hasFull: !!results.fullDescription,
  })

  return results as GeneratedPhysicalDescription
}

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    // Parse and validate request
    const body = await req.json()
    const request = wizardRequestSchema.parse(body)

    logger.info('AI Wizard generation started', {
      context: 'POST /api/characters/ai-wizard',
      userId: user.id,
      characterName: request.characterName,
      fieldsToGenerate: request.fieldsToGenerate,
      sourceType: request.sourceType,
    })

    // Get primary profile
    const primaryProfile = await repos.connections.findById(request.primaryProfileId)
    if (!primaryProfile || primaryProfile.userId !== user.id) {
      return notFound('Primary profile')
    }

    // Get primary profile API key
    let primaryApiKey = ''
    if (primaryProfile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(primaryProfile.apiKeyId, user.id)
      if (apiKey) {
        primaryApiKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id)
      }
    }

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins()
      if (!initResult.success) {
        return serverError('Plugin system initialization failed')
      }
    }

    // Create primary provider
    const primaryProvider = await createLLMProvider(
      primaryProfile.provider,
      primaryProfile.baseUrl || undefined
    )

    // Handle image description if needed
    let imageDescription: string | undefined
    if ((request.sourceType === 'upload' || request.sourceType === 'gallery') && request.imageId) {
      // Get image file
      const imageFile = await repos.files.findById(request.imageId)
      if (!imageFile || imageFile.userId !== user.id) {
        return notFound('Image')
      }

      // Determine which profile to use for vision
      let visionProfile = primaryProfile
      let visionApiKey = primaryApiKey

      if (!profileSupportsMimeType(primaryProfile, imageFile.mimeType)) {
        // Need secondary vision profile
        if (!request.visionProfileId) {
          return badRequest('Vision profile required for image analysis')
        }

        const secondaryProfile = await repos.connections.findById(request.visionProfileId)
        if (!secondaryProfile || secondaryProfile.userId !== user.id) {
          return notFound('Vision profile')
        }

        if (secondaryProfile.apiKeyId) {
          const apiKey = await repos.connections.findApiKeyByIdAndUserId(
            secondaryProfile.apiKeyId,
            user.id
          )
          if (apiKey) {
            visionApiKey = decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id)
          }
        }

        visionProfile = secondaryProfile
      }

      // Generate image description
      try {
        imageDescription = await generateImageDescription(imageFile, visionProfile, visionApiKey)
        logger.debug('Image description generated', {
          context: 'POST /api/characters/ai-wizard',
          descriptionLength: imageDescription.length,
        })
      } catch (error) {
        logger.error('Failed to generate image description', {
          context: 'POST /api/characters/ai-wizard',
          error: error instanceof Error ? error.message : String(error),
        })
        return serverError(`Failed to analyze image: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Build context prompt
    const contextPrompt = buildContextPrompt(
      request.characterName,
      request.background,
      request.existingData,
      imageDescription
    )

    // Generate requested fields
    const generated: GeneratedData = {}
    const errors: Record<string, string> = {}

    for (const field of request.fieldsToGenerate) {
      try {
        if (field === 'physicalDescription') {
          generated.physicalDescription = await generatePhysicalDescriptions(
            primaryProvider,
            primaryApiKey,
            primaryProfile.modelName,
            contextPrompt
          )
        } else {
          const fieldPrompt = FIELD_PROMPTS[field]
          const maxTokens = field === 'exampleDialogues' || field === 'systemPrompt' ? 1000 : 500
          generated[field] = await generateField(
            primaryProvider,
            primaryApiKey,
            primaryProfile.modelName,
            contextPrompt,
            fieldPrompt,
            maxTokens
          )
        }

        logger.debug(`Generated field: ${field}`, {
          context: 'POST /api/characters/ai-wizard',
          field,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Generation failed'
        errors[field] = errorMessage
        logger.error(`Failed to generate field: ${field}`, {
          context: 'POST /api/characters/ai-wizard',
          field,
          error: errorMessage,
        })
      }
    }

    logger.info('AI Wizard generation complete', {
      context: 'POST /api/characters/ai-wizard',
      fieldsGenerated: Object.keys(generated),
      fieldsWithErrors: Object.keys(errors),
    })

    return NextResponse.json({
      success: true,
      generated,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error)
    }

    logger.error('AI Wizard generation failed', {
      context: 'POST /api/characters/ai-wizard',
      error: error instanceof Error ? error.message : String(error),
    })

    return serverError(error instanceof Error ? error.message : 'Generation failed')
  }
})
