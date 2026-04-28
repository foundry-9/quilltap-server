/**
 * Writer for Prospero announcements.
 *
 * Prospero is the master of the agentic and tool-using systems — the personified
 * feature that knows which LLM is presently driving each character. When the user
 * reassigns a participant to a different connection profile (via the Participants
 * sidebar in the Salon), Prospero injects a synthetic ASSISTANT-role chat message
 * so the user and any system-transparent characters in the room are aware of the
 * change.
 *
 * Errors never propagate — participant updates must never fail because an
 * announcement could not be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { MessageEvent } from '@/lib/schemas/types';

export interface ProsperoConnectionProfileChangeAnnouncement {
  chatId: string;
  characterName: string;
  oldProfileLabel: string | null;
  newProfileLabel: string | null;
}

export function buildConnectionProfileChangeContent(
  characterName: string,
  oldProfileLabel: string | null,
  newProfileLabel: string | null,
): string {
  const newPhrase = newProfileLabel ?? 'no connection profile';
  const oldPhrase = oldProfileLabel ?? 'no connection profile';
  return `Prospero notes that ${characterName} has been reassigned to ${newPhrase} (previously ${oldPhrase}).`;
}

async function postProsperoMessage(
  chatId: string,
  content: string,
  kindLabel: string,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('[ProsperoNotification] Chat not found, skipping announcement', {
        context: 'prospero-notifications',
        chatId,
        kindLabel,
      });
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'prospero',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[ProsperoNotification] Announcement posted', {
      context: 'prospero-notifications',
      chatId,
      messageId,
      kindLabel,
    });

    return message;
  } catch (error) {
    logger.error('[ProsperoNotification] Failed to post announcement', {
      context: 'prospero-notifications',
      chatId,
      kindLabel,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postProsperoConnectionProfileChangeAnnouncement(
  params: ProsperoConnectionProfileChangeAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildConnectionProfileChangeContent(
    params.characterName,
    params.oldProfileLabel,
    params.newProfileLabel,
  );
  logger.debug('[ProsperoNotification] Posting connection-profile-change announcement', {
    context: 'prospero-notifications',
    chatId: params.chatId,
    characterName: params.characterName,
    oldProfileLabel: params.oldProfileLabel,
    newProfileLabel: params.newProfileLabel,
  });
  return postProsperoMessage(params.chatId, content, 'connection-profile-change');
}

// ---------------------------------------------------------------------------
// Phase E: Project context whispers. Replaces the per-turn `## Project
// Context` system-prompt block. Fired at chat-start and at the configured
// cadence (default every 5 messages — see
// `chatSettings.contextCompressionSettings.projectContextReinjectInterval`).
// ---------------------------------------------------------------------------

export interface ProsperoProjectContext {
  name: string;
  description?: string | null;
  instructions?: string | null;
}

export function buildProjectContextContent(project: ProsperoProjectContext): string {
  const lines: string[] = [
    `Prospero opens his ledger to the project at hand — *${project.name}* — and lays its particulars before you:`,
    '',
  ];
  const description = project.description?.trim();
  const instructions = project.instructions?.trim();

  if (description) {
    lines.push('**Project description:**');
    lines.push('');
    lines.push(description);
  }

  if (instructions) {
    if (description) lines.push('');
    lines.push('**Project instructions:**');
    lines.push('');
    lines.push(instructions);
  }

  return lines.join('\n').trimEnd();
}

export interface ProsperoProjectContextAnnouncement {
  chatId: string;
  project: ProsperoProjectContext;
}

export async function postProsperoProjectContextAnnouncement(
  params: ProsperoProjectContextAnnouncement,
): Promise<MessageEvent | null> {
  const description = params.project.description?.trim();
  const instructions = params.project.instructions?.trim();
  if (!description && !instructions) {
    logger.debug('[ProsperoNotification] No project description or instructions, skipping project-context whisper', {
      context: 'prospero-notifications',
      chatId: params.chatId,
      projectName: params.project.name,
    });
    return null;
  }

  const content = buildProjectContextContent(params.project);
  logger.debug('[ProsperoNotification] Posting project-context whisper', {
    context: 'prospero-notifications',
    chatId: params.chatId,
    projectName: params.project.name,
    hasDescription: Boolean(description),
    hasInstructions: Boolean(instructions),
  });
  return postProsperoMessage(params.chatId, content, 'project-context');
}
