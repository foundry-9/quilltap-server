/**
 * Autonomous Room announcements + run-start contract (4.6 Private Character Rooms)
 *
 * Shared between the three run-start entry points (manual start, scheduled
 * tick, and the turn handler's defensive idle→running fallback) and the turn
 * handler's lifecycle announcements. Centralising the run-start row patch and
 * the "run begun" banner here keeps the contract single-sourced: a run flips
 * straight to `running` the instant it is requested — synchronously in the
 * parent for a manual start, in the schedule-tick batch for a scheduled run —
 * so the Salon header badges reflect the live status immediately instead of
 * waiting for the first turn job to come around and flip `idle → running`.
 *
 * @module lib/background-jobs/handlers/autonomous-room-announce
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { getActiveCharacterParticipants } from '@/lib/chat/turn-manager';
import { logger } from '@/lib/logger';
import type { ChatMetadata, ChatMetadataBase, MessageEvent } from '@/lib/schemas/types';

const HANDLER = 'background-jobs.autonomous-room-announce';

export type AutonomousRoomKind =
  | 'autonomous-room-start'
  | 'autonomous-room-end'
  | 'autonomous-room-paused'
  | 'autonomous-room-halfway'
  | 'autonomous-room-nearing-end'
  | 'autonomous-room-grace';

/**
 * The run-state row subset written when a run begins. A run goes straight to
 * `running` with `runStartedAt` stamped and every per-run counter zeroed, so
 * the status is correct the moment the run is requested rather than after the
 * first turn job executes. Callers spread this into their own
 * `repos.chats.update` patch alongside any schedule bookkeeping (e.g.
 * `scheduleLastRunAt` / `scheduleNextRunAt`).
 *
 * `runStartedAt` anchors both the wall-clock budget and the per-run token
 * window; stamping it here means wall-clock counts from the button press
 * (including any brief job-queue wait before the first turn), which matches
 * what the household sees on the badge countdown.
 */
export function runStartPatch(nowIso: string, runId: string): Partial<ChatMetadataBase> {
  return {
    currentRunId: runId,
    runState: 'running',
    runStateMessage: null,
    runStartedAt: nowIso,
    runEndedAt: null,
    // Fresh run — drop any pause state left over from a prior run so it can't
    // bleed into this run's wall-clock accounting.
    runPausedAt: null,
    runPausedAccumMs: 0,
    runTurnsConsumed: 0,
    runTokensConsumed: 0,
    runMilestonesAnnounced: 0,
  } as unknown as Partial<ChatMetadataBase>;
}

export function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Post a Host-authored `autonomous-room-*` system message. The Host owns the
 * announcement surface for autonomous rooms (start / end / paused / pacing).
 * Uses `host-avatar.webp` via the existing chat-UI lookup keyed on
 * `systemSender`.
 *
 * `opaqueContent` is the persona-free body swapped into every character's LLM
 * context when the room is opaque-anywhere (any participant lacks
 * `systemTransparency`). Pass it for messages that the characters should read
 * and act on — the pacing nudges in particular — so the steering survives the
 * opaque swap; the human always sees the Host-voiced `content` in the Salon.
 */
export async function postAutonomousRoomAnnouncement(
  chatId: string,
  systemKind: AutonomousRoomKind,
  content: string,
  opaqueContent: string | null = null,
): Promise<void> {
  const repos = getRepositories();
  const message: MessageEvent = {
    type: 'message',
    id: randomUUID(),
    role: 'ASSISTANT',
    content,
    opaqueContent,
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: null,
    systemSender: 'host',
    systemKind,
  };
  try {
    await repos.chats.addMessage(chatId, message);
  } catch (error) {
    logger.warn('Autonomous-room: failed to post announcement', {
      context: HANDLER, chatId, systemKind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Post the "Autonomous room run begun" banner. Summarises the configured caps
 * and the participating characters so the household sees what just kicked off.
 * Best-effort: a lookup or write failure is logged and swallowed (the run has
 * already been written to `running`; a missing banner must not wedge it).
 */
export async function postRunStartAnnouncement(
  chatId: string,
  runId: string,
  chat: ChatMetadata,
): Promise<void> {
  const repos = getRepositories();

  const caps: string[] = [];
  if (chat.budgetMaxTurns != null) caps.push(`${chat.budgetMaxTurns} turn(s)`);
  if (chat.budgetMaxTokens != null) caps.push(`${chat.budgetMaxTokens.toLocaleString()} token(s)`);
  if (chat.budgetMaxWallClockMs != null) caps.push(`${Math.round(chat.budgetMaxWallClockMs / 60000)} min`);
  const capSummary = caps.length > 0 ? `Caps: ${caps.join(', ')}.` : 'No caps configured.';

  const startParticipants = getActiveCharacterParticipants(chat.participants ?? []);
  const startNames: string[] = [];
  for (const p of startParticipants) {
    if (!p.characterId) continue;
    const c = await repos.characters.findById(p.characterId);
    if (c?.name) startNames.push(c.name);
  }
  const participantsSummary = formatNameList(startNames);
  const prefix = participantsSummary
    ? `Autonomous room run begun with ${participantsSummary}.`
    : `Autonomous room run begun.`;

  await postAutonomousRoomAnnouncement(
    chatId,
    'autonomous-room-start',
    `${prefix} ${capSummary} Run id: ${runId}.`,
  );
}
