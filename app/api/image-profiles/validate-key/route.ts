/**
 * API Key Validation Endpoint for Image Providers
 * Phase 6: API Endpoints
 *
 * POST   /api/image-profiles/validate-key  - Validate an API key for image generation
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { decryptApiKey } from '@/lib/encryption'
import { logger } from '@/lib/logger'

/**
 * POST /api/image-profiles/validate-key
 * Validate an API key for image generation
 *
 * Body: {
 *   provider: string (dynamic, depends on registered plugins),
 *   apiKeyId?: string (optional - if provided, uses stored key)
 *   apiKey?: string (optional - if provided, validates the key directly)
 * }
 *
 * Response:
 * {
 *   valid: boolean,
 *   message?: string,
 *   models?: string[]
 * }
 */
export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    const body = await request.json()
    const { provider, apiKeyId, apiKey } = body

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      )
    }

    // Validate provider by attempting to get it
    let imageProvider
    try {
      imageProvider = createImageProvider(provider)
    } catch {
      return NextResponse.json(
        { error: `Provider ${provider} is not available` },
        { status: 400 }
      )
    }

    let keyToValidate: string | null = null

    // Get the API key to validate
    if (apiKeyId) {
      // Fetch from stored keys
      const storedKey = await repos.connections.findApiKeyById(apiKeyId)

      if (!storedKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      try {
        keyToValidate = decryptApiKey(
          storedKey.ciphertext,
          storedKey.iv,
          storedKey.authTag,
          user.id
        )
      } catch (error) {
        logger.error('Failed to decrypt API key', { context: 'validate-key' }, error instanceof Error ? error : undefined)
        return NextResponse.json(
          { error: 'Failed to decrypt API key' },
          { status: 500 }
        )
      }
    } else if (apiKey) {
      // Use provided key directly
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return NextResponse.json(
          { error: 'API key must be a non-empty string' },
          { status: 400 }
        )
      }
      keyToValidate = apiKey.trim()
    } else {
      return NextResponse.json(
        { error: 'Either apiKeyId or apiKey is required' },
        { status: 400 }
      )
    }

    // Validate the API key
    let isValid = false
    let models: string[] = []

    try {
      isValid = await imageProvider.validateApiKey(keyToValidate)

      if (isValid) {
        // Try to get available models
        try {
          models = await imageProvider.getAvailableModels(keyToValidate)
        } catch (error) {
          logger.error('Failed to fetch models', { context: 'validate-key', provider }, error instanceof Error ? error : undefined)
          // Key is valid but models fetch failed - still return success
          models = imageProvider.supportedModels
        }
      }
    } catch (error) {
      logger.error('API key validation error', { context: 'validate-key', provider }, error instanceof Error ? error : undefined)
      isValid = false
    }

    return NextResponse.json({
      valid: isValid,
      message: isValid
        ? 'API key is valid'
        : 'API key validation failed. Please check your key and try again.',
      models: isValid ? models : undefined,
    })
  } catch (error) {
    logger.error('Failed to validate API key', { context: 'validate-key' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to validate API key' },
      { status: 500 }
    )
  }
})
