/**
 * API Key Management Routes
 * Phase 0.3: Core Infrastructure
 *
 * GET    /api/keys       - List all API keys for current user
 * POST   /api/keys       - Create a new API key
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { getUserRepositories } from '@/lib/repositories/factory'
import { encryptApiKey, maskApiKey } from '@/lib/encryption'
import { Provider } from '@/lib/schemas/types'
import { getAllAvailableProviders } from '@/lib/llm'
import { logger } from '@/lib/logger'
import { autoAssociateApiKeys } from '@/lib/api-keys/auto-associate'

/**
 * GET /api/keys
 * List all API keys for the authenticated user
 * Returns masked keys for security
 */
export const GET = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const repos = getUserRepositories(user.id)
    const apiKeys = await repos.connections.getAllApiKeys()

    // Sort by creation date
    const sortedKeys = apiKeys
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    // Mask the encrypted keys for security
    const maskedKeys = sortedKeys.map((key) => ({
      id: key.id,
      provider: key.provider,
      label: key.label,
      isActive: key.isActive,
      lastUsed: key.lastUsed,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      keyPreview: maskApiKey(key.ciphertext.substring(0, 32)), // Mask a portion
    }))

    const response = NextResponse.json(maskedKeys)
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error) {
    logger.error('Failed to fetch API keys', { context: 'keys-GET' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to fetch API keys' },
      { status: 500 }
    )
  }
})

/**
 * POST /api/keys
 * Create a new encrypted API key
 *
 * Body: {
 *   provider: Provider,
 *   label: string,
 *   apiKey: string
 * }
 */
export const POST = createAuthenticatedHandler(async (req, { user }) => {
  try {
    const body = await req.json()
    const { provider, label, apiKey } = body

    // Validation
    if (!provider || typeof provider !== 'string' || provider.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      )
    }

    // Check if provider is registered (optional - could validate against plugin registry)
    const availableProviders = getAllAvailableProviders()
    if (!availableProviders.includes(provider)) {
      logger.warn('API key created for unregistered provider', { provider, context: 'keys-POST' })
      // Note: We allow this to support custom providers and future plugins
    }

    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return NextResponse.json(
        { error: 'Label is required' },
        { status: 400 }
      )
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      )
    }

    // Encrypt the API key
    const encrypted = encryptApiKey(apiKey, user.id)

    const repos = getUserRepositories(user.id)

    // Store in database - userId is automatically set by user-scoped repository
    const newKey = await repos.connections.createApiKey({
      provider: provider as Provider,
      label: label.trim(),
      ciphertext: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      isActive: true,
    })

    // Auto-associate the new key with profiles that need it
    logger.debug('Running auto-association for new key', {
      context: 'keys-POST',
      keyId: newKey.id,
      provider: newKey.provider,
    })

    const associationResult = await autoAssociateApiKeys(user.id, [newKey.id])

    logger.info('API key created', {
      context: 'keys-POST',
      keyId: newKey.id,
      provider: newKey.provider,
      associations: associationResult.associations.length,
    })

    return NextResponse.json({
      id: newKey.id,
      provider: newKey.provider,
      label: newKey.label,
      isActive: newKey.isActive,
      createdAt: newKey.createdAt,
      updatedAt: newKey.updatedAt,
      associations: associationResult.associations,
    }, { status: 201 })
  } catch (error) {
    logger.error('Failed to create API key', { context: 'keys-POST' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    )
  }
})
