/**
 * The refusal ledger — the Concierge's evidence for switching a chat.
 *
 * Every stated moderation refusal the phase-1 chokepoints detect on a chat is
 * counted here (`chats.moderationRefusalCount`, `lastModerationRefusalAt`).
 * After `autoSwitchAfterRefusals` of them on a Monitored chat under Auto-Route,
 * the Concierge switches the chat to Flagged through `applyConciergeFlip`
 * (`{ by: 'concierge', reason: 'refusals' }`) and says why. The operator's
 * return to Monitored empties the ledger.
 *
 * Two rules keep it honest:
 *
 *   - **Only stated refusals count.** `inferred` is an empty body on content
 *     the pre-flight classifier had already flagged: evidence of a flag, and
 *     the flag came from a guess. Counting it would let the guess promote the
 *     chat.
 *   - **The parent decides.** The increment is atomic in SQL; in the forked
 *     job child it is a buffered write like any other, which the child can
 *     neither read back nor act on. The parent's write applier calls
 *     {@link maybeAutoSwitchAfterRefusal} once per chat whose ledger a child
 *     batch changed (`lib/background-jobs/host/job-dispatcher.ts`), so the
 *     rule has one function and two entry points, and the child never decides.
 *
 * `recordModerationRefusal` is the only writer of the ledger's increment;
 * `applyConciergeFlip` is the only one that resets it.
 *
 * @module services/dangerous-content/refusal-ledger
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { getRepositories } from '@/lib/repositories/factory'
import { getConciergeState } from './chat-override'
import { applyConciergeFlip } from './manual-flip'
import type { RefusalEvidence } from './refusal'
import {
  DEFAULT_AUTO_SWITCH_AFTER_REFUSALS,
  resolveDangerousContentSettings,
} from './resolver.service'

const logger = createServiceLogger('ConciergeRefusalLedger')

export interface RefusalRecord {
  chatId: string
  kind: 'text' | 'image'
  purpose: 'chat' | 'cheap' | 'tool' | 'lantern' | 'avatar' | 'dialog'
  refusedProfileId: string
  refusedProfileName: string
  provider: string
  modelName?: string | null
  evidence: RefusalEvidence | undefined
  /** Whether the Concierge's reroute answered in the end — for the log only. */
  rerouted: boolean
}

export interface RecordRefusalResult {
  /**
   * The chat's count after this refusal. `null` when nothing was recorded, or
   * when the increment was buffered in the job child and cannot be read back.
   */
  count: number | null
  /** Whether this refusal switched the chat to Flagged. Always false in the child. */
  switched: boolean
}

/** Last refusing provider, carried to the auto-switch announcement. */
export interface LastRefusal {
  provider: string
  modelName?: string | null
}

/** The evidence that counts as a *stated* refusal. `inferred` never does. */
const RECORDABLE_EVIDENCE: ReadonlySet<RefusalEvidence> = new Set<RefusalEvidence>([
  'typed-error',
  'provider-code',
  'finish-reason',
  'message-pattern',
])

export function isRecordableRefusalEvidence(evidence: RefusalEvidence | undefined | null): boolean {
  return !!evidence && RECORDABLE_EVIDENCE.has(evidence)
}

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

/**
 * The auto-switch check in flight per chat, in this process. Two refusals
 * landing together (a text turn and an image job's commit, say) would each
 * read the chat as Monitored before either flip lands and announce twice;
 * chaining them means the second reads the first's outcome.
 */
const switchChecks = new Map<string, Promise<unknown>>()

/**
 * Record one moderation refusal on its chat, and — in the parent — ask
 * whether it earns the auto-switch.
 *
 * Never throws: a ledger failure must not fail the call that was refused.
 */
export async function recordModerationRefusal(rec: RefusalRecord): Promise<RecordRefusalResult> {
  const logContext = {
    chatId: rec.chatId,
    kind: rec.kind,
    purpose: rec.purpose,
    refusedProfileId: rec.refusedProfileId,
    refusedProfileName: rec.refusedProfileName,
    provider: rec.provider,
    modelName: rec.modelName ?? undefined,
    evidence: rec.evidence,
    rerouted: rec.rerouted,
  }

  if (!rec.chatId) {
    logger.debug('Refusal not recorded: no chat to record it on', logContext)
    return { count: null, switched: false }
  }

  if (!isRecordableRefusalEvidence(rec.evidence)) {
    logger.debug('Refusal not recorded: the evidence is not a stated refusal', logContext)
    return { count: null, switched: false }
  }

  try {
    const repos = getRepositories()
    const at = new Date().toISOString()
    const refusedBy: LastRefusal = { provider: rec.provider, modelName: rec.modelName ?? null }
    const count = await repos.chats.incrementModerationRefusalCount(rec.chatId, at, refusedBy)

    if (isJobChild()) {
      logger.info('Moderation refusal recorded (buffered; the parent decides on the auto-switch)', logContext)
      return { count: null, switched: false }
    }

    logger.info('Moderation refusal recorded', { ...logContext, count })
    const { switched } = await maybeAutoSwitchAfterRefusal(rec.chatId, refusedBy)
    return { count: typeof count === 'number' ? count : null, switched }
  } catch (error) {
    logger.error('Failed to record a moderation refusal', {
      ...logContext,
      error: getErrorMessage(error),
    })
    return { count: null, switched: false }
  }
}

/**
 * Switch a Monitored chat to Flagged if its ledger has reached the threshold.
 *
 * Parent process only. Called by {@link recordModerationRefusal} right after
 * an in-parent increment, and by the job dispatcher after it commits a child
 * batch that incremented this chat's ledger. Idempotent: a chat that is not
 * Monitored is left alone, and `applyConciergeFlip` is a no-op on a match.
 * Never throws.
 */
export async function maybeAutoSwitchAfterRefusal(
  chatId: string,
  lastRefusal?: LastRefusal | null,
): Promise<{ switched: boolean }> {
  if (isJobChild()) {
    logger.warn('Auto-switch check refused in the job child; the parent decides', { chatId })
    return { switched: false }
  }

  const previous = switchChecks.get(chatId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(() => runAutoSwitchCheck(chatId, lastRefusal))
  switchChecks.set(chatId, current)
  try {
    return await current
  } finally {
    if (switchChecks.get(chatId) === current) switchChecks.delete(chatId)
  }
}

async function runAutoSwitchCheck(
  chatId: string,
  lastRefusal: LastRefusal | null | undefined,
): Promise<{ switched: boolean }> {
  try {
    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)
    if (!chat) {
      logger.debug('Auto-switch check skipped: chat not found', { chatId })
      return { switched: false }
    }

    const state = getConciergeState(chat)
    if (state !== 'monitored') {
      logger.debug('Auto-switch check skipped: the chat is not Monitored', { chatId, state })
      return { switched: false }
    }

    const chatSettings = await repos.chatSettings.findByUserId(chat.userId)
    const { settings, source } = resolveDangerousContentSettings(chatSettings, chat)
    const threshold = settings.autoSwitchAfterRefusals ?? DEFAULT_AUTO_SWITCH_AFTER_REFUSALS
    const { count } = await repos.chats.getModerationRefusalLedger(chatId)

    const decision = { chatId, count, threshold, mode: settings.mode, source }
    if (threshold <= 0) {
      logger.debug('Auto-switch check: the auto-switch is off', decision)
      return { switched: false }
    }
    if (settings.mode !== 'AUTO_ROUTE') {
      logger.debug('Auto-switch check: the Concierge mode does not permit it', decision)
      return { switched: false }
    }
    if (count < threshold) {
      logger.debug('Auto-switch check: below the threshold', decision)
      return { switched: false }
    }

    const result = await applyConciergeFlip(chatId, 'flagged', chat, {
      by: 'concierge',
      reason: 'refusals',
      refusals: {
        count,
        lastProvider: lastRefusal?.provider ?? '',
        lastModel: lastRefusal?.modelName ?? null,
      },
    })

    logger.info('The Concierge switched a chat to Flagged after repeated refusals', {
      ...decision,
      changed: result.changed,
      lastProvider: lastRefusal?.provider,
      lastModel: lastRefusal?.modelName ?? undefined,
    })
    return { switched: result.changed }
  } catch (error) {
    logger.error('Auto-switch check failed', { chatId, error: getErrorMessage(error) })
    return { switched: false }
  }
}
