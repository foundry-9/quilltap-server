/**
 * The classifier's switch — the Concierge moving a chat to Unmoderated on the
 * chat-level danger classifier's verdict.
 *
 * The classifier job runs in the forked job child, where its writes are
 * buffered and a compare-and-set cannot report whether it landed. So the job
 * records only its telemetry (`ChatsRepository.setDangerClassification`, with
 * the verdict carried alongside), and the decision to move the chat is made
 * here, in the parent, against the chat as it stands now: after the job
 * dispatcher commits the batch (`lib/background-jobs/host/job-dispatcher.ts`),
 * or straight away when the job ran in the parent. The same shape as the
 * refusal ledger's auto-switch.
 *
 * @module services/dangerous-content/classifier-switch
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { getRepositories } from '@/lib/repositories/factory'
import type { ConciergeDangerDetails } from '@/lib/services/concierge-notifications/writer'
import { getConciergeState, isClassifierOnDuty } from './chat-override'
import { applyConciergeFlip } from './manual-flip'

const logger = createServiceLogger('ConciergeClassifierSwitch')

/**
 * Move a chat to Unmoderated on a dangerous verdict, if it is still Moderated.
 *
 * Parent process only. Re-reads the chat, so an operator's newer choice
 * (Locked, or Unmoderated by hand) is left alone, and `applyConciergeFlip`'s
 * compare-and-set closes the gap between that read and the write. Never throws.
 */
export async function maybeSwitchAfterClassification(
  chatId: string,
  verdict: ConciergeDangerDetails | null | undefined,
): Promise<{ switched: boolean }> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    logger.warn('Classifier switch refused in the job child; the parent decides', { chatId })
    return { switched: false }
  }

  try {
    const chat = await getRepositories().chats.findById(chatId)
    if (!chat) {
      logger.debug('Classifier switch skipped: chat not found', { chatId })
      return { switched: false }
    }
    if (!isClassifierOnDuty(chat)) {
      logger.info('Classifier switch skipped: the chat is no longer Moderated', {
        chatId,
        state: getConciergeState(chat),
      })
      return { switched: false }
    }

    const result = await applyConciergeFlip(chatId, 'unmoderated', chat, {
      by: 'concierge',
      reason: 'classifier',
      classification: verdict ?? undefined,
    })
    logger.info('Classifier verdict applied', { chatId, switched: result.changed })
    return { switched: result.changed }
  } catch (error) {
    logger.error('Classifier switch failed', { chatId, error: getErrorMessage(error) })
    return { switched: false }
  }
}
