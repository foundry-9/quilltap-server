/**
 * Terminal session reconciliation
 *
 * After a server restart, DB rows for live PTY sessions are stale — the
 * underlying processes are gone but `exitedAt` is still null. This sweeps
 * those orphans for a given chat: marks them exited and posts an Ariel
 * close announcement so the user sees what happened.
 */

import { ptyManager } from './pty-manager';
import { getRepositories } from '@/lib/repositories/factory';
import { postArielSessionClosedAnnouncement } from '@/lib/services/ariel-notifications';
import { logger } from '@/lib/logger';

const reconcileLogger = logger.child({ module: 'terminal-reconcile' });

export async function reconcileTerminalSessionsForChat(chatId: string): Promise<number> {
  try {
    const repos = getRepositories();
    const sessions = await repos.terminalSessions.findByChatId(chatId);

    let reconciled = 0;
    for (const session of sessions) {
      if (session.exitedAt != null) continue;
      if (ptyManager.get(session.id)) continue;

      const now = new Date().toISOString();
      await repos.terminalSessions.update(session.id, {
        exitedAt: now,
        exitCode: null,
      });

      await postArielSessionClosedAnnouncement({
        chatId,
        sessionId: session.id,
        exitCode: null,
      });

      reconciled++;
      reconcileLogger.info('[TerminalReconcile] Reconciled orphaned session', {
        chatId,
        sessionId: session.id,
      });
    }

    if (reconciled > 0) {
      reconcileLogger.info('[TerminalReconcile] Reconciled orphaned sessions for chat', {
        chatId,
        count: reconciled,
      });
    }

    return reconciled;
  } catch (err) {
    reconcileLogger.warn('[TerminalReconcile] Reconciliation failed', {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
