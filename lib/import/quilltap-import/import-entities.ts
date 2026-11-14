/**
 * Conflict-strategy importers for the remaining user-data entities: tags,
 * roleplay templates, projects, chats (with messages), and memories. Memories
 * are remap-only — they always insert, rewriting their character/chat/project/
 * tag FKs through the id maps populated by the earlier import phases.
 *
 * @module import/quilltap-import/import-entities
 */

import { takeBundleCursors, restoreBundleCursors } from '@/lib/memory/extraction/cursor-bundle';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';
import type {
  Tag,
  ChatMetadata,
  Memory,
  RoleplayTemplate,
  MessageEvent,
  Project,
  Group,
} from '@/lib/schemas/types';
import { stripScenarioSeededSummary } from '@/lib/chat/scenario-seeded-summary';
import { withConciergeModeFromLegacy } from '@/lib/services/dangerous-content/chat-override';
import { type ImportOptions, type IdMappingState, type ImportCounts, countsFrom, noteWritten } from './types';
import { insertUnderPolicy, OutcomeTally } from '@/lib/backup/insert-policy';
import { remintChatMessageIds, remapImportedMessageId, type RemintedChatMessages } from './message-id-remap';
import { importResolver } from './reconcile';
import { remapEntity, type IdTarget } from '@/lib/backup/id-fields';

const CHARACTER_TARGETS = { side: 'import' as const, targets: new Set<IdTarget>(['character']) };

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

export async function importTags(
  userId: string,
  tags: Tag[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  for (const tag of tags) {
    const { id: _, userId: __, createdAt, updatedAt, ...tagData } = tag;
    noteWritten(idMaps, tally.add(await insertUnderPolicy<Tag>({
      kind: 'tag',
      label: tag.name,
      incomingId: tag.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.tags.findById(tag.id),
      create: ({ id, duplicate }) => repos.tags.create(
        duplicate
          ? {
              ...tagData,
              name: `${tagData.name} (imported)`,
              nameLower: `${tagData.nameLower || tagData.name.toLowerCase()} (imported)`,
            }
          : tagData,
        id ? { id } : undefined
      ),
      update: (existing) => repos.tags.update(existing.id, tagData),
      idMap: idMaps.tags,
      warnings,
    })));
  }
  return countsFrom(tally);
}

/**
 * Bring a pre-delimiters template's `annotationButtons` forward to the
 * delimiters shape, and drop the legacy `pluginName`. Mutates in place.
 */
function migrateLegacyTemplateFields(template: RoleplayTemplate): void {
  const templateAny = template as Record<string, unknown>;
  if (templateAny.annotationButtons && !template.delimiters?.length) {
    const oldButtons = templateAny.annotationButtons as Array<{ label?: string; abbrev?: string; prefix?: string; suffix?: string }>;
    const styleMap: Record<string, string> = {
      'Narration': 'qt-chat-narration', 'Nar': 'qt-chat-narration',
      'Internal Monologue': 'qt-chat-inner-monologue', 'Int': 'qt-chat-inner-monologue',
      'Out of Character': 'qt-chat-ooc', 'OOC': 'qt-chat-ooc',
    };
    template.delimiters = oldButtons.map(btn => {
      const prefix = btn.prefix || '';
      const suffix = btn.suffix || '';
      const name = btn.label || btn.abbrev || 'Unknown';
      const buttonName = btn.abbrev || btn.label || '?';
      const style = styleMap[btn.label || ''] || styleMap[btn.abbrev || ''] || 'qt-chat-narration';
      // A prefix with no suffix is a line-start marker (e.g. "// " OOC);
      // everything else is a wrap delimiter. Mirrors the kinds migration.
      if (prefix && !suffix) {
        return { kind: 'linePrefix' as const, name, buttonName, marker: prefix, style };
      }
      return {
        kind: 'wrap' as const,
        name,
        buttonName,
        delimiters: prefix === suffix ? prefix : ([prefix, suffix] as [string, string]),
        style,
      };
    });
    delete templateAny.annotationButtons;
  }
  delete templateAny.pluginName;
}

export async function importRoleplayTemplates(
  userId: string,
  templates: RoleplayTemplate[],
  options: ImportOptions,
  idMaps: IdMappingState,
  globalRepos: ReturnType<typeof getRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  for (const template of templates) {
    migrateLegacyTemplateFields(template);
    const { id: _, createdAt, updatedAt, isBuiltIn: _builtIn, ...templateData } = template;
    noteWritten(idMaps, tally.add(await insertUnderPolicy<RoleplayTemplate>({
      kind: 'roleplay template',
      label: template.name,
      incomingId: template.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => globalRepos.roleplayTemplates.findById(template.id),
      create: ({ id, duplicate }) => globalRepos.roleplayTemplates.create(
        {
          ...templateData,
          userId,
          // A bundle never brings a built-in; those come from code.
          isBuiltIn: false,
          ...(duplicate ? { name: `${templateData.name} (imported)` } : {}),
        },
        id ? { id } : undefined
      ),
      update: (existing) => globalRepos.roleplayTemplates.update(existing.id, { ...templateData, userId }),
      // Built-ins are read-only and come from code, never from a bundle.
      refuseOverwrite: (existing) => (existing.isBuiltIn ? 'it is a built-in template' : null),
      idMap: idMaps.roleplayTemplates,
      warnings,
    })));
  }
  return countsFrom(tally);
}

export async function importProjects(
  userId: string,
  projects: Project[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  for (const project of projects) {
    // userId no longer exists on Project (projects are global). createdAt /
    // updatedAt / officialMountPointId are excluded so create() generates
    // fresh values and provisions a new store — and an overwrite keeps the
    // store the project already has.
    const { id: _, createdAt, updatedAt, officialMountPointId: ___, ...projectData } = project;
    noteWritten(idMaps, tally.add(await insertUnderPolicy<Project>({
      kind: 'project',
      label: project.name,
      incomingId: project.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.projects.findById(project.id),
      create: ({ id, duplicate }) => repos.projects.create(
        duplicate ? { ...projectData, name: `${projectData.name} (imported)` } : projectData,
        id ? { id } : undefined
      ),
      update: (existing) => repos.projects.update(existing.id, projectData),
      idMap: idMaps.projects,
      warnings,
    })));
  }
  return countsFrom(tally);
}

export async function importGroups(
  userId: string,
  groups: Group[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  for (const group of groups) {
    // createdAt / updatedAt / officialMountPointId are excluded so create()
    // generates fresh values and provisions a new store; an overwrite keeps
    // the group's own store. The export's membership / link sidecar fields
    // are applied later, by the orchestrator.
    const {
      id: _,
      createdAt,
      updatedAt,
      officialMountPointId: ___,
      _memberCharacterIds: _members,
      _linkedStoreMountPointIds: _links,
      ...groupData
    } = group as Group & { _memberCharacterIds?: string[]; _linkedStoreMountPointIds?: string[] };
    noteWritten(idMaps, tally.add(await insertUnderPolicy<Group>({
      kind: 'group',
      label: group.name,
      incomingId: group.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.groups.findById(group.id),
      create: ({ id, duplicate }) => repos.groups.create(
        duplicate ? { ...groupData, name: `${groupData.name} (imported)` } : groupData,
        id ? { id } : undefined
      ),
      update: (existing) => repos.groups.update(existing.id, groupData),
      idMap: idMaps.groups,
      warnings,
    })));
  }
  return countsFrom(tally);
}

/**
 * Insert a chat's bundle messages, under the reminted ids when `reminted` is
 * given, or under their source ids otherwise. For a reminted chat each
 * source → new pair is recorded in `idMaps.messages` only once its insert
 * succeeds, so a sidecar can never be pointed at a message that is not here.
 * Returns the count inserted.
 */
async function addImportedMessages(
  newChatId: string,
  chat: ChatMetadata & { messages: MessageEvent[] },
  reminted: RemintedChatMessages | null,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<number> {
  // Character ids inside message payloads (a Carina answerer, a Host
  // introduction, a custom announcer) follow their characters through the
  // id-field table; one the bundle did not carry keeps its id.
  const resolveCharacters = importResolver(idMaps);
  const toInsert = (reminted ? reminted.messages : chat.messages).map(
    (message) => remapEntity('message', message, resolveCharacters, CHARACTER_TARGETS).row as MessageEvent
  );
  const landed = reminted ? new Map<string, string>() : null;
  if (landed) idMaps.messages.set(chat.id, landed);
  moduleLogger.debug('Importing chat messages', {
    sourceChatId: chat.id,
    newChatId,
    messageCount: toInsert.length,
    remintedMessageIds: Boolean(reminted),
    droppedMessageRefs: reminted?.droppedRefs ?? 0,
  });

  let added = 0;
  for (const [index, message] of toInsert.entries()) {
    try {
      await repos.chats.addMessage(newChatId, message);
      added++;
      const sourceId = chat.messages[index]?.id;
      if (landed && sourceId && !landed.has(sourceId)) landed.set(sourceId, message.id);
    } catch (msgError) {
      warnings.push(
        `Failed to import message in chat "${chat.title}": ${
          msgError instanceof Error ? msgError.message : String(msgError)
        }`
      );
      moduleLogger.warn('Failed to import chat message', {
        newChatId,
        messageId: message.id,
        error: msgError instanceof Error ? msgError.message : String(msgError),
      });
    }
  }
  return added;
}

export async function importChats(
  userId: string,
  chats: (ChatMetadata & { messages: MessageEvent[] })[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  let messages = 0;

  for (const chat of chats) {
    const { id: _, userId: __, messages: _msgs, createdAt, updatedAt, ...chatData } = chat;

    const outcome = await insertUnderPolicy<ChatMetadata>({
      kind: 'chat',
      label: chat.title,
      incomingId: chat.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.chats.findById(chat.id),
      // An overwrite replaces the transcript, so the chat is removed (its
      // messages, annotations, informs and timelines with it) and created
      // again under its own id. Document Mode pane state has no cascade.
      remove: async (existing) => {
        await repos.chats.delete(existing.id, { syncVaults: false });
        await getRepositories().chatDocuments.deleteByChatId(existing.id);
      },
      create: async ({ id, duplicate }) => {
        // Only a chat created under its source id keeps its message ids. Any
        // other gets fresh message ids too: `chat_messages.id` is global, so
        // the duplicate's original — or an earlier import of the same bundle —
        // already holds them (bug 228).
        const keepsSourceIds = id === chat.id;
        const reminted = keepsSourceIds ? null : remintChatMessageIds(chatData, chat.messages);
        // A pre-bug-158 export carries the chat's scenario in `contextSummary` as
        // well as `scenarioText`; the migration that cleared those rows has long
        // since run in this instance, so the import is the only thing standing
        // between a stale bundle and the bug coming back.
        // …and a pre-phase-3 bundle carries only the legacy Concierge pair, so
        // the chat's three-state posture is derived from it here.
        // The fold passes' cursors travel on the chat under their legacy names
        // (already remapped to the new message ids); they are written once the
        // chat exists.
        const { chat: bundledChat, cursors } = takeBundleCursors(
          reminted ? { ...chatData, ...reminted.chatPatch } : chatData
        );
        const cleaned = withConciergeModeFromLegacy(stripScenarioSeededSummary(bundledChat));
        const newChat = await repos.chats.create(
          duplicate ? { ...cleaned, title: `${chatData.title} (imported)` } : cleaned,
          id ? { id } : undefined
        );
        await restoreBundleCursors(newChat.id, cursors);
        messages += await addImportedMessages(newChat.id, chat, reminted, idMaps, repos, warnings);
        return newChat;
      },
      idMap: idMaps.chats,
      warnings,
    });
    tally.add(outcome);
    noteWritten(idMaps, outcome);
    if (outcome.status === 'created' || outcome.status === 'updated') {
      idMaps.writtenChats.add(chat.id);
    }
  }

  return { ...countsFrom(tally), messages };
}

/**
 * Insert imported memories, remapping every FK through the id maps.
 *
 * Deliberately uses the raw repository rather than admission (`admitCandidate`):
 * admission can silently absorb near-duplicates, reinforce an existing row
 * instead of inserting, or lose rows entirely when the embedding provider is
 * down — none of which is acceptable for an import, where the user asked for
 * exactly these rows.
 *
 * Returns the created memory IDs (alongside the counts) so the orchestrator
 * can enqueue targeted re-embedding — imported memories arrive with a NULL
 * embedding by design (see below).
 */
export async function importMemories(
  userId: string,
  memories: Memory[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts & { createdIds: Array<{ id: string; characterId: string }> }> {
  let imported = 0;
  let skipped = 0;
  const createdIds: Array<{ id: string; characterId: string }> = [];

  // Memory ids are minted up front so digest <-> cold-member references
  // (`supersededById`, `consolidatedFrom`) can follow their targets even when
  // the target appears later in the bundle. With `preserveIds` the source id
  // is kept, so the map is the identity.
  const memoryIdMap = new Map<string, string>();
  for (const memory of memories) {
    memoryIdMap.set(memory.id, options.preserveIds ? memory.id : randomUUID());
  }
  const remapMemoryRef = (ref: string): string => memoryIdMap.get(ref) ?? ref;

  // Characters the bundle does not carry resolve to the instance's own row of
  // that id when one exists and is not an archived tombstone (bug 240).
  const localCharacters = new Map<string, string | null>();
  const resolveMemoryCharacter = async (id: string): Promise<string | null> => {
    const mapped = idMaps.characters.get(id);
    if (mapped) return mapped;
    if (!localCharacters.has(id)) {
      // Raw read: a character whose vault is unreadable still owns its memories.
      const local = await getRepositories().characters.findByIdRaw(id);
      const usable = local && !local.archivedAt ? local.id : null;
      if (local && !usable) {
        moduleLogger.debug('Memory names an archived local character; not reviving it', { characterId: id });
      }
      localCharacters.set(id, usable);
    }
    return localCharacters.get(id) ?? null;
  };

  for (const memory of memories) {
    try {
      // Skip-if-present rehydrate (spec §6/F4): the memory is already back —
      // a partial restore being re-run. The surviving row wins.
      if (options.preserveIds && idMaps.preserveIdsSkips.has(memory.id)) {
        skipped++;
        continue;
      }

      // Remap character ID: a character in the bundle, else one this instance
      // already holds (a chats-only export carries its memories but not its
      // cast — bug 240).
      const newCharacterId = await resolveMemoryCharacter(memory.characterId);
      if (!newCharacterId) {
        warnings.push(
          `Memory references non-existent character ${memory.characterId}`
        );
        skipped++;
        continue;
      }

      // Remap aboutCharacterId if present (Characters Not Personas: who the memory is about)
      let newAboutCharacterId = memory.aboutCharacterId;
      if (memory.aboutCharacterId) {
        // Try to map as a character first
        newAboutCharacterId = (await resolveMemoryCharacter(memory.aboutCharacterId)) || null;
      }

      // Remap chat ID if present
      let newChatId = memory.chatId;
      if (memory.chatId) {
        newChatId = idMaps.chats.get(memory.chatId) || null;
      }

      // Remap project ID if present
      let newProjectId = memory.projectId;
      if (memory.projectId) {
        newProjectId = idMaps.projects.get(memory.projectId) || null;
      }

      // Remap tags if present
      let newTags = memory.tags;
      if (memory.tags && memory.tags.length > 0) {
        newTags = memory.tags
          .map((tagId) => idMaps.tags.get(tagId) || tagId)
          .filter((id) => id !== null) as string[];
      }

      // `embedding` is excluded on purpose. A vector is only meaningful
      // against the model that produced it, so a foreign one silently
      // corrupts semantic search whenever the dimensionality happens to
      // match — and the boot repair in lib/startup/repair-text-embeddings.ts
      // would *preserve* a bad vector by converting it to a valid blob rather
      // than discarding it. Import time is the only correct place to drop it.
      // The orchestrator enqueues an EMBEDDING_GENERATE per created row.
      const { id: _, createdAt, updatedAt, embedding: _embedding, ...memoryData } = memory;
      const newMemoryId = memoryIdMap.get(memory.id) ?? memory.id;
      const createData = options.preserveIds ? { ...memoryData, id: memory.id } : memoryData;
      // Always create under the pre-minted id so consolidation references line up.
      const createOptions = { id: newMemoryId };
      // Consolidation fields: bundles from before tiers lack them and read as
      // hot / null / []; a CONSOLIDATED digest and its cold members keep their
      // links, remapped through the same id map.
      const payload = {
        ...createData,
        relatedMemoryIds: (memory.relatedMemoryIds ?? []).map(remapMemoryRef),
        tier: memory.tier ?? 'hot',
        supersededById: memory.supersededById ? remapMemoryRef(memory.supersededById) : null,
        // The cold-retention clock travels with the link (bug 225).
        supersededAt: memory.supersededById ? (memory.supersededAt ?? null) : null,
        consolidatedFrom: (memory.consolidatedFrom ?? []).map(remapMemoryRef),
        consolidatedAt: memory.consolidatedAt ?? null,
        // A standing fact stays one; older bundles read as false.
        keystone: memory.keystone ?? false,
        characterId: newCharacterId,
        aboutCharacterId: newAboutCharacterId,
        chatId: newChatId,
        projectId: newProjectId,
        tags: newTags,
        // Follows its message when the chat import reminted message ids.
        sourceMessageId: memory.sourceMessageId
          ? remapImportedMessageId(idMaps, memory.chatId, memory.sourceMessageId)
          : memory.sourceMessageId,
      };
      const created = await repos.memories.create(payload, createOptions);
      createdIds.push({ id: created.id, characterId: newCharacterId });
      moduleLogger.debug('Imported memory', { memoryId: created.id, tier: payload.tier, source: memory.source });
      imported++;
    } catch (error) {
      warnings.push(
        `Failed to import memory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      moduleLogger.warn('Failed to import memory', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      });
      skipped++;
    }
  }

  return { imported, skipped, createdIds };
}
