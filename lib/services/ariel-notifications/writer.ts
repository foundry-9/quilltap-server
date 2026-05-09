/**
 * Writer for Terminal Session Announcements (Ariel)
 *
 * When a terminal session is opened or closed in the Salon, Ariel posts
 * synthetic ASSISTANT-role chat messages announcing the session lifecycle.
 * These messages are visible to the user and other characters in the chat,
 * providing context about terminal activity.
 *
 * Errors never propagate — terminal operations must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { MessageEvent } from '@/lib/schemas/types';

const arielLogger = logger.child({ module: 'ariel-notifications' });

async function postArielMessage(
  chatId: string,
  content: string,
  systemKind: string,
  terminalSessionId: string | null = null,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      arielLogger.debug('[ArielNotification] Chat not found, skipping announcement', {
        context: 'ariel-notifications',
        chatId,
        systemKind,
      });
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    // Embed terminal session ID in content as an HTML comment so the Salon renderer
    // can detect it and associate the message with the session.
    const contentWithId = terminalSessionId
      ? `<!-- terminalSessionId:${terminalSessionId} -->\n${content}`
      : content;

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content: contentWithId,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'ariel',
      systemKind,
    };

    await repos.chats.addMessage(chatId, message);

    arielLogger.info('[ArielNotification] Announcement posted', {
      context: 'ariel-notifications',
      chatId,
      messageId,
      systemKind,
      terminalSessionId,
    });

    return message;
  } catch (error) {
    arielLogger.error('[ArielNotification] Failed to post announcement', {
      context: 'ariel-notifications',
      chatId,
      systemKind,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export interface ArielSessionOpenedAnnouncement {
  chatId: string;
  sessionId: string;
  label?: string | null;
  shell: string;
  cwd: string;
}

/**
 * Post a session-opened announcement from Ariel
 *
 * Announces the opening of a new terminal session with shell and working directory.
 * Content is styled in steampunk/Lemony Snicket voice to match Quilltap conventions.
 */
export async function postArielSessionOpenedAnnouncement(
  params: ArielSessionOpenedAnnouncement,
): Promise<MessageEvent | null> {
  const label = params.label ? ` — "${params.label}"` : '';
  const content = [
    `Ariel has opened a terminal aboard the **${params.shell}** at \`${params.cwd}\`${label}.`,
    '',
    `(Session id: \`${params.sessionId}\`.)`
  ].join('\n');

  arielLogger.debug('[ArielNotification] Posting session-opened announcement', {
    context: 'ariel-notifications',
    chatId: params.chatId,
    sessionId: params.sessionId,
    shell: params.shell,
    cwd: params.cwd,
    hasLabel: Boolean(params.label),
  });

  return postArielMessage(
    params.chatId,
    content,
    'session-opened',
    params.sessionId,
  );
}

export interface ArielTerminalOutputAnnouncement {
  chatId: string;
  sessionId: string;
  cleanedOutput: string;
  reason: 'idle' | 'max-age' | 'session-closed';
}

const TERMINAL_OUTPUT_MAX_CHARS = 16 * 1024;
const TERMINAL_OUTPUT_HEAD_TAIL_CHARS = 8 * 1024;

function computeFenceLength(content: string): number {
  const matches = content.match(/`+/g);
  const longestRun = matches ? matches.reduce((m, run) => Math.max(m, run.length), 0) : 0;
  return Math.max(3, longestRun + 1);
}

function elideForChat(input: string): string {
  if (input.length <= TERMINAL_OUTPUT_MAX_CHARS) return input;
  const head = input.slice(0, TERMINAL_OUTPUT_HEAD_TAIL_CHARS);
  const tail = input.slice(-TERMINAL_OUTPUT_HEAD_TAIL_CHARS);
  const elidedBytes = input.length - head.length - tail.length;
  return `${head}\n\n… [${elidedBytes.toLocaleString('en-US')} characters elided] …\n\n${tail}`;
}

/**
 * Post a periodic terminal-output summary from Ariel.
 *
 * Returns null if `cleanedOutput` is empty or whitespace-only — there is no
 * value in posting a blank message just because a debounce timer fired.
 */
export async function postArielTerminalOutputAnnouncement(
  params: ArielTerminalOutputAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.cleanedOutput || params.cleanedOutput.trim().length === 0) {
    arielLogger.debug('[ArielNotification] Skipping empty terminal-output announcement', {
      context: 'ariel-notifications',
      chatId: params.chatId,
      sessionId: params.sessionId,
      reason: params.reason,
    });
    return null;
  }

  const elided = elideForChat(params.cleanedOutput);
  const fence = '`'.repeat(computeFenceLength(elided));
  const sessionLabel = params.sessionId.slice(0, 8);
  const reasonNote =
    params.reason === 'session-closed'
      ? ' (final, session closed)'
      : params.reason === 'max-age'
        ? ' (long-running, periodic flush)'
        : '';

  const content = [
    `Terminal output from session \`${sessionLabel}\`${reasonNote}:`,
    '',
    `${fence}`,
    elided,
    `${fence}`,
  ].join('\n');

  arielLogger.debug('[ArielNotification] Posting terminal-output announcement', {
    context: 'ariel-notifications',
    chatId: params.chatId,
    sessionId: params.sessionId,
    reason: params.reason,
    cleanedChars: params.cleanedOutput.length,
    postedChars: elided.length,
    elided: elided.length !== params.cleanedOutput.length,
  });

  return postArielMessage(
    params.chatId,
    content,
    `terminal-output-${params.reason}`,
    params.sessionId,
  );
}

export interface ArielSessionClosedAnnouncement {
  chatId: string;
  sessionId: string;
  exitCode: number | null;
}

/**
 * Post a session-closed announcement from Ariel
 *
 * Announces the closing of a terminal session with exit code.
 */
export async function postArielSessionClosedAnnouncement(
  params: ArielSessionClosedAnnouncement,
): Promise<MessageEvent | null> {
  const exitLabel =
    params.exitCode === 0
      ? 'successfully'
      : params.exitCode == null
        ? '— Ariel could not recover an exit code; the session may have ended when the server last restarted'
        : `with exit code ${params.exitCode}`;
  const content = `Ariel notes that the terminal session has closed — it exited ${exitLabel}.`;

  arielLogger.debug('[ArielNotification] Posting session-closed announcement', {
    context: 'ariel-notifications',
    chatId: params.chatId,
    sessionId: params.sessionId,
    exitCode: params.exitCode,
  });

  return postArielMessage(
    params.chatId,
    content,
    'session-closed',
    params.sessionId,
  );
}
