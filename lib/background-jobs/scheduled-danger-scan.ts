/**
 * Scheduled Danger Classification Scan
 *
 * Runs on startup (and periodically) to find all unclassified chats and
 * enqueue danger classification jobs for them. Ensures every chat eventually
 * gets classified, including legacy chats created before the feature existed.
 *
 * Opt-in: the sweep runs only for users whose Concierge is on duty with the
 * summary classifier switched on (`conciergeSettings.enabled` and
 * `preScreen.summaryClassification`), and the scheduler does not start at all
 * when no user has asked for it.
 *
 * Decision tree per unclassified chat:
 * - Has contextSummary or scenarioText → enqueue CHAT_DANGER_CLASSIFICATION directly
 * - Neither, messageCount > 50 → enqueue CONTEXT_SUMMARY (chaining handles classification)
 * - Neither, messageCount <= 50 → enqueue CHAT_DANGER_CLASSIFICATION (handler uses raw messages)
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { isModerationExemptChatType } from '@/lib/schemas/chat.types';
import { readConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import type { ChatSettings } from '@/lib/schemas/types';
import { isClassifierOnDuty } from '@/lib/services/dangerous-content/chat-override';
import { enqueueChatDangerClassification, enqueueContextSummary } from './queue-service';

const logger = createServiceLogger('ScheduledDangerScan');

/** Danger scan scheduler state */
let dangerScanScheduler: ReturnType<typeof setInterval> | null = null;
let dangerScanSchedulerRunning = false;

/** Default interval: run every 10 minutes */
const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Whether a user has asked for the summary classifier and its sweep: the
 * Concierge on duty, and the summary classifier opted in. Per-chat state
 * (Moderated only) is checked chat by chat below.
 */
function wantsSummaryClassification(settings: Pick<ChatSettings, 'conciergeSettings'>): boolean {
  const concierge = readConciergeSettings(settings);
  return concierge.enabled && concierge.preScreen.summaryClassification;
}

/**
 * Schedule automatic danger classification scan to run periodically.
 * Checks whether any user has the summary classifier on before starting — if
 * none has, the scheduler is not started.
 * @param intervalMs - How often to run the scan (default: 10 minutes)
 */
export async function scheduleDangerScan(intervalMs: number = DEFAULT_SCAN_INTERVAL_MS): Promise<void> {
  if (dangerScanSchedulerRunning) {
    return;
  }

  // Pre-check: skip unless some user has the summary classifier on
  try {
    const repos = getRepositories();
    const allChatSettings = await repos.chatSettings.findAll();
    const optedIn = allChatSettings.filter(wantsSummaryClassification).length;
    logger.debug('Danger scan scheduler pre-check', {
      users: allChatSettings.length,
      summaryClassificationUsers: optedIn,
    });

    if (optedIn === 0) {
      logger.info('Danger scan scheduler not started — no user has the Concierge\'s summary classification on');
      return;
    }
  } catch (error) {
    logger.warn('Could not check Concierge settings, skipping danger scan scheduler', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  dangerScanSchedulerRunning = true;
  dangerScanScheduler = setInterval(() => {
    runScheduledDangerScan().catch((error) => {
      logger.error('Error in scheduled danger scan interval', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  logger.info('Danger scan scheduler started', { intervalMs });

  // Run scan immediately on startup
  runScheduledDangerScan().catch((error) => {
    logger.error('Error in initial danger scan', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Stop the danger scan scheduler
 */
export function stopDangerScanScheduler(): void {
  if (dangerScanScheduler) {
    clearInterval(dangerScanScheduler);
    dangerScanScheduler = null;
  }
  dangerScanSchedulerRunning = false;
  logger.info('Danger scan scheduler stopped');
}

/**
 * Check if the danger scan scheduler is running
 */
export function isDangerScanSchedulerRunning(): boolean {
  return dangerScanSchedulerRunning;
}

/**
 * Run the danger scan: find all unclassified chats and enqueue classification jobs.
 * This is called automatically on the schedule, or can be called manually.
 */
export async function runScheduledDangerScan(): Promise<{ usersProcessed: number; chatsEnqueued: number }> {
  logger.info('Starting scheduled danger classification scan');

  try {
    const repos = getRepositories();

    // Get all users with chat settings
    const allChatSettings = await repos.chatSettings.findAll();

    let usersProcessed = 0;
    let chatsEnqueued = 0;
    let totalChats = 0;

    for (const settings of allChatSettings) {
      // Only users who opted in to the summary classifier are swept
      if (!wantsSummaryClassification(settings)) {
        logger.debug('Skipping user without summary classification', { userId: settings.userId });
        continue;
      }

      // Get all chats for this user
      const chats = await repos.chats.findByUserId(settings.userId);
      totalChats += chats.length;

      // Filter to chats needing classification:
      // 1. Never classified (isDangerousChat is null/undefined)
      // 2. Classified as safe but message count has changed since classification
      //    (dangerous chats are sticky and never re-checked)
      // Moderation-exempt chat types (Help Chat, Brahma Console) are never
      // enqueued — the Concierge does not operate there at all.
      // Operator-decided chats (Vouched Safe or Uncensored) are always
      // skipped — nothing may reclassify a chat out from under the operator.
      const unclassified = chats.filter((chat) => {
        if (isModerationExemptChatType(chat.chatType)) return false;
        if (!isClassifierOnDuty(chat)) return false;
        if (chat.isDangerousChat == null) return true;
        if (chat.isDangerousChat === false &&
            chat.dangerClassifiedAtMessageCount != null &&
            (chat.messageCount ?? 0) > chat.dangerClassifiedAtMessageCount) {
          return true;
        }
        return false;
      });

      if (unclassified.length === 0) {
        usersProcessed++;
        continue;
      }

      // Get available connection profiles for this user
      const availableProfiles = await repos.connections.findByUserId(settings.userId);

      // Build a set of valid profile IDs for quick lookup
      const validProfileIds = new Set(availableProfiles.map((p) => p.id));

      for (const chat of unclassified) {
        // Find a connection profile ID:
        // 1. First LLM-controlled participant with a connectionProfileId that still exists
        // 2. Fall back to first available profile from user's profiles
        let connectionProfileId: string | null = null;

        if (chat.participants && chat.participants.length > 0) {
          const llmParticipant = chat.participants.find(
            (p) => p.controlledBy !== 'user' && p.connectionProfileId && validProfileIds.has(p.connectionProfileId)
          );
          if (llmParticipant?.connectionProfileId) {
            connectionProfileId = llmParticipant.connectionProfileId;
          }
        }

        if (!connectionProfileId && availableProfiles.length > 0) {
          connectionProfileId = availableProfiles[0].id;
        }

        if (!connectionProfileId) {
          continue;
        }

        try {
          if (chat.contextSummary || chat.scenarioText) {
            // Has a summary, or a scenario to stand in for one until the first
            // fold → classify directly. The handler picks between them and
            // reports which it used. Before bug 158 the scenario arrived here
            // disguised as a summary, so this branch already took every
            // scenario-bearing chat; naming it changes nothing but the log.
            await enqueueChatDangerClassification(
              settings.userId,
              { chatId: chat.id, connectionProfileId },
              { priority: -2 }
            );
            chatsEnqueued++;
          } else if ((chat.messageCount ?? 0) > 50) {
            // No summary and no scenario, long chat → summarize first (chaining handles classification)
            await enqueueContextSummary(
              settings.userId,
              { chatId: chat.id, connectionProfileId, forceRegenerate: false },
              { priority: -2 }
            );
            chatsEnqueued++;
          } else {
            // No summary and no scenario, short chat → classify from raw messages
            await enqueueChatDangerClassification(
              settings.userId,
              { chatId: chat.id, connectionProfileId },
              { priority: -2 }
            );
            chatsEnqueued++;
          }
        } catch (enqueueError) {
          logger.warn('Failed to enqueue job for chat', {
            chatId: chat.id,
            userId: settings.userId,
            error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
          });
        }
      }

      usersProcessed++;
    }

    logger.info('Scheduled danger scan completed', {
      usersProcessed,
      chatsEnqueued,
      totalChats,
    });

    return { usersProcessed, chatsEnqueued };
  } catch (error) {
    logger.error('Scheduled danger scan failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
