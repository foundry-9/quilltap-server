/**
 * Writer for Salon participation announcements (the Host).
 *
 * When a character joins, leaves, or changes participation status in a chat,
 * this helper injects a synthetic ASSISTANT-role chat message authored by the
 * Host so both the user and the other characters in the chat see it as part of
 * normal conversation history.
 *
 * Add announcements include the joining character's avatar (as inline markdown)
 * and either their identity (if a character vault is present and exposes
 * `identity.md`) or their `description` field — preferring identity, never both.
 * Remove and status-change announcements are text-only.
 *
 * Errors never propagate — participant operations must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { readDatabaseDocument } from '@/lib/mount-index/database-store';
import type { MessageEvent } from '@/lib/schemas/types';
import type { Character } from '@/lib/schemas/character.types';
import type { ParticipantStatus } from '@/lib/schemas/chat.types';

export interface HostAddAnnouncement {
  chatId: string;
  character: Character;
}

export interface HostRemoveAnnouncement {
  chatId: string;
  characterName: string;
}

export interface HostStatusChangeAnnouncement {
  chatId: string;
  characterName: string;
  oldStatus: ParticipantStatus;
  newStatus: ParticipantStatus;
}

const STATUS_PHRASE: Record<ParticipantStatus, string> = {
  active: 'present and speaking freely',
  silent: 'present but holding their tongue — observing, not speaking aloud',
  absent: 'stepped away from the scene for the moment',
  removed: 'departed the Salon',
};

async function readVaultIdentity(character: Character): Promise<string | null> {
  if (!character.characterDocumentMountPointId) return null;
  try {
    const { content } = await readDatabaseDocument(
      character.characterDocumentMountPointId,
      'identity.md',
    );
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function buildAddContent(character: Character): Promise<string> {
  const lines: string[] = [];
  lines.push(`The Host welcomes ${character.name} to the Salon.`);
  lines.push('');

  if (character.avatarUrl && character.avatarUrl.trim().length > 0) {
    lines.push(`![${character.name}](${character.avatarUrl})`);
    lines.push('');
  }

  const identity = await readVaultIdentity(character);
  if (identity) {
    lines.push('**Identity:**');
    lines.push('');
    lines.push(identity);
  } else {
    const description = (character.description ?? '').trim();
    if (description.length > 0) {
      lines.push('**Description:**');
      lines.push('');
      lines.push(description);
    }
  }

  return lines.join('\n').trimEnd();
}

export function buildRemoveContent(characterName: string): string {
  return `The Host bids ${characterName} adieu — they have departed the Salon.`;
}

export function buildStatusChangeContent(
  characterName: string,
  oldStatus: ParticipantStatus,
  newStatus: ParticipantStatus,
): string {
  const before = STATUS_PHRASE[oldStatus] ?? oldStatus;
  const after = STATUS_PHRASE[newStatus] ?? newStatus;
  return `The Host notes that ${characterName} is now ${after} (previously ${before}).`;
}

async function postHostMessage(
  chatId: string,
  content: string,
  kindLabel: string,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('[HostNotification] Chat not found, skipping announcement', {
        context: 'host-notifications',
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
      systemSender: 'host',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[HostNotification] Announcement posted', {
      context: 'host-notifications',
      chatId,
      messageId,
      kindLabel,
    });

    return message;
  } catch (error) {
    logger.error('[HostNotification] Failed to post announcement', {
      context: 'host-notifications',
      chatId,
      kindLabel,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postHostAddAnnouncement(
  params: HostAddAnnouncement,
): Promise<MessageEvent | null> {
  const content = await buildAddContent(params.character);
  logger.debug('[HostNotification] Posting add announcement', {
    context: 'host-notifications',
    chatId: params.chatId,
    characterId: params.character.id,
    characterName: params.character.name,
    hasAvatar: Boolean(params.character.avatarUrl),
    hasVault: Boolean(params.character.characterDocumentMountPointId),
  });
  return postHostMessage(params.chatId, content, 'add');
}

export async function postHostRemoveAnnouncement(
  params: HostRemoveAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildRemoveContent(params.characterName);
  logger.debug('[HostNotification] Posting remove announcement', {
    context: 'host-notifications',
    chatId: params.chatId,
    characterName: params.characterName,
  });
  return postHostMessage(params.chatId, content, 'remove');
}

export async function postHostStatusChangeAnnouncement(
  params: HostStatusChangeAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildStatusChangeContent(
    params.characterName,
    params.oldStatus,
    params.newStatus,
  );
  logger.debug('[HostNotification] Posting status-change announcement', {
    context: 'host-notifications',
    chatId: params.chatId,
    characterName: params.characterName,
    oldStatus: params.oldStatus,
    newStatus: params.newStatus,
  });
  return postHostMessage(params.chatId, content, `status:${params.oldStatus}->${params.newStatus}`);
}
