/**
 * Uncensored understudies — who could stand in when a provider refuses.
 *
 * One order for text and images alike:
 *
 *   1. the explicitly configured profile (`uncensoredTextProfileId` /
 *      `uncensoredImageProfileId`), if the user owns it, it is not excluded,
 *      and its key decrypts;
 *   2. otherwise the user's `isDangerousCompatible` profiles not excluded
 *      (text: attachment-capable first), first with a usable key;
 *   3. otherwise nobody.
 *
 * Before this module the pre-flight reroute scanned and the post-hoc reroute
 * did not, so a user who ticked "Uncensored-compatible" on a profile but left
 * the Concierge picker on "Auto-detect" got pre-flight reroutes and never a
 * post-hoc one.
 *
 * **The resolver is not the policy.** It never reads `settings.mode` or any
 * chat state; it only says who *could* stand in. Every caller states its own
 * gate, in code, where a reader can see it.
 *
 * Reads only — safe in the forked job child.
 *
 * @module services/dangerous-content/understudy
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import { getErrorMessage } from '@/lib/error-utils'
import { profileCanReceiveAttachment } from '@/lib/llm/image-transport'
import type { ConnectionProfile, ImageProfile } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('ConciergeUnderstudy')

export interface UnderstudyLookup {
  userId: string
  settings: DangerousContentSettings
  /** Profile ids that must not be offered — the one that just refused, and any already tried. */
  exclude?: string[]
}

export interface TextUnderstudyLookup extends UnderstudyLookup {
  /**
   * MIME types riding along in this turn's message array. The scan prefers a
   * profile that can receive them (bug 106). A preference, not a filter: a
   * text-only stand-in is still better than none, and the caller re-runs the
   * attachment decision against whichever profile comes back.
   */
  turnAttachmentMimeTypes?: string[]
  /**
   * An extra eligibility test, applied to the explicit pick and the scan
   * alike. The legacy image dialog uses it to keep to connection profiles
   * whose provider can draw.
   */
  filter?: (profile: ConnectionProfile) => boolean
}

export interface TextUnderstudy {
  profile: ConnectionProfile
  apiKey: string
}

export interface ImageUnderstudy {
  profile: ImageProfile
  apiKey: string
}

async function decryptKey(
  profile: { id: string; apiKeyId?: string | null },
  userId: string,
): Promise<string | null> {
  try {
    if (!profile.apiKeyId) return null
    const apiKey = await getRepositories().connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
    return apiKey?.key_value ? apiKey.key_value : null
  } catch (error) {
    logger.warn('Could not decrypt an understudy candidate\'s API key', {
      profileId: profile.id,
      error: getErrorMessage(error),
    })
    return null
  }
}

function profileCanCarryTurn(profile: ConnectionProfile, mimeTypes: string[]): boolean {
  return mimeTypes.every((m) => profileCanReceiveAttachment(profile, m))
}

/**
 * The uncensored connection profile that could take a text call, or null.
 */
export async function resolveUncensoredTextUnderstudy(
  lookup: TextUnderstudyLookup,
): Promise<TextUnderstudy | null> {
  const { userId, settings, exclude = [], turnAttachmentMimeTypes = [], filter } = lookup
  const excluded = new Set(exclude)
  const repos = getRepositories()

  const eligible = (p: ConnectionProfile): boolean =>
    p.userId === userId &&
    !excluded.has(p.id) &&
    p.transport !== 'courier' &&
    (filter ? filter(p) : true)

  try {
    const explicitId = settings.uncensoredTextProfileId
    if (explicitId && !excluded.has(explicitId)) {
      const explicit = await repos.connections.findById(explicitId)
      if (explicit && eligible(explicit)) {
        const apiKey = await decryptKey(explicit, userId)
        if (apiKey !== null) {
          logger.debug('Text understudy: the configured uncensored profile', {
            profileId: explicit.id,
            profileName: explicit.name,
            provider: explicit.provider,
            model: explicit.modelName,
          })
          return { profile: explicit, apiKey }
        }
        logger.warn('Configured uncensored text profile has no usable API key; scanning instead', {
          profileId: explicitId,
        })
      } else {
        logger.warn('Configured uncensored text profile is missing, not owned, or not eligible; scanning instead', {
          profileId: explicitId,
          found: !!explicit,
          courier: explicit?.transport === 'courier',
        })
      }
    } else if (explicitId) {
      logger.debug('Configured uncensored text profile is excluded on this call', { profileId: explicitId })
    }

    // Ordered, not filtered: profiles that can carry this turn's attachments
    // first, the rest behind them.
    const all = await repos.connections.findAll()
    const compatible = all.filter((p) => p.isDangerousCompatible === true && eligible(p))
    const canCarry = compatible.filter((p) => profileCanCarryTurn(p, turnAttachmentMimeTypes))
    const cannotCarry = compatible.filter((p) => !profileCanCarryTurn(p, turnAttachmentMimeTypes))
    if (turnAttachmentMimeTypes.length > 0 && cannotCarry.length > 0) {
      logger.info('Deprioritising uncensored candidates that cannot carry this turn', {
        turnAttachmentMimeTypes,
        canCarry: canCarry.map((p) => p.name),
        cannotCarry: cannotCarry.map((p) => p.name),
      })
    }

    for (const profile of [...canCarry, ...cannotCarry]) {
      const apiKey = await decryptKey(profile, userId)
      if (apiKey !== null) {
        logger.debug('Text understudy: a discovered uncensored-compatible profile', {
          profileId: profile.id,
          profileName: profile.name,
          provider: profile.provider,
          model: profile.modelName,
        })
        return { profile, apiKey }
      }
    }

    logger.debug('No uncensored text understudy is available', {
      userId,
      excluded: exclude,
      candidates: compatible.length,
    })
    return null
  } catch (error) {
    logger.error('Text understudy lookup failed', { error: getErrorMessage(error) })
    return null
  }
}

/**
 * The uncensored image profile that could take an image call, or null.
 */
export async function resolveUncensoredImageUnderstudy(
  lookup: UnderstudyLookup,
): Promise<ImageUnderstudy | null> {
  const { userId, settings, exclude = [] } = lookup
  const excluded = new Set(exclude)
  const repos = getRepositories()

  try {
    const explicitId = settings.uncensoredImageProfileId
    if (explicitId && !excluded.has(explicitId)) {
      const explicit = await repos.imageProfiles.findById(explicitId)
      if (explicit && explicit.userId === userId) {
        const apiKey = await decryptKey(explicit, userId)
        if (apiKey !== null) {
          logger.debug('Image understudy: the configured uncensored profile', {
            profileId: explicit.id,
            profileName: explicit.name,
            provider: explicit.provider,
            model: explicit.modelName,
          })
          return { profile: explicit, apiKey }
        }
        logger.warn('Configured uncensored image profile has no usable API key; scanning instead', {
          profileId: explicitId,
        })
      } else {
        logger.warn('Configured uncensored image profile is missing or not owned; scanning instead', {
          profileId: explicitId,
          found: !!explicit,
        })
      }
    } else if (explicitId) {
      logger.debug('Configured uncensored image profile is excluded on this call', { profileId: explicitId })
    }

    const all = await repos.imageProfiles.findAll()
    const compatible = all.filter(
      (p) => p.userId === userId && p.isDangerousCompatible === true && !excluded.has(p.id),
    )

    for (const profile of compatible) {
      const apiKey = await decryptKey(profile, userId)
      if (apiKey !== null) {
        logger.debug('Image understudy: a discovered uncensored-compatible profile', {
          profileId: profile.id,
          profileName: profile.name,
          provider: profile.provider,
          model: profile.modelName,
        })
        return { profile, apiKey }
      }
    }

    logger.debug('No uncensored image understudy is available', {
      userId,
      excluded: exclude,
      candidates: compatible.length,
    })
    return null
  } catch (error) {
    logger.error('Image understudy lookup failed', { error: getErrorMessage(error) })
    return null
  }
}
