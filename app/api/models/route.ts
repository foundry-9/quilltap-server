/**
 * Models API Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/models - Get available models for a provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm'
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { requiresBaseUrl, requiresApiKey } from '@/lib/plugins/provider-validation'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema
const getModelsSchema = z.object({
  provider: z.string().min(1, 'Provider is required'), // Dynamic providers from plugins
  apiKeyId: z.string().optional(), // Optional API key ID
  baseUrl: z.string().optional(), // Required for Ollama/OpenAI-compatible
})

/**
 * POST /api/models
 * Get available models for a provider
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string  // Optional, uses the API key if provided
 *   baseUrl?: string   // Required for Ollama/OpenAI-compatible
 * }
 *
 * Returns: {
 *   models: string[]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Validate request body
    const body = await req.json()
    const { provider, apiKeyId, baseUrl } = getModelsSchema.parse(body)

    // Get API key if provided (security: verify ownership)
    let decryptedKey = ''
    if (apiKeyId) {
      const apiKey = await repos.connections.findApiKeyByIdAndUserId(apiKeyId, session.user.id)

      if (!apiKey) {
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

    // Validate baseUrl requirements using provider registry
    if (requiresBaseUrl(provider) && !baseUrl) {
      return NextResponse.json(
        { error: `Base URL is required for ${provider} provider` },
        { status: 400 }
      )
    }

    // Validate API key requirements using provider registry
    // Note: Some providers don't require API keys for fetching models
    if (requiresApiKey(provider) && !decryptedKey) {
      return NextResponse.json(
        { error: `API key is required for ${provider} provider` },
        { status: 400 }
      )
    }

    // Ensure plugin system is initialized
    // Check both the plugin system AND the provider registry specifically
    const pluginSystemInitialized = isPluginSystemInitialized()
    const providerRegistryInitialized = providerRegistry.isInitialized()
    const registryStats = providerRegistry.getStats()

    logger.debug('Checking plugin system initialization', {
      provider,
      pluginSystemInitialized,
      providerRegistryInitialized,
      registryProviderCount: registryStats.total,
      context: 'POST /api/models',
    })

    // Initialize if either the plugin system or provider registry is not initialized
    if (!pluginSystemInitialized || !providerRegistryInitialized) {
      logger.warn('Plugin system not fully initialized in models endpoint, initializing now', {
        provider,
        pluginSystemInitialized,
        providerRegistryInitialized,
        context: 'POST /api/models',
      })
      const initResult = await initializePlugins()
      logger.info('Plugin system initialization result', {
        success: initResult.success,
        stats: initResult.stats,
        providerRegistryStats: providerRegistry.getStats(),
        context: 'POST /api/models',
      })
      if (!initResult.success) {
        logger.error('Failed to initialize plugin system', {
          stats: initResult.stats,
          errors: initResult.errors,
          context: 'POST /api/models',
        })
        return NextResponse.json(
          { error: 'Plugin system initialization failed', details: initResult.errors },
          { status: 500 }
        )
      }
    }

    // Create provider instance
    const llmProvider = await createLLMProvider(provider, baseUrl)

    // Debug log: Models API request
    logger.debug('[Models Request] models/route.ts:POST', {
      context: 'llm-api',
      provider,
      hasBaseUrl: !!baseUrl,
      baseUrl: baseUrl || undefined,
    })

    // Get available models
    const models = await llmProvider.getAvailableModels(decryptedKey)

    // Debug log: Models API response
    logger.debug('[Models Response] models/route.ts:POST', {
      context: 'llm-api',
      provider,
      modelCount: models.length,
      models: JSON.stringify(models.slice(0, 20)), // Log first 20 models
    })

    // Get model metadata (warnings, recommendations) if the provider supports it
    const modelMetadata = llmProvider.getModelsWithMetadata
      ? await llmProvider.getModelsWithMetadata(decryptedKey)
      : []

    // Get static model info from the plugin (includes maxOutputTokens, contextWindow)
    const plugin = providerRegistry.getProvider(provider)
    const staticModelInfo = plugin?.getModelInfo?.() || []

    // Build response with model info including any warnings and token limits
    const modelsWithInfo = models.map(modelId => {
      const metadata = modelMetadata.find(m => m.id === modelId)
        || (llmProvider.getModelMetadata ? llmProvider.getModelMetadata(modelId) : undefined)
      // Get static info (maxOutputTokens, contextWindow) from plugin
      const staticInfo = staticModelInfo.find(m => m.id === modelId)
      return {
        id: modelId,
        displayName: metadata?.displayName,
        warnings: metadata?.warnings,
        deprecated: metadata?.deprecated,
        experimental: metadata?.experimental,
        missingCapabilities: metadata?.missingCapabilities,
        maxOutputTokens: staticInfo?.maxOutputTokens,
        contextWindow: staticInfo?.contextWindow,
      }
    })

    // Cache the fetched models in the database
    try {
      await repos.providerModels.upsertModelsForProvider(
        provider,
        modelsWithInfo.map(m => ({
          modelId: m.id,
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          deprecated: m.deprecated,
          experimental: m.experimental,
        })),
        'chat', // Model type for chat models
        baseUrl
      )
      logger.debug('Cached chat models in database', {
        provider,
        count: models.length,
        modelType: 'chat',
        baseUrl,
        context: 'POST /api/models',
      })
    } catch (cacheError) {
      // Don't fail the request if caching fails, just log
      logger.warn('Failed to cache models in database', {
        provider,
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
        context: 'POST /api/models',
      })
    }

    return NextResponse.json({
      provider,
      models,
      modelsWithInfo,
      count: models.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to fetch models', { context: 'GET /api/models' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      {
        error: 'Failed to fetch models',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
