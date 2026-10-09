/**
 * Wardrobe Image Analysis
 *
 * Analyzes an uploaded image using a vision-capable LLM to propose
 * wardrobe items (clothing, accessories) that can be added to a character's
 * wardrobe. The profile and the request are the shared vision path
 * (`lib/llm/vision-request.ts`) the describe-fallback uses: a profile that
 * can actually receive the image, the bytes shrunk for transport, and the
 * answer believed only once the image is known to have arrived (bug 197).
 *
 * @module wardrobe/image-analysis
 */

import { trackActivity } from '@/lib/background-jobs/activity-registry'
import { resolveVisionProfile, sendVisionRequest } from '@/lib/llm/vision-request'
import { logger } from '@/lib/logger'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { WardrobeItemTypeEnum } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

const moduleLogger = logger.child({ module: 'wardrobe-image-analysis' })

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single proposed wardrobe item from image analysis
 */
export interface ProposedWardrobeItem {
  title: string
  description: string
  types: WardrobeItemType[]
  appropriateness: string
}

/**
 * A proposed name for the whole look — the ensemble the proposed items make
 * together. The client turns it into a composite item whose components are
 * the pieces it just created, so it carries no ids or types of its own.
 */
export interface ProposedOutfit {
  title: string
  description: string
  appropriateness: string
}

/**
 * Result of analyzing an image for wardrobe items
 */
export interface ImageAnalysisResult {
  proposedItems: ProposedWardrobeItem[]
  /** Null when the model named no ensemble (or found fewer than two pieces). */
  proposedOutfit: ProposedOutfit | null
  provider: string
  model: string
}

/**
 * Parameters for image analysis
 */
export interface ImageAnalysisParams {
  /** Base64-encoded image data */
  image: string
  /** MIME type of the image */
  mimeType: string
  /** Optional user guidance text */
  guidance?: string
}

// ============================================================================
// PROMPT CONSTRUCTION
// ============================================================================

const SYSTEM_PROMPT = `You are a fashion and costume analyst. Your task is to identify distinct clothing items and accessories visible in the provided image and describe each one in detail.

For each item you identify:
1. Give it a concise, evocative title (e.g., "Emerald Silk Evening Gown", "Worn Leather Ankle Boots")
2. Write a detailed description capturing texture, fit, color, material, and notable details. Use vivid, descriptive language — not clinical catalog copy.
3. Classify it into one or more slot types: "top", "bottom", "footwear", "accessories", "hair"
   - Items that span multiple slots (e.g., a dress covering top + bottom, a jumpsuit) should include all applicable types
   - If the subject wears a distinct, deliberate hairstyle (braids, an updo, an elaborate coif, a wig), emit ONE "hair" item describing the styling. Plain, loose, unstyled hair is NOT an item.
4. Suggest appropriateness tags (e.g., "formal", "casual", "combat", "intimate", "evening", "everyday") based on the visual context

Then name the ensemble the items make together — the whole look, as one outfit:
- A concise, evocative title for the outfit as a whole (e.g., "Midnight Gala Ensemble", "Rain-Soaked Detective's Kit")
- A short description of the overall look and the impression it gives, without re-describing each piece
- Appropriateness tags for the outfit as a whole

Return your analysis as a JSON object with this exact structure:
{
  "items": [
    {
      "title": "Item Title",
      "description": "Detailed description of the item...",
      "types": ["top"],
      "appropriateness": "casual, everyday"
    }
  ],
  "outfit": {
    "title": "Outfit Title",
    "description": "Overall impression of the ensemble...",
    "appropriateness": "evening, formal"
  }
}

Important rules:
- Focus ONLY on clothing, accessories, and a deliberate hairstyle if one is present. Do not describe faces, bodies, backgrounds, or other non-wearable features.
- Each distinct garment or accessory should be its own item.
- Valid types are ONLY: "top", "bottom", "footwear", "accessories", "hair"
- If you identify fewer than two items, set "outfit" to null.
- If you cannot identify any clothing items, return {"items": [], "outfit": null}
- Return ONLY the JSON object, no additional text or markdown.`

function buildUserPrompt(guidance?: string): string {
  let prompt =
    'Analyze this image and identify all visible clothing items, accessories, and any deliberate hairstyle.'

  if (guidance) {
    prompt += `\n\nAdditional guidance from the user: ${guidance}`
  }

  return prompt
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

const VALID_TYPES = new Set<string>(WardrobeItemTypeEnum.options)

/**
 * Parse and validate the LLM's JSON response into proposed items plus the
 * optional ensemble name.
 */
function parseAnalysisResponse(content: string): {
  proposedItems: ProposedWardrobeItem[]
  proposedOutfit: ProposedOutfit | null
} {
  // Strip markdown code fences if present
  let jsonStr = content.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    moduleLogger.error('[Wardrobe Image Analysis] Failed to parse LLM response as JSON', {
      contentPreview: content.substring(0, 200),
    })
    throw new Error('The AI returned an invalid response. Please try again.')
  }

  // Validate structure
  if (!parsed || typeof parsed !== 'object' || !('items' in parsed)) {
    throw new Error('The AI returned an unexpected response format. Please try again.')
  }

  const items = (parsed as { items: unknown[] }).items
  if (!Array.isArray(items)) {
    throw new Error('The AI returned an unexpected response format. Please try again.')
  }

  // Validate and normalize each item
  const proposedItems = items
    .filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== 'object') return false
      if (typeof (item as Record<string, unknown>).title !== 'string') return false
      if (typeof (item as Record<string, unknown>).description !== 'string') return false
      return true
    })
    .map((item) => {
      // Normalize types to only valid values
      const rawTypes = Array.isArray(item.types) ? item.types : []
      const validatedTypes = rawTypes.filter(
        (t): t is WardrobeItemType => typeof t === 'string' && VALID_TYPES.has(t)
      )

      return {
        title: String(item.title).trim(),
        description: String(item.description).trim(),
        types: validatedTypes.length > 0 ? validatedTypes : ['accessories' as WardrobeItemType],
        appropriateness: typeof item.appropriateness === 'string'
          ? String(item.appropriateness).trim()
          : '',
      }
    })

  return {
    proposedItems,
    proposedOutfit: parseProposedOutfit((parsed as { outfit?: unknown }).outfit, proposedItems.length),
  }
}

/**
 * The outfit is optional garnish: a missing, malformed, or untitled one is
 * dropped rather than failing the analysis, and an ensemble of fewer than two
 * pieces is no ensemble at all.
 */
function parseProposedOutfit(raw: unknown, itemCount: number): ProposedOutfit | null {
  if (itemCount < 2 || !raw || typeof raw !== 'object') return null
  const outfit = raw as Record<string, unknown>
  const title = typeof outfit.title === 'string' ? outfit.title.trim() : ''
  if (!title) {
    moduleLogger.debug('[Wardrobe Image Analysis] Model returned an outfit without a title; dropping it')
    return null
  }
  return {
    title,
    description: typeof outfit.description === 'string' ? outfit.description.trim() : '',
    appropriateness: typeof outfit.appropriateness === 'string' ? outfit.appropriateness.trim() : '',
  }
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze an image to propose wardrobe items using a vision-capable LLM.
 *
 * @param params - Image data, MIME type, and optional guidance
 * @param repos - Repository container for data access
 * @param userId - The user's ID for profile/key resolution
 * @returns Proposed wardrobe items or throws an error
 *
 * Reading an image with a vision model is image work the user waits on, so the
 * whole analysis registers with the activity registry and lights "Img".
 */
export async function analyzeImageForWardrobeItems(
  params: ImageAnalysisParams,
  repos: RepositoryContainer,
  userId: string
): Promise<ImageAnalysisResult> {
  return trackActivity('image', () => runAnalyzeImageForWardrobeItems(params, repos, userId))
}

/** Generous: a detailed multi-item analysis on a slow vision model takes a while. */
const ANALYSIS_TIMEOUT_MS = 120_000
const ANALYSIS_TEMPERATURE = 0.5
const ANALYSIS_MAX_TOKENS = 4000

const NO_VISION_PROFILE_MESSAGE =
  'No vision-capable provider is configured. This feature requires a provider that supports ' +
  'image analysis (e.g., Anthropic Claude, OpenAI GPT-4o, Google Gemini). ' +
  'Configure one in your provider settings, or set an Image Description Profile in Chat settings.'

async function runAnalyzeImageForWardrobeItems(
  params: ImageAnalysisParams,
  repos: RepositoryContainer,
  userId: string
): Promise<ImageAnalysisResult> {
  moduleLogger.debug('[Wardrobe Image Analysis] Starting analysis', {
    mimeType: params.mimeType,
    imageSize: params.image.length,
    hasGuidance: !!params.guidance,
  })

  // 1. The shared vision resolver: the configured Image Description profile
  // when it can actually receive an image (bug 91's predicate), else any
  // profile that can, a non-cheap one first — quality is the point here.
  const profile = await resolveVisionProfile(repos, userId, {
    prefer: 'capable',
    configured: 'skip-incapable',
  })
  if (!profile) {
    throw new Error(NO_VISION_PROFILE_MESSAGE)
  }

  const userContent = buildUserPrompt(params.guidance)

  // 2. The shared vision request: transport shrink, logging, and the
  // arrival check before the answer is believed (bug 197).
  let sent
  try {
    sent = await sendVisionRequest({
      profile,
      repos,
      userId,
      attachment: {
        id: 'wardrobe-analysis-image',
        filename: `analysis.${params.mimeType.split('/')[1] || 'jpg'}`,
        mimeType: params.mimeType,
        size: Math.ceil(params.image.length * 0.75), // Approximate decoded size
        data: params.image,
      },
      systemPrompt: SYSTEM_PROMPT,
      instruction: userContent,
      sampling: { temperature: ANALYSIS_TEMPERATURE, maxTokens: ANALYSIS_MAX_TOKENS },
      timeoutMs: ANALYSIS_TIMEOUT_MS,
      logType: 'WARDROBE_IMAGE_ANALYSIS',
      requireApiKey: true,
    })
  } catch (error) {
    moduleLogger.error('[Wardrobe Image Analysis] LLM call failed', {
      provider: profile.provider,
      model: profile.modelName,
    }, error instanceof Error ? error : new Error(String(error)))
    throw new Error(
      `Image analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'Please try again or use a different provider.'
    )
  }

  if (!sent.ok) {
    moduleLogger.warn('[Wardrobe Image Analysis] Vision request refused', {
      provider: profile.provider,
      model: profile.modelName,
      refusal: sent.refusal,
      detail: sent.detail,
    })
    switch (sent.refusal) {
      case 'missing-api-key':
        throw new Error(
          `API key not found for provider ${profile.provider}. Check your connection profile settings.`
        )
      case 'image-not-received':
        throw new Error(
          `The AI returned an answer without seeing the image (${sent.detail}). ` +
          'Pick a vision profile on a model that genuinely reads images.'
        )
      default:
        throw new Error(NO_VISION_PROFILE_MESSAGE)
    }
  }

  // 3. Parse the response
  const { proposedItems, proposedOutfit } = parseAnalysisResponse(sent.response.content)

  moduleLogger.info('[Wardrobe Image Analysis] Analysis complete', {
    itemCount: proposedItems.length,
    hasOutfit: proposedOutfit !== null,
    provider: profile.provider,
    model: profile.modelName,
  })

  return {
    proposedItems,
    proposedOutfit,
    provider: profile.provider,
    model: profile.modelName,
  }
}
