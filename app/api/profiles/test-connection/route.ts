/**
 * Connection Profile Testing Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/profiles/test-connection - Test if connection settings are valid
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { decryptApiKey } from '@/lib/encryption'
import { ProviderEnum } from '@/lib/schemas/types'
import { testProviderConnection, validateProviderConfig } from '@/lib/plugins/provider-validation'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema
const testConnectionSchema = z.object({
  provider: ProviderEnum,
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
})

/**
 * POST /api/profiles/test-connection
 * Test if connection settings are valid
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string
 *   baseUrl?: string
 * }
 */
export const POST = createAuthenticatedHandler(async (req, { user, repos }) => {
  try {
    logger.debug('Testing provider connection', {
      context: 'POST /api/profiles/test-connection',
    })

    // Validate request body
    const body = await req.json()
    const { provider, apiKeyId, baseUrl } = testConnectionSchema.parse(body)

    logger.debug('Test connection request parsed', {
      provider,
      hasApiKeyId: !!apiKeyId,
      hasBaseUrl: !!baseUrl,
      context: 'POST /api/profiles/test-connection',
    })

    // Get API key if provided
    let decryptedKey = ''
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(apiKeyId)

      if (!apiKey) {
        logger.warn('API key not found for test connection', {
          apiKeyId,
          context: 'POST /api/profiles/test-connection',
        })
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      decryptedKey = decryptApiKey(
        apiKey.ciphertext,
        apiKey.iv,
        apiKey.authTag,
        user.id
      )
    }

    // Validate configuration requirements using provider validation
    const configValidation = validateProviderConfig(provider, {
      apiKey: decryptedKey,
      baseUrl,
    })

    if (!configValidation.valid) {
      logger.warn('Provider configuration validation failed', {
        provider,
        errors: configValidation.errors,
        context: 'POST /api/profiles/test-connection',
      })
      return NextResponse.json(
        {
          valid: false,
          provider,
          error: configValidation.errors[0] || 'Configuration validation failed',
        },
        { status: 400 }
      )
    }

    logger.debug('Provider configuration validation passed', {
      provider,
      context: 'POST /api/profiles/test-connection',
    })

    // Test the connection using provider validation
    const result = await testProviderConnection(provider, decryptedKey, baseUrl)

    if (result.valid) {
      logger.info('Provider connection test successful', {
        provider,
        context: 'POST /api/profiles/test-connection',
      })
      return NextResponse.json({
        valid: true,
        provider,
        message: `Successfully connected to ${provider}`,
      })
    }

    logger.warn('Provider connection test failed', {
      provider,
      error: result.error,
      context: 'POST /api/profiles/test-connection',
    })
    return NextResponse.json(
      {
        valid: false,
        provider,
        error: result.error,
      },
      { status: 400 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Validation error in test-connection endpoint', {
        errorCount: error.errors.length,
        context: 'POST /api/profiles/test-connection',
      })
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(
      'Failed to test connection',
      { context: 'POST /api/profiles/test-connection' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      {
        error: 'Failed to test connection',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
})
