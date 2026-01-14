/**
 * Models API v1
 *
 * GET /api/v1/models - List available models
 * GET /api/v1/models?provider=openai - Filter models by provider
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import {
  initializePlugins,
  isPluginSystemInitialized,
} from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    const { searchParams } = new URL(req.url);
    const providerFilter = searchParams.get('provider');
    const hasVisionFilter = searchParams.get('hasVision');
    const hasStreamingFilter = searchParams.get('hasStreaming');

    logger.debug('[Models v1] GET list', {
      userId: context.user.id,
      provider: providerFilter,
      hasVision: hasVisionFilter,
      hasStreaming: hasStreamingFilter,
    });

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins();
      if (!initResult.success) {
        logger.warn('[Models v1] Plugin initialization failed');
        return serverError('Plugin system not ready');
      }
    }

    // For now, return empty models list
    // TODO: Models will be retrieved from provider plugins once that capability is added
    const allModels: any[] = [];

    logger.info('[Models v1] Listed models', {
      count: allModels.length,
      provider: providerFilter,
    });

    return successResponse({
      models: allModels,
      count: allModels.length,
      filters: {
        provider: providerFilter,
        hasVision: hasVisionFilter === 'true' ? true : false,
        hasStreaming: hasStreamingFilter === 'true' ? true : false,
      },
    });
  } catch (error) {
    logger.error(
      '[Models v1] Error listing models',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch models');
  }
});
