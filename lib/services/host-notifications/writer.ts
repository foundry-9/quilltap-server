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
import type { OtherParticipantInfo } from '@/lib/chat/context/system-prompt-builder';
import { buildMultiCharacterContextSection } from '@/lib/llm/message-formatter';

export interface HostAddAnnouncement {
  chatId: string;
  character: Character;
  /**
   * Participant ID of the joining character. Used to tag the message with a
   * `hostEvent` payload so the per-character Librarian summary pipeline can
   * reconstruct presence windows.
   */
  participantId: string;
  /**
   * Initial participation status. Defaults to 'active' when omitted (matches
   * `handleAddParticipant`'s default), but pass through explicitly when a
   * caller adds a participant in a non-active state.
   */
  initialStatus?: ParticipantStatus;
}

export interface HostRemoveAnnouncement {
  chatId: string;
  characterName: string;
  /** Participant ID of the leaving character. */
  participantId: string;
}

export interface HostStatusChangeAnnouncement {
  chatId: string;
  characterName: string;
  /** Participant ID of the character whose status changed. */
  participantId: string;
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
  hostEvent: { participantId: string; toStatus: ParticipantStatus } | null = null,
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
      hostEvent,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[HostNotification] Announcement posted', {
      context: 'host-notifications',
      chatId,
      messageId,
      kindLabel,
      hostEvent,
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
  const toStatus: ParticipantStatus = params.initialStatus ?? 'active';
  logger.debug('[HostNotification] Posting add announcement', {
    context: 'host-notifications',
    chatId: params.chatId,
    characterId: params.character.id,
    characterName: params.character.name,
    participantId: params.participantId,
    toStatus,
    hasAvatar: Boolean(params.character.avatarUrl),
    hasVault: Boolean(params.character.characterDocumentMountPointId),
  });
  return postHostMessage(params.chatId, content, 'add', {
    participantId: params.participantId,
    toStatus,
  });
}

export async function postHostRemoveAnnouncement(
  params: HostRemoveAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildRemoveContent(params.characterName);
  logger.debug('[HostNotification] Posting remove announcement', {
    context: 'host-notifications',
    chatId: params.chatId,
    characterName: params.characterName,
    participantId: params.participantId,
  });
  return postHostMessage(params.chatId, content, 'remove', {
    participantId: params.participantId,
    toStatus: 'removed',
  });
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
    participantId: params.participantId,
    oldStatus: params.oldStatus,
    newStatus: params.newStatus,
  });
  return postHostMessage(params.chatId, content, `status:${params.oldStatus}->${params.newStatus}`, {
    participantId: params.participantId,
    toStatus: params.newStatus,
  });
}

// ---------------------------------------------------------------------------
// Phase C extensions: scenario, user character, multi-character context,
// silent-mode entry/exit, join scenario. Build helpers + post functions.
// These announce content that previously lived in the per-turn system prompt.
// ---------------------------------------------------------------------------

export function buildScenarioContent(scenarioText: string): string {
  return [
    'The Host sets the scene for the proceedings:',
    '',
    scenarioText.trim(),
  ].join('\n');
}

export function buildUserCharacterContent(
  userCharacterName: string,
  userCharacterDescription: string | null | undefined,
): string {
  const desc = (userCharacterDescription ?? '').trim();
  if (desc.length === 0) {
    return `The Host introduces ${userCharacterName} to the assembled company — they will be the user's voice in this conversation.`;
  }
  return [
    `The Host introduces ${userCharacterName}, who will be the user's voice in this conversation:`,
    '',
    desc,
  ].join('\n');
}

export function buildMultiCharacterRosterContent(
  respondingCharacterName: string,
  others: OtherParticipantInfo[],
): string {
  const section = buildMultiCharacterContextSection(others, respondingCharacterName);
  if (!section) {
    return `The Host notes that, for the moment, ${respondingCharacterName} stands alone in the Salon.`;
  }
  return [
    'The Host outlines the company present in the Salon:',
    '',
    section,
  ].join('\n');
}

export function buildSilentModeEntryContent(characterName: string): string {
  return [
    `The Host whispers a private note to ${characterName} alone:`,
    '',
    'You have entered SILENT mode. You are present in the scene but MUST NOT speak out loud — no dialogue that others can hear. You may:',
    '- Have inner thoughts and internal monologue (use *italics* or describe as thoughts)',
    '- Take physical actions (gestures, movements, facial expressions)',
    '- React emotionally or physically to what others say and do',
    '',
    'You MUST NOT:',
    '- Speak any dialogue out loud',
    '- Whisper, murmur, or make any vocal sounds others could hear',
    '- Communicate verbally in any way',
    '',
    'This rule remains in force until the Host whispers that you are no longer silent.',
  ].join('\n');
}

export function buildSilentModeExitContent(characterName: string): string {
  return `The Host whispers a private note to ${characterName} alone: silence is lifted. You may speak aloud again.`;
}

export function buildJoinScenarioContent(
  characterName: string,
  joinScenario: string,
): string {
  return [
    `The Host whispers a private note to ${characterName} alone, recounting how they came to be here:`,
    '',
    joinScenario.trim(),
  ].join('\n');
}

async function postHostMessageWithTargets(
  chatId: string,
  content: string,
  kindLabel: string,
  targetParticipantIds: string[] | null,
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
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length > 0 ? targetParticipantIds : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[HostNotification] Whisper posted', {
      context: 'host-notifications',
      chatId,
      messageId,
      kindLabel,
      targets: targetParticipantIds,
    });

    return message;
  } catch (error) {
    logger.error('[HostNotification] Failed to post whisper', {
      context: 'host-notifications',
      chatId,
      kindLabel,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export interface HostScenarioAnnouncement {
  chatId: string;
  scenarioText: string;
}

export async function postHostScenarioAnnouncement(
  params: HostScenarioAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.scenarioText || params.scenarioText.trim().length === 0) return null;
  return postHostMessageWithTargets(
    params.chatId,
    buildScenarioContent(params.scenarioText),
    'scenario',
    null,
  );
}

export interface HostUserCharacterAnnouncement {
  chatId: string;
  userCharacterName: string;
  userCharacterDescription?: string | null;
}

export async function postHostUserCharacterAnnouncement(
  params: HostUserCharacterAnnouncement,
): Promise<MessageEvent | null> {
  return postHostMessageWithTargets(
    params.chatId,
    buildUserCharacterContent(params.userCharacterName, params.userCharacterDescription),
    'user-character',
    null,
  );
}

export interface HostRosterAnnouncement {
  chatId: string;
  respondingCharacterName: string;
  others: OtherParticipantInfo[];
}

export async function postHostRosterAnnouncement(
  params: HostRosterAnnouncement,
): Promise<MessageEvent | null> {
  return postHostMessageWithTargets(
    params.chatId,
    buildMultiCharacterRosterContent(params.respondingCharacterName, params.others),
    'roster',
    null,
  );
}

export interface HostSilentModeAnnouncement {
  chatId: string;
  characterName: string;
  /** Participant ID of the character entering or exiting silent mode. */
  targetParticipantId: string;
  transition: 'enter' | 'exit';
}

export async function postHostSilentModeAnnouncement(
  params: HostSilentModeAnnouncement,
): Promise<MessageEvent | null> {
  const content = params.transition === 'enter'
    ? buildSilentModeEntryContent(params.characterName)
    : buildSilentModeExitContent(params.characterName);
  return postHostMessageWithTargets(
    params.chatId,
    content,
    `silent-mode:${params.transition}`,
    [params.targetParticipantId],
  );
}

export interface HostJoinScenarioAnnouncement {
  chatId: string;
  characterName: string;
  /** Participant ID of the joining character (whisper is private to them). */
  targetParticipantId: string;
  joinScenario: string;
}

export async function postHostJoinScenarioAnnouncement(
  params: HostJoinScenarioAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.joinScenario || params.joinScenario.trim().length === 0) return null;
  return postHostMessageWithTargets(
    params.chatId,
    buildJoinScenarioContent(params.characterName, params.joinScenario),
    'join-scenario',
    [params.targetParticipantId],
  );
}

// ---------------------------------------------------------------------------
// Phase G: timestamp whisper. Replaces the auto-prepend
// `Current time: …` block in the per-turn system prompt. The Host narrates
// the time as part of their scene-setting role.
// ---------------------------------------------------------------------------

export function buildTimestampContent(formatted: string): string {
  return `The Host marks the time as ${formatted}.`;
}

export interface HostTimestampAnnouncement {
  chatId: string;
  formatted: string;
}

export async function postHostTimestampAnnouncement(
  params: HostTimestampAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.formatted || params.formatted.trim().length === 0) return null;
  return postHostMessageWithTargets(
    params.chatId,
    buildTimestampContent(params.formatted),
    'timestamp',
    null,
  );
}
