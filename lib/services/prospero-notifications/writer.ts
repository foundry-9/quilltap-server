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
import { getErrorMessage } from '@/lib/error-utils';
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
      systemKind: kindLabel,
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
  return postProsperoMessage(params.chatId, content, 'connection-profile-change');
}

// ---------------------------------------------------------------------------
// Phase E: Project context whispers. Replaces the per-turn `## Project
// Context` system-prompt block. Fired at chat-start and at the configured
// cadence (default every 5 messages — see
// `chatSettings.contextCompressionSettings.projectContextReinjectInterval`).
// ---------------------------------------------------------------------------

export interface ProsperoDocumentStoreInfo {
  /** Mount-point UUID — usable as the `mount_point` argument to any `doc_*` tool. */
  id: string;
  /** Display name — also accepted as the `mount_point` argument. */
  name: string;
  /** Backing storage kind. */
  mountType: 'filesystem' | 'obsidian' | 'database';
  /** Content classification. 'character' marks character-vault stores. */
  storeType: 'documents' | 'character';
  /** True when this is the project's canonical "project-official" store (addressable via `scope: "project"`). */
  isOfficial: boolean;
  /** When false, the store is disabled and tools will reject calls against it. */
  enabled: boolean;
}

export interface ProsperoProjectContext {
  name: string;
  description?: string | null;
  instructions?: string | null;
  /** Document stores linked to the project (official store first, then alphabetical). */
  documentStores?: ProsperoDocumentStoreInfo[];
}

/**
 * Fetch the project plus its linked document stores into a single context
 * object suitable for `postProsperoProjectContextAnnouncement`. Returns null
 * when the project does not exist; returns an empty `documentStores` array
 * when nothing is linked or the mount index lookup fails.
 */
export async function loadProsperoProjectContext(
  projectId: string,
): Promise<ProsperoProjectContext | null> {
  const repos = getRepositories();
  const project = await repos.projects.findById(projectId);
  if (!project) return null;

  const documentStores = await loadLinkedDocumentStores(
    projectId,
    project.officialMountPointId ?? null,
  );

  return {
    name: project.name,
    description: project.description,
    instructions: project.instructions,
    documentStores,
  };
}

async function loadLinkedDocumentStores(
  projectId: string,
  officialMountPointId: string | null,
): Promise<ProsperoDocumentStoreInfo[]> {
  const repos = getRepositories();
  try {
    const links = await repos.projectDocMountLinks.findByProjectId(projectId);
    if (!links.length) return [];

    const stores: ProsperoDocumentStoreInfo[] = [];
    for (const link of links) {
      const mp = await repos.docMountPoints.findById(link.mountPointId);
      if (!mp) continue;
      stores.push({
        id: mp.id,
        name: mp.name,
        mountType: mp.mountType,
        storeType: mp.storeType ?? 'documents',
        isOfficial: officialMountPointId !== null && officialMountPointId === mp.id,
        enabled: mp.enabled,
      });
    }

    stores.sort((a, b) => {
      if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return stores;
  } catch (error) {
    logger.warn('[ProsperoNotification] Failed to load linked document stores', {
      context: 'prospero-notifications',
      projectId,
      error: getErrorMessage(error),
    });
    return [];
  }
}

function buildDocumentStoresSection(stores: ProsperoDocumentStoreInfo[]): string[] {
  if (!stores.length) return [];

  const lines: string[] = ['**Document stores linked to this project:**', ''];
  for (const store of stores) {
    const tags: string[] = [];
    if (store.isOfficial) tags.push('official project store');
    tags.push(`${store.mountType}-backed`);
    if (store.storeType === 'character') tags.push('character vault');
    if (!store.enabled) tags.push('currently disabled');
    const tagSuffix = ` *(${tags.join('; ')})*`;

    const safeName = store.name.replace(/`/g, '\\`');
    const namedRef = `use \`mount_point: "${safeName}"\` (ID \`${store.id}\` also works)`;
    const refHint = store.isOfficial
      ? `pass \`scope: "project"\` to address it directly, or ${namedRef}`
      : namedRef.charAt(0).toUpperCase() + namedRef.slice(1);

    lines.push(`- **${store.name}**${tagSuffix} — ${refHint}.`);
  }
  lines.push('');
  lines.push(
    'Pass any of those names (or IDs) as the `mount_point` argument on `doc_*` tools, ' +
      'or as `source_mount_point` / `dest_mount_point` on `doc_copy_file`. The `path` ' +
      'argument is the file\'s relative path within the chosen store.',
  );
  return lines;
}

export function buildProjectContextContent(project: ProsperoProjectContext): string {
  const lines: string[] = [
    `Prospero opens his ledger to the project at hand — *${project.name}* — and lays its particulars before you:`,
    '',
  ];
  const description = project.description?.trim();
  const instructions = project.instructions?.trim();
  const stores = project.documentStores ?? [];

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

  if (stores.length) {
    if (description || instructions) lines.push('');
    lines.push(...buildDocumentStoresSection(stores));
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
  const storeCount = params.project.documentStores?.length ?? 0;
  if (!description && !instructions && storeCount === 0) {
    return null;
  }

  const content = buildProjectContextContent(params.project);
  return postProsperoMessage(params.chatId, content, 'project-context');
}
