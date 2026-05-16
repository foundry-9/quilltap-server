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
import { getErrorMessage } from '@/lib/error-utils';
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

/**
 * Persona-free variant of {@link buildAddContent} for opaque-anywhere chats.
 * Mirrors the same identity/description payload but drops the Host narration.
 */
export async function buildAddOpaqueContent(character: Character): Promise<string> {
  const lines: string[] = [];
  lines.push(`${character.name} has joined the scene.`);
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

export function buildRemoveOpaqueContent(characterName: string): string {
  return `${characterName} has left the scene.`;
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

export function buildStatusChangeOpaqueContent(
  characterName: string,
  oldStatus: ParticipantStatus,
  newStatus: ParticipantStatus,
): string {
  const before = STATUS_PHRASE[oldStatus] ?? oldStatus;
  const after = STATUS_PHRASE[newStatus] ?? newStatus;
  return `${characterName} is now ${after} (previously ${before}).`;
}

async function postHostMessage(
  chatId: string,
  content: string,
  opaqueContent: string | null,
  kindLabel: string,
  hostEvent: { participantId: string; toStatus: ParticipantStatus } | null = null,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'host',
      // Strip transition detail from status-change kindLabel so the persisted column
      // carries a stable bucket label ("status-change") rather than "status:active->silent".
      systemKind: kindLabel.startsWith('status:') ? 'status-change' : kindLabel,
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
  const [content, opaqueContent] = await Promise.all([
    buildAddContent(params.character),
    buildAddOpaqueContent(params.character),
  ]);
  const toStatus: ParticipantStatus = params.initialStatus ?? 'active';
  return postHostMessage(params.chatId, content, opaqueContent, 'add', {
    participantId: params.participantId,
    toStatus,
  });
}

export async function postHostRemoveAnnouncement(
  params: HostRemoveAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildRemoveContent(params.characterName);
  const opaqueContent = buildRemoveOpaqueContent(params.characterName);
  return postHostMessage(params.chatId, content, opaqueContent, 'remove', {
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
  const opaqueContent = buildStatusChangeOpaqueContent(
    params.characterName,
    params.oldStatus,
    params.newStatus,
  );
  return postHostMessage(params.chatId, content, opaqueContent, `status:${params.oldStatus}->${params.newStatus}`, {
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

export function buildScenarioOpaqueContent(scenarioText: string): string {
  return [
    'Scene:',
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

export function buildUserCharacterOpaqueContent(
  userCharacterName: string,
  userCharacterDescription: string | null | undefined,
): string {
  const desc = (userCharacterDescription ?? '').trim();
  if (desc.length === 0) {
    return `${userCharacterName} is the user's voice in this conversation.`;
  }
  return [
    `${userCharacterName} is the user's voice in this conversation:`,
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

export function buildMultiCharacterRosterOpaqueContent(
  respondingCharacterName: string,
  others: OtherParticipantInfo[],
): string {
  const section = buildMultiCharacterContextSection(others, respondingCharacterName);
  if (!section) {
    return `For the moment, ${respondingCharacterName} stands alone in the scene.`;
  }
  return [
    'The company present in the scene:',
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

export function buildSilentModeEntryOpaqueContent(_characterName: string): string {
  return [
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
    'This rule remains in force until you are notified that you are no longer silent.',
  ].join('\n');
}

export function buildSilentModeExitContent(characterName: string): string {
  return `The Host whispers a private note to ${characterName} alone: silence is lifted. You may speak aloud again.`;
}

export function buildSilentModeExitOpaqueContent(_characterName: string): string {
  return `Silence is lifted. You may speak aloud again.`;
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

export function buildJoinScenarioOpaqueContent(
  _characterName: string,
  joinScenario: string,
): string {
  return [
    'How you came to be here:',
    '',
    joinScenario.trim(),
  ].join('\n');
}

async function postHostMessageWithTargets(
  chatId: string,
  content: string,
  opaqueContent: string | null,
  kindLabel: string,
  targetParticipantIds: string[] | null,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'host',
      // Normalise silent-mode kindLabels ("silent-mode:enter"/"silent-mode:exit")
      // to the column-friendly form used by the Salon collapsed-bar UI.
      systemKind: kindLabel.startsWith('silent-mode:')
        ? `silent-mode-${kindLabel.split(':')[1]}`
        : kindLabel,
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
    buildScenarioOpaqueContent(params.scenarioText),
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
    buildUserCharacterOpaqueContent(params.userCharacterName, params.userCharacterDescription),
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
    buildMultiCharacterRosterOpaqueContent(params.respondingCharacterName, params.others),
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
  const opaqueContent = params.transition === 'enter'
    ? buildSilentModeEntryOpaqueContent(params.characterName)
    : buildSilentModeExitOpaqueContent(params.characterName);
  return postHostMessageWithTargets(
    params.chatId,
    content,
    opaqueContent,
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
    buildJoinScenarioOpaqueContent(params.characterName, params.joinScenario),
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

export function buildTimestampOpaqueContent(formatted: string): string {
  return `Current time: ${formatted}.`;
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
    buildTimestampOpaqueContent(params.formatted),
    'timestamp',
    null,
  );
}

// ---------------------------------------------------------------------------
// Off-scene character introductions.
//
// When a workspace character — one who exists in the user's vault but is not
// a participant in this Salon — gets named in the conversation, the Host
// introduces them once. The introduction lands in the chat transcript as a
// public Host message (visible to the user and surfaced to every character's
// LLM context via normal history), so subsequent turns recall the character's
// particulars without re-injecting them into the system prompt every turn.
//
// Idempotent per character ID: repeated calls for the same character are no-
// ops. Callers compute the delta — characters named in this turn that have
// never been introduced — and pass only that delta in.
// ---------------------------------------------------------------------------

const HOST_KIND_OFF_SCENE_CHARACTERS = 'off-scene-characters';

interface OffSceneCharacterCard {
  id: string;
  name: string;
  aliases?: string[];
  pronouns?: { subject: string; object: string; possessive: string } | null;
  description?: string | null;
}

/**
 * Compose a Host announcement introducing one or more off-scene characters.
 * Sorted alphabetically for deterministic, cache-friendly output.
 */
function renderOffSceneCard(c: OffSceneCharacterCard): string {
  const lines: string[] = [`### ${c.name}`];
  if (c.aliases && c.aliases.length > 0) {
    lines.push(`Aliases: ${c.aliases.join(', ')}`);
  }
  if (c.pronouns) {
    lines.push(`Pronouns: ${c.pronouns.subject}/${c.pronouns.object}/${c.pronouns.possessive}`);
  }
  const desc = (c.description ?? '').trim();
  if (desc.length > 0) {
    lines.push(desc);
  }
  return lines.join('\n');
}

export function buildOffSceneCharactersContent(
  characters: OffSceneCharacterCard[],
): string {
  const sorted = [...characters].sort((a, b) => a.name.localeCompare(b.name));

  const intro =
    sorted.length === 1
      ? `The Host begs leave to introduce a person spoken of in this conversation but not presently in the Salon — for accurate reference only; not a summons to the scene.`
      : `The Host begs leave to introduce certain persons spoken of in this conversation but not presently in the Salon — for accurate reference only; not a summons to the scene.`;

  return [intro, '', ...sorted.map(renderOffSceneCard)].join('\n\n');
}

export function buildOffSceneCharactersOpaqueContent(
  characters: OffSceneCharacterCard[],
): string {
  const sorted = [...characters].sort((a, b) => a.name.localeCompare(b.name));

  const intro =
    sorted.length === 1
      ? `A person spoken of in this conversation but not presently in the scene — for accurate reference only; not a summons to the scene:`
      : `Persons spoken of in this conversation but not presently in the scene — for accurate reference only; not a summons to the scene:`;

  return [intro, '', ...sorted.map(renderOffSceneCard)].join('\n\n');
}

/**
 * Scan a chat's existing messages for prior Host off-scene-character
 * introductions and return the set of character IDs that have already been
 * introduced. Callers diff this against the freshly-detected mention set to
 * compute the announcement delta.
 *
 * The scan looks at message metadata — specifically `systemSender === 'host'`
 * with `systemKind === 'off-scene-characters'` — and reads the character IDs
 * from the message's `hostEvent.introducedCharacterIds` field, which the
 * announcement writer stamps at post time.
 */
export function findIntroducedOffSceneCharacterIds(
  messages: ReadonlyArray<unknown>,
): Set<string> {
  const introduced = new Set<string>();
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as {
      type?: unknown;
      systemSender?: unknown;
      systemKind?: unknown;
      hostEvent?: unknown;
    };
    if (
      msg.type === 'message' &&
      msg.systemSender === 'host' &&
      msg.systemKind === HOST_KIND_OFF_SCENE_CHARACTERS &&
      msg.hostEvent &&
      typeof msg.hostEvent === 'object'
    ) {
      const ids = (msg.hostEvent as { introducedCharacterIds?: unknown }).introducedCharacterIds;
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === 'string') introduced.add(id);
        }
      }
    }
  }
  return introduced;
}

export interface HostOffSceneCharactersAnnouncement {
  chatId: string;
  characters: OffSceneCharacterCard[];
}

/**
 * Post a public Host announcement introducing the given off-scene characters.
 * The character IDs are stamped into `hostEvent.introducedCharacterIds` so
 * subsequent calls can detect already-introduced characters and skip them.
 *
 * Returns the persisted MessageEvent (so the caller can also surface it to
 * this turn's LLM context without a one-turn lag), or null on failure / when
 * the input is empty.
 */
export async function postHostOffSceneCharactersAnnouncement(
  params: HostOffSceneCharactersAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.characters || params.characters.length === 0) return null;

  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(params.chatId);
    if (!chat) {
      return null;
    }

    const content = buildOffSceneCharactersContent(params.characters);
    const opaqueContent = buildOffSceneCharactersOpaqueContent(params.characters);
    const messageId = randomUUID();
    const now = new Date().toISOString();
    const introducedCharacterIds = params.characters.map((c) => c.id);

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      opaqueContent,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'host',
      systemKind: HOST_KIND_OFF_SCENE_CHARACTERS,
      hostEvent: { introducedCharacterIds },
    };

    await repos.chats.addMessage(params.chatId, message);

    logger.info('[HostNotification] Off-scene introduction posted', {
      context: 'host-notifications',
      chatId: params.chatId,
      messageId,
      introducedCharacterIds,
      characterCount: params.characters.length,
    });

    return message;
  } catch (error) {
    logger.warn('[HostNotification] Off-scene introduction skipped (non-fatal)', {
      context: 'host-notifications',
      chatId: params.chatId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Continuation announcements.
//
// When a Salon conversation is forked into a new chat (a "change of venue"),
// the Host posts a public bubble in each chat that links to its counterpart.
// The new chat's first user-visible message points back to the source chat,
// so the conversation feels continuous; the source chat's tail bubble points
// forward, so a returning visitor can follow the proceedings to wherever
// they have moved. Both are public — no targetParticipantIds.
// ---------------------------------------------------------------------------

const HOST_KIND_CONTINUATION_FROM = 'continuation-from';
const HOST_KIND_CONTINUATION_TO = 'continuation-to';

function buildContinuationFromContent(sourceChatId: string, sourceTitle: string | null): string {
  const trimmedTitle = sourceTitle?.trim() ?? '';
  const linkText = trimmedTitle.length > 0 ? `"${trimmedTitle}"` : 'an earlier chapter';
  return [
    `The Host raises a hand for attention: this conversation continues from [${linkText}](/salon/${sourceChatId}).`,
    '',
    'The thread that brought us here is preserved below. Carry on.',
  ].join('\n');
}

function buildContinuationFromOpaqueContent(sourceChatId: string, sourceTitle: string | null): string {
  const trimmedTitle = sourceTitle?.trim() ?? '';
  const linkText = trimmedTitle.length > 0 ? `"${trimmedTitle}"` : 'an earlier chapter';
  return [
    `This conversation continues from [${linkText}](/salon/${sourceChatId}).`,
    '',
    'The thread that brought us here is preserved below. Carry on.',
  ].join('\n');
}

function buildContinuationToContent(newChatId: string, newTitle: string | null): string {
  const trimmedTitle = newTitle?.trim() ?? '';
  const linkText = trimmedTitle.length > 0 ? `"${trimmedTitle}"` : 'a new venue';
  return `The Host clears their throat: the conversation has moved to [${linkText}](/salon/${newChatId}). The proceedings continue there.`;
}

function buildContinuationToOpaqueContent(newChatId: string, newTitle: string | null): string {
  const trimmedTitle = newTitle?.trim() ?? '';
  const linkText = trimmedTitle.length > 0 ? `"${trimmedTitle}"` : 'a new venue';
  return `The conversation has moved to [${linkText}](/salon/${newChatId}). The proceedings continue there.`;
}

export interface HostContinuationFromAnnouncement {
  chatId: string;
  sourceChatId: string;
  sourceTitle?: string | null;
}

export async function postHostContinuationFromAnnouncement(
  params: HostContinuationFromAnnouncement,
): Promise<MessageEvent | null> {
  return postHostMessageWithTargets(
    params.chatId,
    buildContinuationFromContent(params.sourceChatId, params.sourceTitle ?? null),
    buildContinuationFromOpaqueContent(params.sourceChatId, params.sourceTitle ?? null),
    HOST_KIND_CONTINUATION_FROM,
    null,
  );
}

export interface HostContinuationToAnnouncement {
  chatId: string;
  newChatId: string;
  newTitle?: string | null;
}

export async function postHostContinuationToAnnouncement(
  params: HostContinuationToAnnouncement,
): Promise<MessageEvent | null> {
  return postHostMessageWithTargets(
    params.chatId,
    buildContinuationToContent(params.newChatId, params.newTitle ?? null),
    buildContinuationToOpaqueContent(params.newChatId, params.newTitle ?? null),
    HOST_KIND_CONTINUATION_TO,
    null,
  );
}

// ---------------------------------------------------------------------------
// "No user character attached" advisory whisper.
//
// The auto-memory pipeline emits this whisper the first time it encounters a
// chat with no resolvable user-controlled character. It is idempotent — once
// posted, subsequent calls in the same chat are no-ops — so it appears at most
// once per chat regardless of how many turns proceed in that state.
// ---------------------------------------------------------------------------

const HOST_KIND_NO_USER_CHARACTER = 'no-user-character';

function buildNoUserCharacterContent(): string {
  return [
    'The Host clears their throat with the gentlest of coughs.',
    '',
    'No user-controlled character has been attached to this conversation, so the Commonplace Book cannot record what your characters come to know about *you* — only what they come to know about themselves.',
    '',
    'To begin gathering memories about the user, attach (or create) a user-controlled character via the Participants sidebar.',
  ].join('\n');
}

export interface HostNoUserCharacterAnnouncement {
  chatId: string;
}

/**
 * Post the "no user-character attached" whisper, but only if no such whisper
 * has already been posted to this chat. Designed to be called from the auto-
 * memory pipeline, which fires once per turn — without this idempotence guard
 * the chat would fill up with duplicates.
 */
export async function postHostNoUserCharacterAnnouncement(
  params: HostNoUserCharacterAnnouncement,
): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();
    const chat = await repos.chats.findById(params.chatId);
    if (!chat) return null;

    const messages = (chat as { messages?: unknown[] }).messages ?? [];
    const alreadyPosted = messages.some((m) => {
      if (!m || typeof m !== 'object') return false;
      const msg = m as { type?: unknown; systemSender?: unknown; systemKind?: unknown };
      return (
        msg.type === 'message' &&
        msg.systemSender === 'host' &&
        msg.systemKind === HOST_KIND_NO_USER_CHARACTER
      );
    });
    if (alreadyPosted) return null;

    return postHostMessageWithTargets(
      params.chatId,
      buildNoUserCharacterContent(),
      // No opaque variant: this whisper is for the operator only, never reaches a character's LLM context.
      null,
      HOST_KIND_NO_USER_CHARACTER,
      null,
    );
  } catch (error) {
    logger.warn('[HostNotification] No-user-character whisper skipped (non-fatal)', {
      context: 'host-notifications',
      chatId: params.chatId,
      error: getErrorMessage(error),
    });
    return null;
  }
}
