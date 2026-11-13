/**
 * The id-field table: every field of an exported or backed-up row that holds
 * the id of another row, what kind of row it names, and what becomes of it
 * when the id cannot be resolved.
 *
 * Restore (new-account mode, `restore/uuid-remap.ts`) and `.qtap` import
 * (`import/quilltap-import/reconcile.ts`, `message-id-remap.ts`) both drive
 * their remapping from this one list through {@link remapEntity}; they differ
 * only in *when* (restore rewrites the parsed backup before inserting, import
 * reconciles after inserting) and in the resolver they pass. They used to
 * keep their own field lists and disagreed on ten points (#190, spec
 * refactor-4-13-import-restore-insert-and-remap.md).
 *
 * `onMissing` says what happens to an id the resolver does not know:
 *
 * - `keep` — the id may name a row already in the instance; leave it.
 * - `null` — clear the field (or drop the element from an id array).
 * - `drop-row` — the row means nothing without its target; drop the row.
 *
 * "Mint an id that names nothing" is never an option.
 *
 * A field some subsystem rewrites by its own rules (a vault pointer, a
 * polymorphic link list, a character-keyed JSON column) is still listed, with
 * a `bespoke` note naming who handles it on which side; {@link remapEntity}
 * skips it there.
 *
 * `__tests__/unit/lib/backup/id-fields-guard.test.ts` walks the Zod schema of
 * every entity below and fails for any UUID-typed field that is neither
 * listed here nor in {@link ID_FIELD_EXEMPTIONS}.
 *
 * @module backup/id-fields
 */

import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'backup:id-fields' });

/** Every row kind the table describes. */
export type IdEntity =
  | 'character'
  | 'chat'
  | 'message'
  | 'tag'
  | 'connectionProfile'
  | 'imageProfile'
  | 'embeddingProfile'
  | 'roleplayTemplate'
  | 'promptTemplate'
  | 'project'
  | 'group'
  | 'memory'
  | 'file'
  | 'folder'
  | 'chatSettings'
  | 'llmLog'
  | 'logEntry'
  | 'pluginConfig'
  | 'chatDocument'
  | 'chatInform'
  | 'conversationAnnotation'
  | 'conversationChunk'
  | 'wardrobeHistory'
  | 'avatarTimeline'
  | 'wardrobeWear'
  | 'characterPluginData'
  | 'tfidfVocabulary'
  | 'embeddingStatus'
  | 'docMountPoint'
  | 'docMountFolder'
  | 'docMountFile'
  | 'docMountFileLink'
  | 'docMountChunk'
  | 'docMountDocument'
  | 'docMountBlob'
  | 'projectDocMountLink'
  | 'groupDocMountLink'
  | 'groupCharacterMember';

/** The kind of row an id names. `any` is a polymorphic reference. */
export type IdTarget =
  | 'character'
  | 'chat'
  | 'participant'
  | 'message'
  | 'tag'
  | 'connectionProfile'
  | 'imageProfile'
  | 'embeddingProfile'
  | 'roleplayTemplate'
  | 'project'
  | 'group'
  | 'memory'
  | 'file'
  | 'folder'
  | 'mountPoint'
  | 'docMountFolder'
  | 'docMountFile'
  | 'docMountFileLink'
  | 'terminalSession'
  | 'any';

export type OnMissing = 'keep' | 'null' | 'drop-row';

export type IdSide = 'import' | 'restore';

export interface IdField {
  entity: IdEntity;
  /**
   * Dotted path; `[]` after a segment walks an array. A path ending in `[]`
   * is an array of ids.
   */
  path: string;
  target: IdTarget;
  onMissing: OnMissing;
  /**
   * `swipe-prefix`: the value is `swipe-<id>` (what regenerate-swipe writes);
   * any other shape is an opaque per-chat grouping key and is kept.
   * `json-array`: the value is a JSON-encoded string array of ids.
   */
  encoding?: 'swipe-prefix' | 'json-array';
  /** Sides on which a dedicated routine rewrites this field instead. */
  bespoke?: Partial<Record<IdSide, string>>;
}

const IMPORT_AVATAR = 'reconcile.ts: through the imported document-store link map, else a local file, else cleared';
const IMPORT_VAULT = 'reconcile.ts: the bundle vault replaces the scaffold (rememberBundleVault)';
const SCENARIO_SOURCE = 'remapScenarioSource: a source whose store is gone is dropped whole';
const CONSOLE_CONTEXT = 'remapConsoleContext: polymorphic by kind (chat / project / store); an entry whose target is missing is dropped';
const IMPORT_MEMORY = 'importMemories: pre-minted memory ids and local-character fallback (bug 240)';
const IMPORT_INFORM = 'remapChatInform: verified against the seats and messages that landed';
const WARDROBE_ITEMS = 'wardrobe item ids live in vault frontmatter (buildWardrobeItemIdRemap / buildImportedWardrobeItemIdMap)';
const LINKED_TO = 'polymorphic; restore remapLinkId (wardrobe and verbatim item ids), import remapLinkedTo';
const RESTORE_TIMELINE_CHARACTER = 'uuid-remap.ts: a row for a character the backup does not carry is dropped';

export const ID_FIELDS: readonly IdField[] = [
  // ── character ─────────────────────────────────────────────────────────
  { entity: 'character', path: 'tags[]', target: 'tag', onMissing: 'keep' },
  { entity: 'character', path: 'defaultPartnerId', target: 'character', onMissing: 'keep' },
  { entity: 'character', path: 'partnerLinks[].partnerId', target: 'character', onMissing: 'keep' },
  { entity: 'character', path: 'defaultConnectionProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'character', path: 'defaultImageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'character', path: 'defaultRoleplayTemplateId', target: 'roleplayTemplate', onMissing: 'null' },
  { entity: 'character', path: 'defaultImageId', target: 'any', onMissing: 'keep', bespoke: { import: IMPORT_AVATAR } },
  { entity: 'character', path: 'avatarOverrides[].chatId', target: 'chat', onMissing: 'keep' },
  { entity: 'character', path: 'avatarOverrides[].imageId', target: 'any', onMissing: 'keep', bespoke: { import: IMPORT_AVATAR } },
  { entity: 'character', path: 'characterDocumentMountPointId', target: 'mountPoint', onMissing: 'keep', bespoke: { import: IMPORT_VAULT } },
  { entity: 'character', path: 'archiveFileId', target: 'file', onMissing: 'keep' },
  { entity: 'character', path: 'archivedAvatarFileId', target: 'file', onMissing: 'keep' },

  // ── chat ──────────────────────────────────────────────────────────────
  { entity: 'chat', path: 'participants[].id', target: 'participant', onMissing: 'keep' },
  { entity: 'chat', path: 'participants[].characterId', target: 'character', onMissing: 'keep' },
  // Keep, never null: a participant with no connection profile is user-controlled.
  { entity: 'chat', path: 'participants[].connectionProfileId', target: 'connectionProfile', onMissing: 'keep' },
  { entity: 'chat', path: 'participants[].imageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'chat', path: 'participants[].roleplayTemplateId', target: 'roleplayTemplate', onMissing: 'null' },
  { entity: 'chat', path: 'tags[]', target: 'tag', onMissing: 'keep' },
  { entity: 'chat', path: 'lastTurnParticipantId', target: 'participant', onMissing: 'keep' },
  { entity: 'chat', path: 'activeTypingParticipantId', target: 'participant', onMissing: 'keep' },
  { entity: 'chat', path: 'impersonatingParticipantIds[]', target: 'participant', onMissing: 'keep' },
  { entity: 'chat', path: 'turnQueue', target: 'participant', onMissing: 'keep', encoding: 'json-array' },
  { entity: 'chat', path: 'spokenThisCycleParticipantIds', target: 'participant', onMissing: 'keep', encoding: 'json-array' },
  { entity: 'chat', path: 'cycleOrderParticipantIds', target: 'participant', onMissing: 'keep', encoding: 'json-array' },
  // Decision §8.2: an anchor naming no message is dropped from the array.
  { entity: 'chat', path: 'summaryAnchorMessageIds[]', target: 'message', onMissing: 'null' },
  // The fold passes' cursors, carried on the chat under their legacy names.
  { entity: 'chat', path: 'otherExtractionWatermarkMessageId', target: 'message', onMissing: 'null' },
  { entity: 'chat', path: 'episodeExtractionWatermarkMessageId', target: 'message', onMissing: 'null' },
  { entity: 'chat', path: 'turnExtractionWatermarkMessageId', target: 'message', onMissing: 'null' },
  // Terminal sessions never travel; a live session cannot survive the trip.
  { entity: 'chat', path: 'activeTerminalSessionId', target: 'terminalSession', onMissing: 'null' },
  { entity: 'chat', path: 'projectId', target: 'project', onMissing: 'keep' },
  { entity: 'chat', path: 'scenarioSource.mountPointId', target: 'mountPoint', onMissing: 'keep', bespoke: { import: SCENARIO_SOURCE, restore: SCENARIO_SOURCE } },
  { entity: 'chat', path: 'storyBackgroundImageId', target: 'file', onMissing: 'keep' },
  // Decision §8.2: an image profile that is not here is cleared.
  { entity: 'chat', path: 'imageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'chat', path: 'consoleConnectionProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chat', path: 'consoleContext[].id', target: 'any', onMissing: 'null', bespoke: { import: CONSOLE_CONTEXT, restore: CONSOLE_CONTEXT } },
  { entity: 'chat', path: 'roleplayTemplateId', target: 'roleplayTemplate', onMissing: 'null' },

  // ── message ───────────────────────────────────────────────────────────
  // Decision §8.2: `swipe-<messageId>` follows its message; any other key is opaque.
  { entity: 'message', path: 'swipeGroupId', target: 'message', onMissing: 'keep', encoding: 'swipe-prefix' },
  { entity: 'message', path: 'participantId', target: 'participant', onMissing: 'keep' },
  { entity: 'message', path: 'attachments[]', target: 'file', onMissing: 'keep' },
  { entity: 'message', path: 'targetParticipantIds[]', target: 'participant', onMissing: 'keep' },
  { entity: 'message', path: 'hostEvent.participantId', target: 'participant', onMissing: 'keep' },
  { entity: 'message', path: 'hostEvent.introducedCharacterIds[]', target: 'character', onMissing: 'keep' },
  { entity: 'message', path: 'customAnnouncer.characterId', target: 'character', onMissing: 'keep' },
  { entity: 'message', path: 'carinaMeta.answererId', target: 'character', onMissing: 'keep' },
  { entity: 'message', path: 'pascalMeta.callerParticipantId', target: 'participant', onMissing: 'keep' },
  { entity: 'message', path: 'pendingExternalAttachments[].fileId', target: 'file', onMissing: 'keep' },

  // ── profiles, tags, templates ─────────────────────────────────────────
  { entity: 'connectionProfile', path: 'fallbackProfileId', target: 'connectionProfile', onMissing: 'keep' },
  { entity: 'connectionProfile', path: 'tags[]', target: 'tag', onMissing: 'keep' },
  { entity: 'imageProfile', path: 'tags[]', target: 'tag', onMissing: 'keep' },
  { entity: 'embeddingProfile', path: 'tags[]', target: 'tag', onMissing: 'keep' },
  { entity: 'roleplayTemplate', path: 'tags[]', target: 'tag', onMissing: 'keep' },
  { entity: 'promptTemplate', path: 'tags[]', target: 'tag', onMissing: 'keep' },

  // ── project, group ────────────────────────────────────────────────────
  { entity: 'project', path: 'officialMountPointId', target: 'mountPoint', onMissing: 'keep', bespoke: { import: 'importProjects: a project keeps or provisions its own store' } },
  { entity: 'project', path: 'characterRoster[]', target: 'character', onMissing: 'keep' },
  { entity: 'project', path: 'defaultImageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'project', path: 'defaultRoleplayTemplateId', target: 'roleplayTemplate', onMissing: 'null' },
  { entity: 'project', path: 'brahmaConnectionProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'project', path: 'staticBackgroundImageId', target: 'file', onMissing: 'keep' },
  { entity: 'project', path: 'storyBackgroundImageId', target: 'file', onMissing: 'keep' },
  { entity: 'group', path: 'officialMountPointId', target: 'mountPoint', onMissing: 'keep', bespoke: { import: 'importGroups: a group keeps or provisions its own store' } },

  // ── memory ────────────────────────────────────────────────────────────
  { entity: 'memory', path: 'characterId', target: 'character', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'aboutCharacterId', target: 'character', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'chatId', target: 'chat', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'projectId', target: 'project', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'tags[]', target: 'tag', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'sourceMessageId', target: 'message', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'relatedMemoryIds[]', target: 'memory', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'supersededById', target: 'memory', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },
  { entity: 'memory', path: 'consolidatedFrom[]', target: 'memory', onMissing: 'keep', bespoke: { import: IMPORT_MEMORY } },

  // ── files and folders ─────────────────────────────────────────────────
  { entity: 'file', path: 'linkedTo[]', target: 'any', onMissing: 'keep', bespoke: { import: LINKED_TO, restore: LINKED_TO } },
  { entity: 'file', path: 'tags[]', target: 'any', onMissing: 'keep', bespoke: { import: 'importFiles: through the tag map', restore: LINKED_TO } },
  { entity: 'file', path: 'projectId', target: 'project', onMissing: 'keep' },
  { entity: 'folder', path: 'parentFolderId', target: 'folder', onMissing: 'keep' },
  { entity: 'folder', path: 'projectId', target: 'project', onMissing: 'keep' },

  // ── settings ──────────────────────────────────────────────────────────
  { entity: 'chatSettings', path: 'cheapLLMSettings.userDefinedProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'cheapLLMSettings.defaultCheapProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'cheapLLMSettings.outfitSelectionProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'imageDescriptionProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'defaultRoleplayTemplateId', target: 'roleplayTemplate', onMissing: 'null' },
  { entity: 'chatSettings', path: 'storyBackgroundsSettings.defaultImageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'wardrobeImageSettings.imageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'conciergeSettings.uncensoredTextProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'conciergeSettings.uncensoredImageProfileId', target: 'imageProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'conciergeSettings.uncensoredVisionProfileId', target: 'connectionProfile', onMissing: 'null' },
  { entity: 'chatSettings', path: 'conciergeSettings.imagePromptProfileId', target: 'connectionProfile', onMissing: 'null' },

  // ── logs (historical records: a missing target is still history) ──────
  { entity: 'llmLog', path: 'messageId', target: 'message', onMissing: 'keep' },
  { entity: 'llmLog', path: 'chatId', target: 'chat', onMissing: 'keep' },
  { entity: 'llmLog', path: 'characterId', target: 'character', onMissing: 'keep' },
  { entity: 'llmLog', path: 'connectionProfileId', target: 'connectionProfile', onMissing: 'keep' },
  { entity: 'llmLog', path: 'imageProfileId', target: 'imageProfile', onMissing: 'keep' },
  { entity: 'logEntry', path: 'chatId', target: 'chat', onMissing: 'keep' },
  { entity: 'logEntry', path: 'characterId', target: 'character', onMissing: 'keep' },

  // ── chat sidecars ─────────────────────────────────────────────────────
  { entity: 'chatDocument', path: 'chatId', target: 'chat', onMissing: 'drop-row' },
  { entity: 'chatInform', path: 'chatId', target: 'chat', onMissing: 'drop-row', bespoke: { import: IMPORT_INFORM } },
  { entity: 'chatInform', path: 'participantId', target: 'participant', onMissing: 'keep', bespoke: { import: IMPORT_INFORM } },
  { entity: 'chatInform', path: 'recordMessageId', target: 'message', onMissing: 'keep', bespoke: { import: IMPORT_INFORM } },
  { entity: 'chatInform', path: 'consumedByMessageId', target: 'message', onMissing: 'keep', bespoke: { import: IMPORT_INFORM } },
  { entity: 'conversationAnnotation', path: 'chatId', target: 'chat', onMissing: 'drop-row' },
  { entity: 'conversationAnnotation', path: 'sourceMessageId', target: 'message', onMissing: 'null' },
  { entity: 'conversationChunk', path: 'chatId', target: 'chat', onMissing: 'drop-row' },
  { entity: 'conversationChunk', path: 'messageIds[]', target: 'message', onMissing: 'keep' },
  { entity: 'wardrobeHistory', path: 'chatId', target: 'chat', onMissing: 'drop-row' },
  { entity: 'wardrobeHistory', path: 'characterId', target: 'character', onMissing: 'keep' },
  { entity: 'wardrobeHistory', path: 'actorCharacterId', target: 'character', onMissing: 'keep' },
  { entity: 'wardrobeHistory', path: 'slots.top[]', target: 'any', onMissing: 'keep', bespoke: { import: WARDROBE_ITEMS, restore: WARDROBE_ITEMS } },
  { entity: 'wardrobeHistory', path: 'slots.bottom[]', target: 'any', onMissing: 'keep', bespoke: { import: WARDROBE_ITEMS, restore: WARDROBE_ITEMS } },
  { entity: 'wardrobeHistory', path: 'slots.footwear[]', target: 'any', onMissing: 'keep', bespoke: { import: WARDROBE_ITEMS, restore: WARDROBE_ITEMS } },
  { entity: 'wardrobeHistory', path: 'slots.accessories[]', target: 'any', onMissing: 'keep', bespoke: { import: WARDROBE_ITEMS, restore: WARDROBE_ITEMS } },
  { entity: 'wardrobeHistory', path: 'slots.hair[]', target: 'any', onMissing: 'keep', bespoke: { import: WARDROBE_ITEMS, restore: WARDROBE_ITEMS } },
  { entity: 'avatarTimeline', path: 'chatId', target: 'chat', onMissing: 'drop-row' },
  { entity: 'avatarTimeline', path: 'characterId', target: 'character', onMissing: 'keep', bespoke: { restore: RESTORE_TIMELINE_CHARACTER } },
  { entity: 'avatarTimeline', path: 'imageId', target: 'any', onMissing: 'keep' },
  { entity: 'wardrobeWear', path: 'itemId', target: 'any', onMissing: 'keep', bespoke: { import: WARDROBE_ITEMS, restore: WARDROBE_ITEMS } },
  { entity: 'wardrobeWear', path: 'wearerCharacterId', target: 'character', onMissing: 'keep' },
  { entity: 'wardrobeWear', path: 'lastWornChatId', target: 'chat', onMissing: 'keep' },
  { entity: 'characterPluginData', path: 'characterId', target: 'character', onMissing: 'drop-row' },

  // ── embeddings ────────────────────────────────────────────────────────
  { entity: 'tfidfVocabulary', path: 'profileId', target: 'embeddingProfile', onMissing: 'drop-row' },
  { entity: 'embeddingStatus', path: 'entityId', target: 'any', onMissing: 'keep' },
  { entity: 'embeddingStatus', path: 'profileId', target: 'embeddingProfile', onMissing: 'drop-row' },

  // ── document stores ───────────────────────────────────────────────────
  // No drop-row on file or blob rows: restore pairs each with its bytes by index.
  { entity: 'docMountFolder', path: 'mountPointId', target: 'mountPoint', onMissing: 'drop-row' },
  { entity: 'docMountFolder', path: 'parentId', target: 'docMountFolder', onMissing: 'keep' },
  { entity: 'docMountFileLink', path: 'fileId', target: 'docMountFile', onMissing: 'drop-row' },
  { entity: 'docMountFileLink', path: 'mountPointId', target: 'mountPoint', onMissing: 'drop-row' },
  { entity: 'docMountFileLink', path: 'folderId', target: 'docMountFolder', onMissing: 'keep' },
  { entity: 'docMountChunk', path: 'linkId', target: 'docMountFileLink', onMissing: 'drop-row' },
  { entity: 'docMountChunk', path: 'mountPointId', target: 'mountPoint', onMissing: 'drop-row' },
  { entity: 'docMountDocument', path: 'fileId', target: 'docMountFile', onMissing: 'drop-row' },
  { entity: 'docMountBlob', path: 'fileId', target: 'docMountFile', onMissing: 'keep' },
  { entity: 'projectDocMountLink', path: 'projectId', target: 'project', onMissing: 'drop-row' },
  { entity: 'projectDocMountLink', path: 'mountPointId', target: 'mountPoint', onMissing: 'drop-row' },
  { entity: 'groupDocMountLink', path: 'groupId', target: 'group', onMissing: 'drop-row' },
  { entity: 'groupDocMountLink', path: 'mountPointId', target: 'mountPoint', onMissing: 'drop-row' },
  { entity: 'groupCharacterMember', path: 'groupId', target: 'group', onMissing: 'drop-row' },
  { entity: 'groupCharacterMember', path: 'characterId', target: 'character', onMissing: 'drop-row' },
];

/**
 * UUID-typed fields that are deliberately not references to remap. Every
 * row's own `id` and `userId` (the owner, set by the receiving side) are
 * exempt everywhere and not repeated here.
 */
export const ID_FIELD_EXEMPTIONS: ReadonlyArray<{ entity: IdEntity; path: string; reason: string }> = [
  { entity: 'character', path: 'defaultScenarioId', reason: 'a vault item id (frontmatter `id:`); travels verbatim with the vault' },
  { entity: 'character', path: 'defaultSystemPromptId', reason: 'a vault item id (frontmatter `id:`); travels verbatim with the vault' },
  { entity: 'character', path: 'scenarios[].id', reason: 'a vault item id; travels verbatim with the vault' },
  { entity: 'character', path: 'systemPrompts[].id', reason: 'a vault item id; travels verbatim with the vault' },
  { entity: 'character', path: 'physicalDescription.id', reason: 'the description\'s own id, not a reference' },
  { entity: 'chat', path: 'participants[].selectedSystemPromptId', reason: 'a vault item id; travels verbatim with the vault' },
  { entity: 'chat', path: 'currentRunId', reason: 'an opaque stale-run token, not a row reference' },
  { entity: 'message', path: 'routeTrail[].profileId', reason: 'a historical record; the trail carries the name and model for a profile that is gone' },
  { entity: 'connectionProfile', path: 'apiKeyId', reason: 'keys never travel; a created profile has none and an overwritten one keeps its own' },
  { entity: 'imageProfile', path: 'apiKeyId', reason: 'keys never travel' },
  { entity: 'embeddingProfile', path: 'apiKeyId', reason: 'keys never travel' },
  { entity: 'chatInform', path: 'batchId', reason: 'a group key, not a row reference (restore reissues it consistently)' },
  { entity: 'llmLog', path: 'autonomousRunId', reason: 'an opaque run token, not a row reference' },
  { entity: 'llmLog', path: 'storytellerRoundId', reason: 'an opaque round token, not a row reference' },
  { entity: 'docMountFileLink', path: 'linkGroupId', reason: 'a hard-link group key, not a row reference (restore reissues it consistently)' },
];

/** What a resolver knows about an id: its id in the destination, or nothing. */
export type IdResolver = (target: IdTarget, id: string) => string | undefined;

export interface RemapEntityOptions {
  side: IdSide;
  /** Only fields aimed at these targets. */
  targets?: ReadonlySet<IdTarget>;
}

export interface RemapEntityResult<T> {
  /** The remapped row, or null when a `drop-row` field did not resolve. */
  row: T | null;
  /** Top-level keys whose value changed. */
  changed: Set<string>;
  /** Unresolved ids that were cleared, dropped from an array, or dropped the row. */
  unresolved: Array<{ path: string; id: string; onMissing: OnMissing }>;
}

const SWIPE_PREFIX = 'swipe-';
const LEGACY_PLUGIN_TEMPLATE_PREFIX = 'plugin:';

/** The table entries for one entity, on one side. */
export function idFieldsFor(entity: IdEntity, options: RemapEntityOptions): IdField[] {
  return ID_FIELDS.filter(
    (field) =>
      field.entity === entity &&
      !field.bespoke?.[options.side] &&
      (!options.targets || options.targets.has(field.target))
  );
}

/** Resolve one id under a field's encoding: the new value, or undefined. */
function resolveValue(field: IdField, value: string, resolve: IdResolver): string | undefined {
  if (field.encoding === 'swipe-prefix') {
    // A key that is not `swipe-<id>` is opaque: it resolves to itself.
    if (!value.startsWith(SWIPE_PREFIX)) return value;
    const mapped = resolve(field.target, value.slice(SWIPE_PREFIX.length));
    return mapped ? `${SWIPE_PREFIX}${mapped}` : undefined;
  }
  return resolve(field.target, value);
}

/**
 * Remap every listed id field of one row. Pure: returns a new row (copied
 * only along the paths it changes) and never touches the database.
 */
export function remapEntity<T extends object>(
  entity: IdEntity,
  row: T,
  resolve: IdResolver,
  options: RemapEntityOptions
): RemapEntityResult<T> {
  const changed = new Set<string>();
  const unresolved: RemapEntityResult<T>['unresolved'] = [];
  let dropRow = false;
  let next: Record<string, unknown> = row as Record<string, unknown>;

  /** Rewrite one id; `null` means "remove it" (cleared field or dropped element). */
  const rewriteId = (field: IdField, id: string): string | null => {
    const mapped = resolveValue(field, id, resolve);
    if (mapped !== undefined) return mapped;
    // A legacy `plugin:*` template reference is opaque: it was never an id
    // either side issued, so it is never cleared.
    if (field.onMissing === 'keep' || (field.target === 'roleplayTemplate' && id.startsWith(LEGACY_PLUGIN_TEMPLATE_PREFIX))) return id;
    unresolved.push({ path: field.path, id, onMissing: field.onMissing });
    if (field.onMissing === 'drop-row') dropRow = true;
    return null;
  };

  /** Rewrite the value at the end of a path (a single id or an id array). */
  const rewriteLeaf = (field: IdField, value: unknown, isArray: boolean): unknown => {
    if (field.encoding === 'json-array') {
      if (typeof value !== 'string') return value;
      try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return value;
        const ids = (parsed as string[]).map((id) => rewriteId(field, id)).filter((id): id is string => id !== null);
        const encoded = JSON.stringify(ids);
        return encoded === JSON.stringify(parsed) ? value : encoded;
      } catch {
        return value;
      }
    }
    if (isArray) {
      if (!Array.isArray(value)) return value;
      let differs = false;
      const out: unknown[] = [];
      for (const element of value) {
        if (typeof element !== 'string') {
          out.push(element);
          continue;
        }
        const rewritten = rewriteId(field, element);
        if (rewritten !== element) differs = true;
        if (rewritten !== null) out.push(rewritten);
      }
      return differs ? out : value;
    }
    if (typeof value !== 'string' || value.length === 0) return value;
    return rewriteId(field, value);
  };

  /** Walk `segments` into `node`, returning a copy only if something changed. */
  const walk = (field: IdField, node: unknown, segments: string[]): unknown => {
    if (node === null || node === undefined || typeof node !== 'object') return node;
    const [head, ...rest] = segments;
    const isArray = head.endsWith('[]');
    const key = isArray ? head.slice(0, -2) : head;
    const container = node as Record<string, unknown>;
    if (!(key in container)) return node;
    const current = container[key];

    let replacement: unknown;
    if (rest.length === 0) {
      replacement = rewriteLeaf(field, current, isArray);
    } else if (isArray) {
      if (!Array.isArray(current)) return node;
      let differs = false;
      const out = current.map((element) => {
        const rewritten = walk(field, element, rest);
        if (rewritten !== element) differs = true;
        return rewritten;
      });
      replacement = differs ? out : current;
    } else {
      replacement = walk(field, current, rest);
    }

    if (replacement === current) return node;
    return { ...container, [key]: replacement };
  };

  for (const field of idFieldsFor(entity, options)) {
    const segments = field.path.split('.');
    const updated = walk(field, next, segments) as Record<string, unknown>;
    if (updated !== next) {
      const top = segments[0].replace(/\[\]$/, '');
      changed.add(top);
      next = updated;
    }
  }

  if (unresolved.length > 0) {
    moduleLogger.debug('Unresolved ids under the id-field table', {
      entity,
      side: options.side,
      unresolved: unresolved.map(({ path, onMissing }) => `${path}:${onMissing}`),
      droppedRow: dropRow,
    });
  }

  return { row: dropRow ? null : (next as T), changed, unresolved };
}

/** Remap a collection, dropping rows a `drop-row` field rejected. */
export function remapEntities<T extends object>(
  entity: IdEntity,
  rows: readonly T[],
  resolve: IdResolver,
  options: RemapEntityOptions
): T[] {
  const out: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const result = remapEntity(entity, row, resolve, options);
    if (result.row) out.push(result.row);
    else dropped++;
  }
  if (dropped > 0) {
    moduleLogger.info('Dropped rows whose required reference did not resolve', { entity, side: options.side, dropped });
  }
  return out;
}

/** Pick the changed top-level fields of a remapped row, for an update patch. */
export function changedFields<T extends object>(row: T, changed: ReadonlySet<string>): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const key of changed) patch[key] = (row as Record<string, unknown>)[key];
  return patch as Partial<T>;
}
