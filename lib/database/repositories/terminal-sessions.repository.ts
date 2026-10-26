/**
 * Terminal Sessions Repository
 *
 * Backend-agnostic repository for TerminalSession entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Manages in-chat terminal session metadata, including shell type,
 * working directory, timestamps, and transcript paths.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { TerminalSession, TerminalSessionSchema } from '@/lib/schemas/terminal.types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { getLogsDir } from '@/lib/paths';
import { TypedQueryFilter } from '../interfaces';

/**
 * Terminal Sessions Repository
 * Implements CRUD operations for terminal sessions with chat-level queries.
 */
export class TerminalSessionsRepository extends AbstractBaseRepository<TerminalSession> {
  constructor() {
    super('terminal_sessions', TerminalSessionSchema);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async create(
    data: Omit<TerminalSession, 'id'>,
    options?: CreateOptions
  ): Promise<TerminalSession> {
    return this.safeQuery(
      async () => {
        const session = await this._create(data, options);

        return session;
      },
      'Error creating terminal session',
      { chatId: data.chatId, shell: data.shell }
    );
  }

  async update(
    id: string,
    data: Partial<TerminalSession>
  ): Promise<TerminalSession | null> {
    return this.safeQuery(
      async () => {
        // Remove id to prevent accidental overwrites
        const updateData = { ...data };
        delete updateData.id;

        const session = await this._update(id, updateData);

        if (session) {
        }

        return session;
      },
      'Error updating terminal session',
      { sessionId: id }
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const deleted = await this._delete(id);

        if (deleted) {
        }

        return deleted;
      },
      'Error deleting terminal session',
      { sessionId: id },
      false
    );
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find all sessions for a chat, ordered by startedAt descending
   */
  async findByChatId(chatId: string): Promise<TerminalSession[]> {
    return this.safeQuery(
      async () => {
        const sessions = await this.findByFilter({
          chatId,
        } as TypedQueryFilter<TerminalSession>);

        // Sort by startedAt descending
        return sessions.sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
      },
      'Error finding sessions by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Reap closed terminal sessions older than the cutoff, along with their
   * transcript files.
   *
   * A session is eligible only when it has actually exited (`exitedAt` is
   * non-null) AND exited before `olderThan`. Sessions still running
   * (`exitedAt IS NULL`) are NEVER selected, regardless of how old their
   * `startedAt` is. Transcripts live at `<logsDir>/terminals/<id>.log` (not
   * under `files/`), so nothing else cleans them — we unlink them best-effort
   * here and swallow ENOENT (already gone is success).
   *
   * Parent-only: a DB writer plus filesystem unlink. Invoked by the daily
   * maintenance tick.
   *
   * @returns counts of rows deleted and transcript files removed.
   */
  async cleanupClosedSessions(
    olderThan: Date
  ): Promise<{ rows: number; transcripts: number }> {
    return this.safeQuery(
      async () => {
        const cutoffMs = olderThan.getTime();

        // SQL NULL semantics already exclude running sessions from a `<`
        // comparison, but we re-check `exitedAt != null` in JS so a backend
        // that translates the filter differently can never reap a live PTY.
        const candidates = (
          await this.findByFilter({
            exitedAt: { $lt: olderThan.toISOString() },
          } as TypedQueryFilter<TerminalSession>)
        ).filter(
          (s) =>
            s.exitedAt != null && new Date(s.exitedAt).getTime() < cutoffMs
        );

        const transcriptsDir = path.join(getLogsDir(), 'terminals');
        let rows = 0;
        let transcripts = 0;

        for (const session of candidates) {
          const deleted = await this.delete(session.id);
          if (!deleted) continue;
          rows++;

          const transcriptPath =
            session.transcriptPath ||
            path.join(transcriptsDir, `${session.id}.log`);
          try {
            await fs.unlink(transcriptPath);
            transcripts++;
          } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code !== 'ENOENT') {
              logger.warn('Failed to unlink terminal transcript', {
                sessionId: session.id,
                transcriptPath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        logger.info('Reaped closed terminal sessions', {
          rows,
          transcripts,
          olderThan: olderThan.toISOString(),
        });
        return { rows, transcripts };
      },
      'Error reaping closed terminal sessions',
      {},
      { rows: 0, transcripts: 0 }
    );
  }

  /**
   * Remove transcript files in `<logsDir>/terminals/` that no row names.
   *
   * `terminal_sessions.chatId` cascades on chat delete (a Salon delete, a
   * replace-mode restore, an import overwrite), and the terminals DELETE route
   * drops its row directly; none of them touches the transcript, and
   * `cleanupClosedSessions` only sees rows. This sweep is the backstop.
   *
   * Only `<id>.log` files are considered — the shell-init artifacts beside
   * them (`init-<id>.bashrc`, `zdotdir-<id>/`) are cleaned on PTY exit. A file
   * is spared when a row names it (by id or stored `transcriptPath`), when
   * `isLive(id)` says the PTY is still running (a chat deleted under a live
   * terminal leaves the PTY writing with no row), or when it was modified
   * within `graceMs` (the transcript is opened before the row is created).
   *
   * Parent-only. Invoked by the daily maintenance tick.
   */
  async sweepOrphanedTranscripts(options: {
    isLive: (sessionId: string) => boolean;
    graceMs: number;
    now?: Date;
  }): Promise<{ scanned: number; deleted: number }> {
    return this.safeQuery(
      async () => {
        const transcriptsDir = path.join(getLogsDir(), 'terminals');
        let entries: string[];
        try {
          entries = await fs.readdir(transcriptsDir);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            logger.debug('No terminal transcript directory; nothing to sweep', { transcriptsDir });
            return { scanned: 0, deleted: 0 };
          }
          throw error;
        }

        const rows = await this.findAll();
        const namedIds = new Set(rows.map((s) => s.id));
        const namedPaths = new Set(
          rows
            .map((s) => s.transcriptPath)
            .filter((p): p is string => !!p)
            .map((p) => path.resolve(p))
        );
        const cutoffMs = (options.now ?? new Date()).getTime() - options.graceMs;

        let scanned = 0;
        let deleted = 0;
        for (const name of entries) {
          if (!name.endsWith('.log')) continue;
          scanned++;
          const sessionId = name.slice(0, -'.log'.length);
          const filePath = path.join(transcriptsDir, name);

          if (namedIds.has(sessionId) || namedPaths.has(path.resolve(filePath))) continue;
          if (options.isLive(sessionId)) {
            logger.debug('Sparing transcript of a live PTY with no row', { sessionId });
            continue;
          }

          try {
            const stat = await fs.stat(filePath);
            if (!stat.isFile()) continue;
            if (stat.mtimeMs > cutoffMs) {
              logger.debug('Sparing recently written orphan transcript', { sessionId });
              continue;
            }
            await fs.unlink(filePath);
            deleted++;
            logger.debug('Removed orphaned terminal transcript', { sessionId, filePath });
          } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code !== 'ENOENT') {
              logger.warn('Failed to remove orphaned terminal transcript', {
                sessionId,
                filePath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        logger.info('Swept orphaned terminal transcripts', { scanned, deleted });
        return { scanned, deleted };
      },
      'Error sweeping orphaned terminal transcripts',
      {},
      { scanned: 0, deleted: 0 }
    );
  }

  /**
   * Delete all sessions for a chat (cascade cleanup)
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const sessions = await this.findByChatId(chatId);
        let count = 0;

        for (const session of sessions) {
          const deleted = await this.delete(session.id);
          if (deleted) count++;
        }

        if (count > 0) {
        }

        return count;
      },
      'Error deleting sessions by chat ID',
      { chatId },
      0
    );
  }
}
