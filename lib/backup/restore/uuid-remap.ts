/**
 * New-account remapping: rewrite every UUID in the parsed backup to a fresh
 * value (and reassign ownership to the target user) so the data can be imported
 * alongside an existing account without id collisions. Cross-references are
 * remapped consistently via the shared {@link UuidRemapper} so the graph stays
 * internally connected.
 *
 * @module backup/restore/uuid-remap
 */

import { UuidRemapper } from '../uuid-remapper';
import { remapScenarioSource } from '@/lib/scenarios/source-remap';
import { remapCharacterKeyedChatFields } from '@/lib/chat/character-keyed-fields';
import { logger } from '@/lib/logger';
import { remapEntity, type IdEntity, type IdResolver } from '../id-fields';
import { isBuiltInRoleplayTemplateId } from '@/lib/roleplay-templates/built-in-ids';
import {
  getConciergeState,
  withConciergeModeFromLegacy,
} from '@/lib/services/dangerous-content/chat-override';
import {
  withConciergeSettingsFromLegacy,
  type SettingsWithLegacyConcierge,
} from '@/lib/services/dangerous-content/legacy-concierge-settings';
import type {
  BackupData,
  ChatWithMessages,
  SerializedVectorEntry,
  SerializedConversationChunk,
  SerializedMemory,
  SerializedDocMountChunk,
} from '../types';
import type {
  Character,
  ChatSettings,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  FileEntry,
  Folder,
  ChatParticipantBase,
  PhysicalDescription,
  PromptTemplate,
  RoleplayTemplate,
  Project,
  Group,
  LLMLog,
  PluginConfig,
  CharacterPluginData,
  ConversationAnnotation,
  TfidfVocabulary,
  EmbeddingStatus,
} from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import type { ChatInform } from '@/lib/schemas/chat-inform.types';
import type { WardrobeWearStatsRow } from '@/lib/schemas/wardrobe-wear.types';
import type { ChatWardrobeHistoryRow } from '@/lib/schemas/chat-wardrobe-history.types';
import type { ChatAvatarTimelineRow } from '@/lib/schemas/chat-avatar-timeline.types';
import type { LogEntry } from '@/lib/schemas/log-entry.types';
import { bySlot } from '@/lib/schemas/wardrobe.types';
import { hashEquippedSlots } from '@/lib/wardrobe/outfit-hash';
import { isWardrobeItemDocumentPath, wardrobeItemIdForDocument } from '@/lib/wardrobe/vault-parsers';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { isInventoryItemDocumentPath } from '@/lib/inventory/folders';
import { isAtlasEntryDocumentPath } from '@/lib/atlas/folders';
import type {
  DocMountPoint,
  DocMountFolder,
  DocMountFile,
  DocMountFileLink,
  DocMountDocument,
  DocMountBlobMetadata,
  ProjectDocMountLink,
  GroupDocMountLink,
  GroupCharacterMember,
} from '@/lib/schemas/mount-index.types';

const moduleLogger = logger.child({ module: 'backup:uuid-remap' });

/**
 * Settings keys whose values are mount-point UUIDs. These need remapping in
 * new-account mode so they keep pointing at the right mount points.
 */
const MOUNT_POINT_SETTING_KEYS = new Set([
  'lanternBackgroundsMountPointId',
  'userUploadsMountPointId',
  'generalMountPointId',
]);

/**
 * The Brahma Console instance setting is a JSON blob; its
 * `inlineConnectionProfileId` names a connection profile, which is remapped
 * like every other profile reference. Unparseable values pass through.
 */
const BRAHMA_CONSOLE_SETTING_KEY = 'brahmaConsole';

function remapBrahmaConsoleSetting(value: string, remapper: UuidRemapper): string {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed && typeof parsed.inlineConnectionProfileId === 'string') {
      // A profile the backup does not carry is cleared rather than minted.
      const remapped = remapper.lookup(parsed.inlineConnectionProfileId) ?? null;
      moduleLogger.debug('Remapped inline Brahma connection profile in instance settings', {
        from: parsed.inlineConnectionProfileId,
        to: remapped,
      });
      return JSON.stringify({ ...parsed, inlineConnectionProfileId: remapped });
    }
  } catch (error) {
    moduleLogger.warn('brahmaConsole instance setting is not valid JSON; leaving it as is', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return value;
}

/**
 * Old → new wardrobe item id for new-account mode.
 *
 * A wardrobe item is not a row: it is a `Wardrobe/*.md` document whose id
 * lives in its frontmatter, and this remap never rewrites document content.
 * So an item id is **not** a remapper key — sending it through
 * `remapper.remap` would mint a fresh id that names no item, orphaning every
 * wear-ledger row that points at it. Instead:
 *
 * - a frontmatter id travels verbatim, so it maps to itself;
 * - an item with no frontmatter id has an id derived from its mount point and
 *   path, and the mount point *is* remapped — recompute it against the new
 *   mount-point id, exactly as the vault reader will after the restore;
 * - a legacy (pre-cutover) `wardrobeItems` row is remapped by id like any
 *   other row (see `remappedWardrobeItems`), so its ledger rows follow it.
 */
function buildWardrobeItemIdRemap(
  data: BackupData,
  remapper: UuidRemapper
): Map<string, string> {
  const map = new Map<string, string>();
  const contentByFileId = new Map<string, unknown>(
    (data.docMountDocuments || []).map((doc) => [doc.fileId, doc.content])
  );
  for (const link of data.docMountFileLinks || []) {
    if (!isWardrobeItemDocumentPath(link.relativePath)) continue;
    const content = contentByFileId.get(link.fileId);
    if (typeof content !== 'string') continue;
    const oldId = wardrobeItemIdForDocument({
      mountPointId: link.mountPointId,
      relativePath: link.relativePath,
      content,
    });
    const newId = wardrobeItemIdForDocument({
      mountPointId: remapper.remap(link.mountPointId),
      relativePath: link.relativePath,
      content,
    });
    map.set(oldId, newId);
  }
  for (const item of data.wardrobeItems || []) {
    map.set(item.id, remapper.remap(item.id));
  }
  return map;
}

/** One wardrobe item whose current-picture pointer must follow its file's new id. */
export interface WardrobeImagePointerFix {
  /** The item's mount, already remapped. */
  mountPointId: string;
  /** The item's mount as the backup named it (before the remap). */
  sourceMountPointId: string;
  /** The item's id in the restored instance. */
  itemId: string;
  /** The picture's remapped `files` id. */
  imageFileId: string;
}

/**
 * New-account mode remaps `files.id`, but an item's `imageFileId` lives in its
 * `Wardrobe/*.md` frontmatter, which this remap never rewrites. List the
 * pointers that need to follow their file, for the restore to apply through
 * the ordinary wardrobe update once the vaults have landed (that path
 * re-projects the document, so content hashes stay consistent).
 *
 * Pass the ORIGINAL (pre-remap) backup data and the same remapper used for
 * `remapBackupData`, so file ids resolve to the ids the rows received.
 */
export function planWardrobeImagePointerFixes(
  original: BackupData,
  remapper: UuidRemapper
): WardrobeImagePointerFix[] {
  const fileIds = new Set((original.files || []).map((f) => f.id));
  const itemIdRemap = buildWardrobeItemIdRemap(original, remapper);
  const contentByFileId = new Map<string, unknown>(
    (original.docMountDocuments || []).map((doc) => [doc.fileId, doc.content])
  );
  const fixes: WardrobeImagePointerFix[] = [];
  for (const link of original.docMountFileLinks || []) {
    if (!isWardrobeItemDocumentPath(link.relativePath)) continue;
    const content = contentByFileId.get(link.fileId);
    if (typeof content !== 'string') continue;
    const pointer = parseFrontmatter(content).data?.imageFileId;
    if (typeof pointer !== 'string' || !fileIds.has(pointer)) continue;
    const oldItemId = wardrobeItemIdForDocument({ mountPointId: link.mountPointId, relativePath: link.relativePath, content });
    fixes.push({
      mountPointId: remapper.remap(link.mountPointId),
      sourceMountPointId: link.mountPointId,
      itemId: itemIdRemap.get(oldItemId) ?? oldItemId,
      imageFileId: remapper.remap(pointer),
    });
  }
  return fixes;
}

/**
 * A tiered item kind whose item id and current picture (`imageFileId`) live
 * in its own file, travelling verbatim through a restore: the Inventory's
 * `.json` objects and the Atlas's `.md` entries. One descriptor per kind, so
 * the id protection and the picture-pointer repair are written once.
 */
export interface ItemFileKind {
  /** For log lines and warnings. */
  noun: string;
  isDocumentPath(relativePath: string): boolean;
  /** The file's id and current picture, or null when it is not an item. */
  read(content: string): { id: string; imageFileId: unknown } | null;
}

export const INVENTORY_ITEM_FILE_KIND: ItemFileKind = {
  noun: 'inventory',
  isDocumentPath: isInventoryItemDocumentPath,
  read(content) {
    try {
      const json: unknown = JSON.parse(content);
      if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
      const { id, imageFileId } = json as Record<string, unknown>;
      return typeof id === 'string' && id.length > 0 ? { id, imageFileId } : null;
    } catch {
      return null;
    }
  },
};

export const ATLAS_ITEM_FILE_KIND: ItemFileKind = {
  noun: 'atlas',
  isDocumentPath: isAtlasEntryDocumentPath,
  read(content) {
    const data = parseFrontmatter(content.replace(/\r\n/g, '\n')).data;
    const id = data?.id;
    return typeof id === 'string' && id.length > 0 ? { id, imageFileId: data?.imageFileId } : null;
  },
};

/** Every kind whose ids travel verbatim. */
export const ITEM_FILE_KINDS: readonly ItemFileKind[] = [INVENTORY_ITEM_FILE_KIND, ATLAS_ITEM_FILE_KIND];

/** One kind's item documents in a backup, with what each file says. */
function itemFileDocuments(
  data: BackupData,
  kind: ItemFileKind,
): Array<{ link: DocMountFileLink; id: string; imageFileId: unknown }> {
  const contentByFileId = new Map<string, unknown>(
    (data.docMountDocuments || []).map((doc) => [doc.fileId, doc.content])
  );
  const out: Array<{ link: DocMountFileLink; id: string; imageFileId: unknown }> = [];
  for (const link of data.docMountFileLinks || []) {
    if (!kind.isDocumentPath(link.relativePath)) continue;
    const content = contentByFileId.get(link.fileId);
    if (typeof content !== 'string') continue;
    const read = kind.read(content);
    if (read) out.push({ link, ...read });
  }
  return out;
}

/**
 * Item ids in a backup that live in their own files (Inventory objects, Atlas
 * entries). Like a wardrobe frontmatter id, such an id travels verbatim (as do
 * the `parentId` and kit `itemIds` that name other objects), so these ids are
 * never remapper keys: a picture's `files.linkedTo` and a chat's
 * `equippedInventory` keep naming them as they are.
 */
function verbatimItemIds(data: BackupData): Set<string> {
  const ids = new Set<string>();
  for (const kind of ITEM_FILE_KINDS) for (const doc of itemFileDocuments(data, kind)) ids.add(doc.id);
  return ids;
}

/** One item whose current-picture pointer must follow its file's new id. */
export interface ItemImagePointerFix {
  /** The item's mount, already remapped. */
  mountPointId: string;
  /** The item's mount as the backup named it (before the remap). */
  sourceMountPointId: string;
  /** The item's id (unchanged by the remap). */
  itemId: string;
  /** The picture's remapped `files` id. */
  imageFileId: string;
}

/**
 * The analogue of {@link planWardrobeImagePointerFixes} for a kind whose
 * `imageFileId` lives in a file the remap never rewrites: list the pointers
 * the restore must repoint once the vaults have landed. Pass the ORIGINAL
 * backup data and the same remapper.
 */
export function planItemImagePointerFixes(
  original: BackupData,
  remapper: UuidRemapper,
  kind: ItemFileKind,
): ItemImagePointerFix[] {
  const fileIds = new Set((original.files || []).map((f) => f.id));
  const fixes: ItemImagePointerFix[] = [];
  for (const { link, id, imageFileId } of itemFileDocuments(original, kind)) {
    if (typeof imageFileId !== 'string' || !fileIds.has(imageFileId)) continue;
    fixes.push({
      mountPointId: remapper.remap(link.mountPointId),
      sourceMountPointId: link.mountPointId,
      itemId: id,
      imageFileId: remapper.remap(imageFileId),
    });
  }
  return fixes;
}

/** The Inventory's pointer fixes. */
export function planInventoryImagePointerFixes(original: BackupData, remapper: UuidRemapper): ItemImagePointerFix[] {
  return planItemImagePointerFixes(original, remapper, INVENTORY_ITEM_FILE_KIND);
}

/** The Atlas's pointer fixes. */
export function planAtlasImagePointerFixes(original: BackupData, remapper: UuidRemapper): ItemImagePointerFix[] {
  return planItemImagePointerFixes(original, remapper, ATLAS_ITEM_FILE_KIND);
}

/**
 * Issue a new id for every row the backup carries — and for the rows that
 * live inside others (a chat's participants and messages) — before anything
 * is remapped. A reference resolves only to an id issued here; one naming a
 * row the backup does not carry stays unresolved, and the id-field table's
 * `onMissing` decides what becomes of it. Nothing is minted for a reference.
 *
 * Wardrobe items, Inventory objects and Atlas entries are not issued ids:
 * their ids live in their own files and travel verbatim (see
 * {@link buildWardrobeItemIdRemap} and {@link verbatimItemIds}).
 */
function issueBackupRowIds(data: BackupData, remapper: UuidRemapper): void {
  const collections: Array<ReadonlyArray<{ id?: unknown }> | undefined> = [
    data.tags, data.files, data.characters, data.connectionProfiles, data.imageProfiles,
    data.embeddingProfiles, data.chats, data.memories, data.promptTemplates, data.roleplayTemplates,
    data.projects, data.groups, data.llmLogs, data.pluginConfigs, data.chatSettings, data.folders,
    data.wardrobeItems, data.characterPluginData, data.conversationAnnotations, data.chatDocuments,
    data.chatInforms, data.conversationChunks, data.tfidfVocabularies, data.embeddingStatus,
    data.docMountPoints, data.docMountFolders, data.docMountFiles, data.docMountFileLinks,
    data.docMountChunks, data.docMountDocuments, data.docMountBlobs, data.projectDocMountLinks,
    data.groupDocMountLinks, data.groupCharacterMembers, data.wardrobeWear, data.wardrobeHistory,
    data.avatarTimeline, data.logEntries,
  ];
  for (const rows of collections) {
    for (const row of rows ?? []) {
      if (typeof row.id === 'string' && row.id) remapper.remap(row.id);
    }
  }
  for (const chat of data.chats) {
    for (const participant of chat.participants ?? []) if (participant.id) remapper.remap(participant.id);
    for (const message of chat.messages ?? []) if (message.id) remapper.remap(message.id);
  }
}

/**
 * The restore side's resolver: an id issued for a row in the backup, or a
 * built-in roleplay template (the same id on every instance), else unknown.
 */
function restoreResolver(remapper: UuidRemapper): IdResolver {
  return (target, id) =>
    remapper.lookup(id) ?? (target === 'roleplayTemplate' && isBuiltInRoleplayTemplateId(id) ? id : undefined);
}

/**
 * Remaps all UUIDs in the backup data for new-account mode.
 *
 * Every row gets a fresh id; every reference listed in the id-field table
 * (`lib/backup/id-fields.ts`) follows it, or — naming a row the backup does
 * not carry — is kept, cleared or drops its row as the table says. What the
 * table marks bespoke for restore is rewritten here by its own rules.
 */
export function remapBackupData(
  data: BackupData,
  targetUserId: string,
  remapper: UuidRemapper
): BackupData {
  issueBackupRowIds(data, remapper);
  const resolve = restoreResolver(remapper);
  const side = { side: 'restore' as const };

  /** The row under its new id, with every table field remapped (or null to drop it). */
  const remapRow = <T extends { id: string }>(entity: IdEntity, row: T): T | null =>
    remapEntity(entity, { ...row, id: remapper.remap(row.id) }, resolve, side).row;
  const remapRows = <T extends { id: string }>(entity: IdEntity, rows: readonly T[] | undefined): T[] => {
    const out: T[] = [];
    let dropped = 0;
    for (const row of rows ?? []) {
      const remapped = remapRow(entity, row);
      if (remapped) out.push(remapped);
      else dropped++;
    }
    if (dropped > 0) {
      moduleLogger.info('Dropped backup rows whose required reference is not in the backup', { entity, dropped });
    }
    return out;
  };
  /** For collections restored by index beside their bytes: never drops a row. */
  const remapRowsInPlace = <T extends { id: string }>(entity: IdEntity, rows: readonly T[] | undefined): T[] =>
    (rows ?? []).map((row) => remapRow(entity, row) ?? { ...row, id: remapper.remap(row.id) });
  const owned = <T>(rows: T[]): T[] => rows.map((row) => ({ ...row, userId: targetUserId }));

  // Wardrobe item ids are not remapper keys (see buildWardrobeItemIdRemap).
  // Built up front: a wardrobe picture's `files` row names its item in
  // `linkedTo` / `tags`, and those must follow the item, not mint a stranger.
  const wardrobeItemIdRemap = buildWardrobeItemIdRemap(data, remapper);
  // Inventory object and Atlas entry ids travel verbatim, so a picture naming one keeps it.
  const verbatimIds = verbatimItemIds(data);
  // `linkedTo` / `tags` on a file are polymorphic (bespoke in the table).
  const remapLinkId = (id: string): string =>
    verbatimIds.has(id) ? id : wardrobeItemIdRemap.get(id) ?? remapper.lookup(id) ?? id;

  const remappedFiles = owned(remapRowsInPlace('file', data.files)).map((file) => ({
    ...file,
    ...(Array.isArray(file.linkedTo) ? { linkedTo: file.linkedTo.map(remapLinkId) } : {}),
    ...(Array.isArray(file.tags) ? { tags: file.tags.map(remapLinkId) } : {}),
  }));

  const remappedCharacters = data.characters.map((char) => {
    const legacy = { ...char } as Record<string, unknown>;
    // personaLinks backwards compatibility (old backup format).
    if (legacy.personaLinks && !legacy.partnerLinks) {
      legacy.partnerLinks = (legacy.personaLinks as Array<{ personaId: string; isDefault: boolean }>).map((link) => ({
        partnerId: link.personaId,
        isDefault: link.isDefault,
      }));
    }
    delete legacy.personaLinks;
    // physicalDescription: backups may carry the legacy plural array or the
    // singular field. Collapse to the first record either way; its own id is
    // issued afresh.
    if (Array.isArray(legacy.physicalDescriptions)) {
      const first = legacy.physicalDescriptions[0] as PhysicalDescription | undefined;
      legacy.physicalDescription = first ? { ...first, id: remapper.remap(first.id) } : null;
      delete legacy.physicalDescriptions;
    } else if (legacy.physicalDescription) {
      const description = legacy.physicalDescription as PhysicalDescription;
      legacy.physicalDescription = { ...description, id: remapper.remap(description.id) };
    }
    // Legacy `clothingRecords` — the table is gone; drop silently so old
    // backups still restore.
    delete legacy.clothingRecords;
    // The vault pointer follows its store like any reference (bug 185): the
    // store's row is restored under the id issued for it, and the restore
    // binds the character to that vault rather than minting one.
    return { ...(remapRow('character', legacy as unknown as Character) as Character), userId: targetUserId };
  });

  // `fallbackProfileId` names another row in the same table and resolves
  // whatever order the profiles come in, since every id is issued up front.
  const remappedConnectionProfiles = owned(remapRows('connectionProfile', data.connectionProfiles));
  const remappedImageProfiles = owned(remapRows('imageProfile', data.imageProfiles));
  const remappedEmbeddingProfiles = owned(remapRows('embeddingProfile', data.embeddingProfiles));

  const backupCharacterIds = new Set(data.characters.map((character) => character.id));
  const remappedChats = data.chats.map((chat) => {
    const remappedChat = {
      ...(remapRow('chat', chat as unknown as ChatWithMessages) as ChatWithMessages),
      userId: targetUserId,
    };

    // The scenario source names a mount; a source whose store the backup does
    // not carry is dropped whole (bespoke in the table).
    if (chat.scenarioSource) {
      remappedChat.scenarioSource = remapScenarioSource(chat.scenarioSource, (id) => remapper.lookup(id) ?? null);
    }

    // Outfits, outfit avatars, Courier checkpoints, queued outfit notices and
    // the carried Inventory are keyed by character id (bug 252); one pass
    // carries them all. An entry for a character the backup does not carry is
    // dropped rather than given an id that names nobody.
    const keyed = remapCharacterKeyedChatFields(chat, {
      characterId: (id) => (backupCharacterIds.has(id) ? remapper.lookup(id) ?? null : null),
      wardrobeItemId: (id) => wardrobeItemIdRemap.get(id) ?? id,
      fileId: (id) => remapper.lookup(id) ?? id,
      messageId: (id) => remapper.lookup(id) ?? id,
    });
    Object.assign(remappedChat, keyed.patch);
    if (keyed.unreadable.length > 0) {
      moduleLogger.warn('Chat character-keyed columns unreadable; left as given', {
        chatId: chat.id,
        fields: keyed.unreadable,
      });
    }
    if (Object.keys(keyed.patch).length > 0) {
      moduleLogger.debug('Remapped character-keyed chat fields', {
        chatId: chat.id,
        fields: Object.keys(keyed.patch),
        droppedEntries: keyed.droppedEntries,
      });
    }

    remappedChat.messages = chat.messages.map(
      (message) => remapRow('message', message as typeof message & { id: string }) as typeof message
    );
    return remappedChat;
  });

  const remappedMemories = remapRows('memory', data.memories as Array<SerializedMemory & { id: string }>) as SerializedMemory[];
  const remappedPromptTemplates = owned(remapRows('promptTemplate', data.promptTemplates));
  const remappedRoleplayTemplates = owned(remapRows('roleplayTemplate', data.roleplayTemplates));

  // Provider models are global and don't need remapping, just copy them
  const remappedProviderModels = data.providerModels;

  // officialMountPointId follows the store's own row, so the restore can bind
  // the project or group to its archived store (bug 185).
  const remappedProjects = owned(remapRows('project', data.projects));
  const remappedGroups = remapRows('group', data.groups);

  // LLM logs are history: a target that is gone is still history (keep).
  const remappedLLMLogs = owned(remapRows('llmLog', data.llmLogs));
  const remappedPluginConfigs = owned(remapRows('pluginConfig', data.pluginConfigs as Array<PluginConfig & { id: string }>));

  // Chat settings. A backup from before 4.10 carries the retired Concierge
  // settings (dangerousContentSettings, the top-level vision fallback, the
  // crafter under cheapLLMSettings) and no conciergeSettings; translate them
  // here, exactly as add-concierge-settings-v1 does, before the repository's
  // schema strips the old keys. Then the table remaps the profile pointers.
  const backupHasUnmoderatedChats = (data.chats || []).some(
    (chat) => getConciergeState(withConciergeModeFromLegacy(chat as Parameters<typeof withConciergeModeFromLegacy>[0])) === 'unmoderated',
  );
  const remappedChatSettings = (data.chatSettings || []).map((settings) => {
    const concierge = withConciergeSettingsFromLegacy(
      settings as SettingsWithLegacyConcierge<ChatSettings>,
      backupHasUnmoderatedChats,
    ).conciergeSettings as ChatSettings['conciergeSettings'];
    return {
      ...(remapRow('chatSettings', { ...settings, conciergeSettings: concierge }) as ChatSettings),
      userId: targetUserId,
    };
  });

  const remappedFolders = owned(remapRows('folder', data.folders));

  // Legacy (pre-cutover) wardrobe rows are rows: remapped by id like any
  // other, with `componentItemIds` following through the same item remap.
  const remappedWardrobeItems = (data.wardrobeItems || []).map((item) => ({
    ...item,
    id: remapper.remap(item.id),
    characterId: item.characterId ? remapper.lookup(item.characterId) ?? item.characterId : item.characterId,
    imageFileId: item.imageFileId ? remapper.lookup(item.imageFileId) ?? item.imageFileId : item.imageFileId,
    componentItemIds: (item.componentItemIds ?? []).map((id) => wardrobeItemIdRemap.get(id) ?? id),
  })) as WardrobeItem[];

  // Informs: `batchId` is a group key, not a row (exempt in the table); it is
  // reissued consistently so the batch moves together and no key from the
  // source instance survives.
  const remappedChatInforms = remapRows('chatInform', data.chatInforms).map((inform) => ({
    ...inform,
    batchId: inform.batchId ? remapper.remap(inform.batchId) : inform.batchId,
  })) as ChatInform[];

  // Embedding status — `entityId` is polymorphic (memory / file / help doc /
  // chunk); every row id was issued up front, so the table resolves it.
  const remappedTfidfVocabularies = owned(remapRows('tfidfVocabulary', data.tfidfVocabularies));
  const remappedEmbeddingStatus = owned(remapRows('embeddingStatus', data.embeddingStatus));

  // Legacy vector entries (pre-Phase-B archives) — id is the memory id, so the
  // restore can still match each to its memory.
  const remappedVectorEntries = (data.vectorEntries || []).map((entry) => ({
    ...entry,
    id: remapper.lookup(entry.id) ?? entry.id,
    characterId: entry.characterId ? remapper.lookup(entry.characterId) ?? entry.characterId : entry.characterId,
  })) as SerializedVectorEntry[];

  // Document store tables. `doc_mount_files` row ids are shared by documents
  // and blobs (fileId), so every row pointing at a file follows it. A file
  // link's `linkGroupId` is a hard-link group key, reissued consistently: left
  // as it was, a new-account restore beside its source would join the source's
  // link groups, and an edit to one copy would write through to the other.
  const remappedDocMountFileLinks = remapRows('docMountFileLink', data.docMountFileLinks).map((link) => ({
    ...link,
    ...(link.linkGroupId ? { linkGroupId: remapper.remap(link.linkGroupId) } : {}),
  })) as DocMountFileLink[];

  // Wardrobe wear ledger: `itemId` follows the wardrobe item remap; an item
  // id the backup carries no document for passes through unchanged.
  const remappedWardrobeWear = remapRows('wardrobeWear', data.wardrobeWear).map((row) => ({
    ...row,
    itemId: wardrobeItemIdRemap.get(row.itemId) ?? row.itemId,
  })) as WardrobeWearStatsRow[];

  // Outfit history: slot item ids follow the same item remap as the wear
  // ledger. Indices, cursor and dates are kept.
  const remappedWardrobeHistory = remapRows('wardrobeHistory', data.wardrobeHistory).map((row) => {
    const slots = bySlot((slot) => (row.slots?.[slot] ?? []).map((id) => wardrobeItemIdRemap.get(id) ?? id));
    return { ...row, slots, slotsHash: hashEquippedSlots(slots) };
  }) as ChatWardrobeHistoryRow[];

  // Avatar timeline. A row for a character the backup does not carry is
  // dropped, as the chat remap drops such entries (bespoke in the table).
  const remappedAvatarTimeline = remapRows(
    'avatarTimeline',
    (data.avatarTimeline || []).filter((row) => {
      if (backupCharacterIds.has(row.characterId)) return true;
      moduleLogger.debug('Dropped avatar timeline row for a character not in the backup', {
        chatId: row.chatId,
        characterId: row.characterId,
      });
      return false;
    }).map((row) => ({ ...row, characterId: remapper.lookup(row.characterId) ?? row.characterId })),
  ) as ChatAvatarTimelineRow[];

  // Instance settings — only the mount-point keys carry UUIDs we need to
  // remap. Everything else is opaque text (numbers, JSON config blobs).
  const remappedInstanceSettings = (data.instanceSettings || []).map((row) => {
    if (MOUNT_POINT_SETTING_KEYS.has(row.key) && row.value) {
      return { key: row.key, value: remapper.lookup(row.value) ?? row.value };
    }
    if (row.key === BRAHMA_CONSOLE_SETTING_KEY && row.value) {
      return { key: row.key, value: remapBrahmaConsoleSetting(row.value, remapper) };
    }
    return row;
  });

  return {
    manifest: data.manifest,
    characters: remappedCharacters,
    chats: remappedChats,
    tags: owned(remapRows('tag', data.tags)) as Tag[],
    connectionProfiles: remappedConnectionProfiles as ConnectionProfile[],
    imageProfiles: remappedImageProfiles as ImageProfile[],
    embeddingProfiles: remappedEmbeddingProfiles as EmbeddingProfile[],
    memories: remappedMemories,
    files: remappedFiles as FileEntry[],
    promptTemplates: remappedPromptTemplates as PromptTemplate[],
    roleplayTemplates: remappedRoleplayTemplates as RoleplayTemplate[],
    providerModels: remappedProviderModels,
    projects: remappedProjects as Project[],
    groups: remappedGroups as Group[],
    llmLogs: remappedLLMLogs as LLMLog[],
    pluginConfigs: remappedPluginConfigs as PluginConfig[],
    chatSettings: remappedChatSettings,
    folders: remappedFolders as Folder[],
    wardrobeItems: remappedWardrobeItems,
    characterPluginData: remapRows('characterPluginData', data.characterPluginData) as CharacterPluginData[],
    conversationAnnotations: remapRows('conversationAnnotation', data.conversationAnnotations) as ConversationAnnotation[],
    chatDocuments: remapRows('chatDocument', data.chatDocuments) as ChatDocument[],
    chatInforms: remappedChatInforms,
    instanceSettings: remappedInstanceSettings,
    embeddingStatus: remappedEmbeddingStatus as EmbeddingStatus[],
    conversationChunks: remapRows('conversationChunk', data.conversationChunks) as SerializedConversationChunk[],
    tfidfVocabularies: remappedTfidfVocabularies as TfidfVocabulary[],
    vectorEntries: remappedVectorEntries,
    docMountPoints: remapRows('docMountPoint', data.docMountPoints) as DocMountPoint[],
    docMountFolders: remapRows('docMountFolder', data.docMountFolders) as DocMountFolder[],
    docMountFiles: remapRowsInPlace('docMountFile', data.docMountFiles) as DocMountFile[],
    docMountFileLinks: remappedDocMountFileLinks,
    docMountChunks: remapRows('docMountChunk', data.docMountChunks) as SerializedDocMountChunk[],
    docMountDocuments: remapRows('docMountDocument', data.docMountDocuments) as DocMountDocument[],
    // Restored by index beside their bytes: never dropped (no drop-row field).
    docMountBlobs: remapRowsInPlace('docMountBlob', data.docMountBlobs) as DocMountBlobMetadata[],
    projectDocMountLinks: remapRows('projectDocMountLink', data.projectDocMountLinks) as ProjectDocMountLink[],
    groupDocMountLinks: remapRows('groupDocMountLink', data.groupDocMountLinks) as GroupDocMountLink[],
    groupCharacterMembers: remapRows('groupCharacterMember', data.groupCharacterMembers) as GroupCharacterMember[],
    // Text replacement rules: global config, no userId, no FKs to remapped
    // entities, and nothing references rule IDs — pass through unchanged.
    textReplacementRules: data.textReplacementRules || [],
    wardrobeWear: remappedWardrobeWear,
    wardrobeHistory: remappedWardrobeHistory,
    avatarTimeline: remappedAvatarTimeline,
    logEntries: remapRows('logEntry', data.logEntries) as LogEntry[],
  };
}
