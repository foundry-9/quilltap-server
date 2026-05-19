/**
 * Dangerous Content Provider Routing Service
 *
 * Handles rerouting messages flagged as dangerous content to uncensored-compatible providers.
 * Uses the user's configured uncensored profiles, or scans for isDangerousCompatible profiles.
 *
 * If no uncensored provider is available, returns the original profile (never blocks).
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'

import { getErrorMessage } from '@/lib/error-utils'
import type { ConnectionProfile, ImageProfile } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

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
 * 1. If mode !== AUTO_ROUTE, return original profile
 * 2. If uncensoredTextProfileId is set, load that profile
 * 3. Otherwise scan user's profiles for isDangerousCompatible === true
 * 4. If nothing found, return original with warning
 *
 * @param originalProfile - The original connection profile
 * @param originalApiKey - The decrypted API key for the original profile
 * @param settings - The dangerous content settings
 * @param userId - The user ID
 * @returns Route result with effective profile and API key
 */
export async function resolveProviderForDangerousContent(
  originalProfile: ConnectionProfile,
  originalApiKey: string,
  settings: DangerousContentSettings,
  userId: string
): Promise<DangerousProviderRouteResult> {
  // If mode is not AUTO_ROUTE, don't reroute
  if (settings.mode !== 'AUTO_ROUTE') {
    return {
      rerouted: false,
      connectionProfile: originalProfile,
      apiKey: originalApiKey,
      reason: `Mode is ${settings.mode}, no rerouting`,
    }
  }

  const repos = getRepositories()

  try {
    // Try explicit uncensored profile first
    if (settings.uncensoredTextProfileId) {
      const uncensoredProfile = await repos.connections.findById(settings.uncensoredTextProfileId)
      if (uncensoredProfile && uncensoredProfile.userId === userId) {
        const apiKey = await decryptProfileApiKey(uncensoredProfile, userId)
        if (apiKey !== null) {
          logger.info('[DangerousContent] Rerouting to configured uncensored text profile', {
            profileId: uncensoredProfile.id,
            profileName: uncensoredProfile.name,
            provider: uncensoredProfile.provider,
            model: uncensoredProfile.modelName,
          })
          return {
            rerouted: true,
            connectionProfile: uncensoredProfile,
            apiKey,
            reason: `Rerouted to configured uncensored profile: ${uncensoredProfile.name}`,
          }
        }
        logger.warn('[DangerousContent] Configured uncensored profile has no valid API key', {
          profileId: settings.uncensoredTextProfileId,
        })
      } else {
        logger.warn('[DangerousContent] Configured uncensored profile not found or not owned by user', {
          profileId: settings.uncensoredTextProfileId,
        })
      }
    }

    // Scan for any isDangerousCompatible profile
    const allProfiles = await repos.connections.findAll()
    const compatibleProfiles = allProfiles.filter(
      p => p.userId === userId && p.isDangerousCompatible === true
    )

    for (const profile of compatibleProfiles) {
      const apiKey = await decryptProfileApiKey(profile, userId)
      if (apiKey !== null) {
        logger.info('[DangerousContent] Rerouting to discovered uncensored-compatible profile', {
          profileId: profile.id,
          profileName: profile.name,
          provider: profile.provider,
          model: profile.modelName,
        })
        return {
          rerouted: true,
          connectionProfile: profile,
          apiKey,
          reason: `Rerouted to uncensored-compatible profile: ${profile.name}`,
        }
      }
    }

    // No uncensored provider available - send to original anyway
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
 * Resolve the appropriate image provider for dangerous content
 *
 * @param originalProfile - The original image profile
 * @param originalApiKey - The decrypted API key for the original profile
 * @param settings - The dangerous content settings
 * @param userId - The user ID
 * @returns Route result with effective image profile and API key
 */
export async function resolveImageProviderForDangerousContent(
  originalProfile: ImageProfile,
  originalApiKey: string,
  settings: DangerousContentSettings,
  userId: string
): Promise<DangerousImageProviderRouteResult> {
  // If mode is not AUTO_ROUTE, don't reroute
  if (settings.mode !== 'AUTO_ROUTE') {
    return {
      rerouted: false,
      imageProfile: originalProfile,
      apiKey: originalApiKey,
      reason: `Mode is ${settings.mode}, no rerouting`,
    }
  }

  const repos = getRepositories()

  try {
    // Try explicit uncensored image profile first
    if (settings.uncensoredImageProfileId) {
      const uncensoredProfile = await repos.imageProfiles.findById(settings.uncensoredImageProfileId)
      if (uncensoredProfile && uncensoredProfile.userId === userId) {
        const apiKey = await decryptImageProfileApiKey(uncensoredProfile, userId)
        if (apiKey !== null) {
          logger.info('[DangerousContent] Rerouting to configured uncensored image profile', {
            profileId: uncensoredProfile.id,
            profileName: uncensoredProfile.name,
            provider: uncensoredProfile.provider,
          })
          return {
            rerouted: true,
            imageProfile: uncensoredProfile,
            apiKey,
            reason: `Rerouted to configured uncensored image profile: ${uncensoredProfile.name}`,
          }
        }
      }
    }

    // Scan for any isDangerousCompatible image profile
    const allImageProfiles = await repos.imageProfiles.findAll()
    const compatibleProfiles = allImageProfiles.filter(
      p => p.userId === userId && p.isDangerousCompatible === true
    )

    for (const profile of compatibleProfiles) {
      const apiKey = await decryptImageProfileApiKey(profile, userId)
      if (apiKey !== null) {
        logger.info('[DangerousContent] Rerouting to discovered uncensored-compatible image profile', {
          profileId: profile.id,
          profileName: profile.name,
          provider: profile.provider,
        })
        return {
          rerouted: true,
          imageProfile: profile,
          apiKey,
          reason: `Rerouted to uncensored-compatible image profile: ${profile.name}`,
        }
      }
    }

    // No uncensored image provider available - send to original anyway
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

/**
 * Decrypt the API key for a connection profile
 */
async function decryptProfileApiKey(
  profile: ConnectionProfile,
  userId: string
): Promise<string | null> {
  try {
    if (!profile.apiKeyId) return null

    const repos = getRepositories()
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
    if (!apiKey) return null

    return apiKey.key_value
  } catch (error) {
    logger.warn('[DangerousContent] Failed to retrieve API key for profile', {
      profileId: profile.id,
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * Decrypt the API key for an image profile
 */
async function decryptImageProfileApiKey(
  profile: ImageProfile,
  userId: string
): Promise<string | null> {
  try {
    if (!profile.apiKeyId) return null

    const repos = getRepositories()
    const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
    if (!apiKey) return null

    return apiKey.key_value
  } catch (error) {
    logger.warn('[DangerousContent] Failed to retrieve image profile API key', {
      profileId: profile.id,
      error: getErrorMessage(error),
    })
    return null
  }
}
