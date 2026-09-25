/**
 * Dangerous Content Provider Routing Service
 *
 * Pre-flight rerouting of content the Concierge flagged. Thin wrappers over
 * `understudy.ts`, which owns *who* could stand in; these own *whether* to
 * ask (the policy's `routeDirect` or `failoverAllowed`). Post-hoc refusals go through `image-failover.ts` and the
 * text failover service, which ask the same resolver.
 *
 * If no uncensored provider is available, returns the original profile (never blocks).
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getErrorMessage } from '@/lib/error-utils'
import {
  resolveUncensoredImageUnderstudy,
  resolveUncensoredTextUnderstudy,
} from './understudy'
import type { ConnectionProfile, ImageProfile } from '@/lib/schemas/types'
import type { ResolvedConciergePolicy } from './resolver.service'

const logger = createServiceLogger('DangerousContentProviderRouting')

/**
 * Result of provider routing for dangerous content
 */
export interface DangerousProviderRouteResult {
  /** Whether the provider was rerouted */
  rerouted: boolean
  /** The effective connection profile to use */
  connectionProfile: ConnectionProfile
  /** The decrypted API key for the effective profile */
  apiKey: string
  /** Reason for the routing decision */
  reason: string
}

/**
 * Result of image provider routing for dangerous content
 */
export interface DangerousImageProviderRouteResult {
  /** Whether the image provider was rerouted */
  rerouted: boolean
  /** The effective image profile to use */
  imageProfile: ImageProfile
  /** The decrypted API key for the effective profile */
  apiKey: string
  /** Reason for the routing decision */
  reason: string
}

/**
 * Resolve the appropriate text LLM provider for dangerous content
 *
 * Logic:
 * 1. Unless the policy routes direct or allows failover, return original profile
 * 2. Otherwise ask `resolveUncensoredTextUnderstudy` (the configured
 *    uncensored profile, then any `isDangerousCompatible` one, preferring one
 *    that can carry this turn's attachments), excluding the original
 * 3. If nobody qualifies, return original with a warning
 *
 * @param originalProfile - The original connection profile
 * @param originalApiKey - The decrypted API key for the original profile
 * @param conciergePolicy - The chat's resolved Concierge policy
 * @param userId - The user ID
 * @param turnAttachmentMimeTypes - MIME types riding along in this turn's
 *   message array, if any (bug 106). A preference, not a filter — see
 *   `TextUnderstudyLookup.turnAttachmentMimeTypes`.
 * @returns Route result with effective profile and API key
 */
export async function resolveProviderForDangerousContent(
  originalProfile: ConnectionProfile,
  originalApiKey: string,
  conciergePolicy: ResolvedConciergePolicy,
  userId: string,
  turnAttachmentMimeTypes: string[] = []
): Promise<DangerousProviderRouteResult> {
  // The policy lives here, in the wrapper; the understudy resolver never reads it.
  if (!conciergePolicy.routeDirect && !conciergePolicy.failoverAllowed) {
    logger.debug('[DangerousContent] Rerouting not permitted by Concierge policy', {
      conciergeSource: conciergePolicy.source,
      conciergeState: conciergePolicy.state,
    })
    return {
      rerouted: false,
      connectionProfile: originalProfile,
      apiKey: originalApiKey,
      reason: `Concierge policy (${conciergePolicy.source}) does not permit rerouting`,
    }
  }

  try {
    const understudy = await resolveUncensoredTextUnderstudy({
      userId,
      conciergePolicy,
      exclude: [originalProfile.id],
      turnAttachmentMimeTypes,
    })

    if (understudy) {
      const configured = understudy.profile.id === conciergePolicy.desk.textProfileId
      logger.info('[DangerousContent] Rerouting to uncensored text profile', {
        profileId: understudy.profile.id,
        profileName: understudy.profile.name,
        provider: understudy.profile.provider,
        model: understudy.profile.modelName,
        configured,
      })
      return {
        rerouted: true,
        connectionProfile: understudy.profile,
        apiKey: understudy.apiKey,
        reason: configured
          ? `Rerouted to configured uncensored profile: ${understudy.profile.name}`
          : `Rerouted to uncensored-compatible profile: ${understudy.profile.name}`,
      }
    }

    logger.warn('[DangerousContent] No uncensored provider available, sending to original profile', {
      originalProfile: originalProfile.name,
      originalProvider: originalProfile.provider,
    })
    return {
      rerouted: false,
      connectionProfile: originalProfile,
      apiKey: originalApiKey,
      reason: 'No uncensored provider available - sending to regular provider',
    }
  } catch (error) {
    logger.error('[DangerousContent] Provider routing failed, using original', {
      error: getErrorMessage(error),
    })
    return {
      rerouted: false,
      connectionProfile: originalProfile,
      apiKey: originalApiKey,
      reason: `Routing failed: ${getErrorMessage(error)}`,
    }
  }
}

/**
 * Resolve the appropriate image provider for dangerous content (pre-flight).
 *
 * Same order as the post-hoc failover, because both ask
 * `resolveUncensoredImageUnderstudy`; the policy gate stays here.
 *
 * @param originalProfile - The original image profile
 * @param originalApiKey - The decrypted API key for the original profile
 * @param conciergePolicy - The chat's resolved Concierge policy
 * @param userId - The user ID
 * @returns Route result with effective image profile and API key
 */
export async function resolveImageProviderForDangerousContent(
  originalProfile: ImageProfile,
  originalApiKey: string,
  conciergePolicy: ResolvedConciergePolicy,
  userId: string
): Promise<DangerousImageProviderRouteResult> {
  if (!conciergePolicy.routeDirect && !conciergePolicy.failoverAllowed) {
    logger.debug('[DangerousContent] Image rerouting not permitted by Concierge policy', {
      conciergeSource: conciergePolicy.source,
      conciergeState: conciergePolicy.state,
    })
    return {
      rerouted: false,
      imageProfile: originalProfile,
      apiKey: originalApiKey,
      reason: `Concierge policy (${conciergePolicy.source}) does not permit rerouting`,
    }
  }

  try {
    const understudy = await resolveUncensoredImageUnderstudy({
      userId,
      conciergePolicy,
      exclude: [originalProfile.id],
    })

    if (understudy) {
      const configured = understudy.profile.id === conciergePolicy.desk.imageProfileId
      logger.info('[DangerousContent] Rerouting to uncensored image profile', {
        profileId: understudy.profile.id,
        profileName: understudy.profile.name,
        provider: understudy.profile.provider,
        configured,
      })
      return {
        rerouted: true,
        imageProfile: understudy.profile,
        apiKey: understudy.apiKey,
        reason: configured
          ? `Rerouted to configured uncensored image profile: ${understudy.profile.name}`
          : `Rerouted to uncensored-compatible image profile: ${understudy.profile.name}`,
      }
    }

    logger.warn('[DangerousContent] No uncensored image provider available, sending to original', {
      originalProfile: originalProfile.name,
    })
    return {
      rerouted: false,
      imageProfile: originalProfile,
      apiKey: originalApiKey,
      reason: 'No uncensored image provider available - sending to regular provider',
    }
  } catch (error) {
    logger.error('[DangerousContent] Image provider routing failed, using original', {
      error: getErrorMessage(error),
    })
    return {
      rerouted: false,
      imageProfile: originalProfile,
      apiKey: originalApiKey,
      reason: `Routing failed: ${getErrorMessage(error)}`,
    }
  }
}
