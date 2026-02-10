/**
 * Providers API v1
 *
 * GET /api/v1/providers - List available LLM providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { searchProviderRegistry } from '@/lib/plugins/search-provider-registry';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    // Get all registered LLM providers
    const plugins = providerRegistry.getAllProviders();

    // Transform to response format
    const providerList = plugins.map((plugin) => ({
      id: plugin.metadata.providerName,
      name: plugin.metadata.providerName,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      abbreviation: plugin.metadata.abbreviation,
      colors: plugin.metadata.colors,
      type: 'llm',
      capabilities: plugin.capabilities,
      configRequirements: plugin.config,
    }));

    // Get all registered search providers
    const searchPlugins = searchProviderRegistry.getAllProviders();

    const searchProviderList = searchPlugins.map((plugin) => ({
      id: plugin.metadata.providerName,
      name: plugin.metadata.providerName,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      abbreviation: plugin.metadata.abbreviation,
      colors: plugin.metadata.colors,
      type: 'search',
      configRequirements: {
        requiresApiKey: plugin.config.requiresApiKey,
        requiresBaseUrl: plugin.config.requiresBaseUrl,
        apiKeyLabel: plugin.config.apiKeyLabel,
      },
    }));

    // Combine both lists
    const allProviders = [...providerList, ...searchProviderList];

    logger.info('[Providers v1] Listed providers', {
      llmCount: providerList.length,
      searchCount: searchProviderList.length,
      totalCount: allProviders.length,
    });

    return successResponse({
      providers: allProviders,
      count: allProviders.length,
    });
  } catch (error) {
    logger.error(
      '[Providers v1] Error listing providers',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch providers');
  }
});
