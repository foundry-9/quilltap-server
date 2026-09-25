/**
 * "Try uncensored" — the operator's per-request escape hatch.
 *
 * A refusal the Concierge could not get past, or a *soft* refusal no detector
 * can see (a polite paragraph, a sanitized picture), is answered by one click
 * that sends the same request straight to the uncensored desk. This module
 * decides whether that may happen and who takes it; the callers (the
 * `retry-uncensored` message action, the `retry-image-uncensored` chat action
 * and the story-background job) do the generating.
 *
 * Rules of record:
 *
 * - **The retry never changes the chat's state.** Switching the chat is the
 *   sidebar's job, or the Concierge's after N refusals.
 * - **A Locked chat is never retried uncensored.** The operator has said never;
 *   the button is hidden there, and the server refuses it too (`'locked'`).
 * - **Off duty does not bar it.** "Off duty" stops the Concierge acting on his
 *   own; this is the operator acting, explicitly, on one request.
 * - The understudy comes from the one resolver (`understudy.ts`), excluding the
 *   profile that answered (or refused) the original — by id where the trail or
 *   the chat's configuration names it, and by provider + model, which is what
 *   the original message records, so a profile reassigned since cannot hand
 *   the retry back to the model that already answered.
 * - The desk is the one *configured* (`resolveConfiguredConciergeDesk`), not
 *   the policy's, which is empty off duty.
 *
 * Reads only.
 *
 * @module services/dangerous-content/retry-uncensored
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveConnectionProfile } from '@/lib/chat/connection-resolver'
import { getRepositories } from '@/lib/repositories/factory'
import type { RouteAttempt } from '@/lib/schemas/chat.types'
import type { ChatMetadataBase, ChatSettings, MessageEvent } from '@/lib/schemas/types'
import { conciergeStateMayFailOver, getConciergeState } from './chat-override'
import {
  resolveConciergeSettings,
  resolveConfiguredConciergeDesk,
  type ResolvedConciergePolicy,
} from './resolver.service'
import {
  resolveUncensoredImageUnderstudy,
  resolveUncensoredTextUnderstudy,
  type ImageUnderstudy,
  type TextUnderstudy,
} from './understudy'

const logger = createServiceLogger('ConciergeRetryUncensored')

/** Why a retry was refused: the chat is Locked, or there is nobody to send it to. */
export type RetryUncensoredRefusal = 'locked' | 'no-understudy'

export type RetryUnderstudyResult<U> =
  | { ok: true; understudy: U }
  | { ok: false; reason: RetryUncensoredRefusal }

type Repos = ReturnType<typeof getRepositories>

/** Whether the chat's state permits an uncensored retry at all. */
export function mayRetryUncensored(chat: Pick<ChatMetadataBase, 'conciergeMode'>): boolean {
  return conciergeStateMayFailOver(getConciergeState(chat))
}

/** Who answered the original, as the message records it. */
export interface AnsweredBy {
  provider?: string | null
  modelName?: string | null
}

/**
 * The policy an explicit retry resolves the understudy with: the chat's own,
 * but with the desk as configured. Off duty the policy's desk is empty, and an
 * operator who named an uncensored profile must not be told there is none.
 */
function retryPolicy(chatSettings: ChatSettings | null, chat: ChatMetadataBase): ResolvedConciergePolicy {
  return {
    ...resolveConciergeSettings(chatSettings, chat),
    desk: resolveConfiguredConciergeDesk(chatSettings),
  }
}

/** Ids of the profiles that share the original's provider and model. */
function sameModelIds(
  profiles: Array<{ id: string; provider: string; modelName: string }>,
  answeredBy: AnsweredBy | undefined,
): string[] {
  if (!answeredBy?.provider || !answeredBy.modelName) return []
  return profiles
    .filter((p) => p.provider === answeredBy.provider && p.modelName === answeredBy.modelName)
    .map((p) => p.id)
}

/** Profile ids named on a trail, filtered by kind (absent kind reads as `'connection'`). */
function trailProfileIds(
  trail: RouteAttempt[] | null | undefined,
  kind: 'connection' | 'image',
): string[] {
  return (trail ?? [])
    .filter((a) => (a.profileKind ?? 'connection') === kind)
    .map((a) => a.profileId)
}

/**
 * Who would take a text retry of `targetMessage`, or why nobody will.
 *
 * Excludes the responder's own profile, every connection profile already on
 * the message's trail, and every profile on the model that answered it, so the
 * retry never lands where the original did.
 */
export async function resolveTextRetryUnderstudy(opts: {
  repos: Repos
  userId: string
  chat: ChatMetadataBase
  chatSettings: ChatSettings | null
  targetMessage: MessageEvent
}): Promise<RetryUnderstudyResult<TextUnderstudy>> {
  const { repos, userId, chat, chatSettings, targetMessage } = opts

  if (!mayRetryUncensored(chat)) {
    logger.info('Uncensored text retry refused: the chat is Locked', {
      chatId: chat.id,
      messageId: targetMessage.id,
    })
    return { ok: false, reason: 'locked' }
  }

  const exclude = new Set(trailProfileIds(targetMessage.routeTrail, 'connection'))
  const participant = targetMessage.participantId
    ? chat.participants.find((p) => p.id === targetMessage.participantId)
    : undefined
  if (participant?.characterId) {
    try {
      const character = await repos.characters.findById(participant.characterId)
      if (character) exclude.add(resolveConnectionProfile(participant, character))
    } catch (error) {
      logger.debug('Could not resolve the responder profile to exclude from the retry', {
        chatId: chat.id,
        messageId: targetMessage.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  try {
    const connections = await repos.connections.findAll()
    for (const id of sameModelIds(connections, targetMessage)) exclude.add(id)
  } catch (error) {
    logger.debug('Could not list connection profiles to exclude the answering model from the retry', {
      chatId: chat.id,
      messageId: targetMessage.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const understudy = await resolveUncensoredTextUnderstudy({
    userId,
    conciergePolicy: retryPolicy(chatSettings, chat),
    exclude: [...exclude],
  })

  logger.debug('Resolved the uncensored text retry understudy', {
    chatId: chat.id,
    messageId: targetMessage.id,
    excluded: [...exclude],
    understudyProfileId: understudy?.profile.id ?? null,
  })

  return understudy ? { ok: true, understudy } : { ok: false, reason: 'no-understudy' }
}

/**
 * Who would take an image retry, or why nobody will. `excludeProfileIds` is
 * the image profile that drew (or refused) the original, plus any on its trail;
 * `answeredBy` (the picture's recorded provider and model) excludes every image
 * profile on that model too.
 */
export async function resolveImageRetryUnderstudy(opts: {
  userId: string
  chat: ChatMetadataBase
  chatSettings: ChatSettings | null
  excludeProfileIds: Array<string | null | undefined>
  trail?: RouteAttempt[] | null
  answeredBy?: AnsweredBy
}): Promise<RetryUnderstudyResult<ImageUnderstudy>> {
  const { userId, chat, chatSettings, excludeProfileIds, trail, answeredBy } = opts

  if (!mayRetryUncensored(chat)) {
    logger.info('Uncensored image retry refused: the chat is Locked', { chatId: chat.id })
    return { ok: false, reason: 'locked' }
  }

  const exclude = [
    ...new Set([
      ...excludeProfileIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
      ...trailProfileIds(trail, 'image'),
    ]),
  ]
  if (answeredBy?.provider && answeredBy.modelName) {
    try {
      const imageProfiles = await getRepositories().imageProfiles.findAll()
      for (const id of sameModelIds(imageProfiles, answeredBy)) {
        if (!exclude.includes(id)) exclude.push(id)
      }
    } catch (error) {
      logger.debug('Could not list image profiles to exclude the answering model from the retry', {
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const understudy = await resolveUncensoredImageUnderstudy({
    userId,
    conciergePolicy: retryPolicy(chatSettings, chat),
    exclude,
  })

  logger.debug('Resolved the uncensored image retry understudy', {
    chatId: chat.id,
    excluded: exclude,
    understudyProfileId: understudy?.profile.id ?? null,
  })

  return understudy ? { ok: true, understudy } : { ok: false, reason: 'no-understudy' }
}

/**
 * The call sheet for a retry's result: whatever failed or refused on the
 * original, then the understudy that answered, marked `via: 'concierge'`.
 *
 * Unlike a first-time turn this is never NULL: the answering row's `via` is the
 * record that the operator sent it to the uncensored desk.
 */
export function composeRetryRouteTrail(
  priorTrail: RouteAttempt[] | null | undefined,
  answering: { id: string; name: string; provider: string; modelName: string },
  profileKind: 'connection' | 'image',
): RouteAttempt[] {
  const prior = (priorTrail ?? []).filter((a) => a.outcome !== 'answered')
  return [
    ...prior,
    {
      profileId: answering.id,
      profileName: answering.name,
      provider: answering.provider,
      modelName: answering.modelName,
      via: 'concierge',
      outcome: 'answered',
      ...(profileKind === 'image' ? { profileKind } : {}),
    },
  ]
}
