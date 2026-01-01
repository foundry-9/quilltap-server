/**
 * Startup Pricing Refresh API
 * POST /api/startup/refresh-pricing
 *
 * Triggers a refresh of the model pricing cache.
 * Called on application startup or manually to update pricing data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { refreshPricingCache, isCacheFresh } from '@/lib/llm/pricing-fetcher'
import { logger } from '@/lib/logger'

export const POST = createAuthenticatedHandler(async (req: NextRequest, { user }) => {
  try {
    // Check if we should force refresh
    const body = await req.json().catch(() => ({}))
    const forceRefresh = body.force === true

    // Skip if cache is fresh and not forcing
    if (!forceRefresh && isCacheFresh()) {
      return NextResponse.json({
        success: true,
        message: 'Pricing cache is already fresh',
        refreshed: false,
      })
    }

    // Refresh the pricing cache
    const cache = await refreshPricingCache(user.id)

    const providerCount = Object.keys(cache.providers).length
    let modelCount = 0
    for (const provider of Object.values(cache.providers)) {
      modelCount += provider?.models?.length || 0
    }

    return NextResponse.json({
      success: true,
      message: 'Pricing cache refreshed',
      refreshed: true,
      providers: providerCount,
      models: modelCount,
      updatedAt: cache.updatedAt,
    })
  } catch (error) {
    logger.error('Error refreshing pricing cache', { context: 'POST /api/startup/refresh-pricing' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to refresh pricing cache' },
      { status: 500 }
    )
  }
})

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user }) => {
  try {
    return NextResponse.json({
      isFresh: isCacheFresh(),
    })
  } catch (error) {
    logger.error('Error checking pricing cache', { context: 'GET /api/startup/refresh-pricing' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to check pricing cache' },
      { status: 500 }
    )
  }
})
