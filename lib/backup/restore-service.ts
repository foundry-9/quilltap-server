/**
 * Restore Service
 *
 * Restores user data from a backup ZIP archive to the database and file storage.
 * Uses shell `unzip` to extract to a temp directory on disk — no in-memory zip
 * operations to avoid OOM in memory-constrained VMs.
 *
 * Supports two modes:
 * - 'replace': Deletes existing data and restores from backup
 * - 'new-account': Regenerates all UUIDs and imports to a new account
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import { getNpmPluginsDir, getThemesDir } from '@/lib/paths';
import { isLLMLogsDegraded } from '@/lib/database/backends/sqlite/llm-logs-client';
import { UuidRemapper } from './uuid-remapper';
import { rawQuery } from '@/lib/database/manager';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import type {
  BackupManifest,
  BackupData,
  RestoreOptions,
  RestoreSummary,
  ChatWithMessages,
  InstanceSettingRow,
  SerializedVectorEntry,
  SerializedConversationChunk,
  SerializedDocMountChunk,
} from './types';
import type {
  Character,
  ChatSettings,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  FileEntry,
  Folder,
  ChatParticipantBase,
  PhysicalDescription,
  PromptTemplate,
  RoleplayTemplate,
  ProviderModel,
  Project,
  LLMLog,
  PluginConfig,
  CharacterPluginData,
  ConversationAnnotation,
  ConversationChunk,
  VectorIndexMeta,
  TfidfVocabulary,
  EmbeddingStatus,
} from '@/lib/schemas/types';
import type { WardrobeItem, WardrobeItemType, EquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import type {
  DocMountPoint,
  DocMountFolder,
  DocMountFile,
  DocMountFileLink,
  DocMountDocument,
  DocMountBlobMetadata,
  ProjectDocMountLink,
} from '@/lib/schemas/mount-index.types';

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
 * Legacy outfit preset shape — only used to fold old backups into composites.
 * Kept local since the type is otherwise gone from the data model.
 */
interface LegacyOutfitPreset {
  id: string;
  characterId: string | null;
  name: string;
  description: string | null;
  slots: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Legacy per-character equipped slot shape from pre-rework backups: each slot
 * holds a single UUID or null instead of an array of UUIDs.
 */
interface LegacyEquippedSlots {
  top: string | null;
  bottom: string | null;
  footwear: string | null;
  accessories: string | null;
}

/**
 * Slot-order for stable componentItemIds derivation when folding legacy presets.
 */
const LEGACY_SLOT_ORDER: ReadonlyArray<keyof LegacyOutfitPreset['slots']> = [
  'top',
  'bottom',
  'footwear',
  'accessories',
];

/**
 * Compute the deduped, ordered list of slot types covered by the non-null
 * components of a legacy preset. Order follows LEGACY_SLOT_ORDER.
 */
function dedupeAndOrderSlotTypes(
  slots: LegacyOutfitPreset['slots']
): WardrobeItemType[] {
  const seen = new Set<WardrobeItemType>();
  const out: WardrobeItemType[] = [];
  for (const slot of LEGACY_SLOT_ORDER) {
    if (slots[slot] && !seen.has(slot)) {
      seen.add(slot);
      out.push(slot);
    }
  }
  // A composite must always declare at least one type. If every slot is null
  // (a malformed legacy preset), fall back to "accessories" so the schema
  // validation still passes.
  if (out.length === 0) out.push('accessories');
  return out;
}

/**
 * Collect non-null component IDs from the legacy slot map in slot order.
 */
function orderedComponentIds(slots: LegacyOutfitPreset['slots']): string[] {
  const ids: string[] = [];
  for (const slot of LEGACY_SLOT_ORDER) {
    const id = slots[slot];
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Detect the per-character equipped-slot shape and upgrade legacy `id|null`
 * shapes to `id ? [id] : []`. Idempotent: already-array shapes pass through.
 */
function upgradeLegacyEquippedSlots(
  raw: LegacyEquippedSlots | EquippedSlots | null | undefined
): EquippedSlots | null {
  if (!raw) return null;
  const upgrade = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
    if (typeof val === 'string') return [val];
    return [];
  };
  return {
    top: upgrade((raw as Record<string, unknown>).top),
    bottom: upgrade((raw as Record<string, unknown>).bottom),
    footwear: upgrade((raw as Record<string, unknown>).footwear),
    accessories: upgrade((raw as Record<string, unknown>).accessories),
  };
}

const execFileAsync = promisify(execFile);

const moduleLogger = logger.child({ module: 'backup:restore-service' });

/**
 * Recursively removes a directory and all its contents
 */
async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    moduleLogger.warn('Failed to clean up temp directory', {
      dirPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Extracts a backup ZIP to a temp directory using shell `unzip`
 * and finds the root folder name inside.
 *
 * @returns The extract directory path and the root folder name
 */
async function extractZipToTemp(zipPath: string): Promise<{ extractDir: string; rootFolder: string }> {
  const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quilltap-restore-'));

  moduleLogger.debug('Extracting backup zip', { zipPath, extractDir });

  await execFileAsync('unzip', ['-o', zipPath, '-d', extractDir], {
    maxBuffer: 10 * 1024 * 1024,
  });

  // Find the root folder (quilltap-backup-{timestamp})
  const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
  const rootEntry = entries.find(
    (e) => e.isDirectory() && e.name.startsWith('quilltap-backup-')
  );

  if (!rootEntry) {
    // Check if manifest.json is directly in the extract dir (flat zip)
    try {
      await fs.promises.access(path.join(extractDir, 'manifest.json'));
      // Flat structure — the extractDir itself is the root
      return { extractDir, rootFolder: '' };
    } catch {
      await cleanupDir(extractDir);
      throw new Error('Invalid backup: no quilltap-backup-* folder or manifest.json found');
    }
  }

  return { extractDir, rootFolder: rootEntry.name };
}

/**
 * Reads and parses a JSON file from the extracted backup directory.
 * Returns the parsed data or throws if the file is required but missing.
 *
 * Use only for small documents (e.g. the manifest); use readJsonArrayFile for
 * potentially large arrays so we never load the whole file into a single string.
 */
async function readJsonFile<T>(basePath: string, relativePath: string): Promise<T> {
  const filePath = path.join(basePath, relativePath);
  const content = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

/**
 * Streams a JSON-array file from disk, parsing one element at a time.
 *
 * Why: `fs.readFile(..., 'utf8')` and `JSON.parse` both materialize the entire
 * payload as a single string, and V8 caps strings at ~512 MB. With full-history
 * llm_logs the encoded array can exceed that limit, so a naive read throws
 * `ERR_STRING_TOO_LONG` or `RangeError: Invalid string length`.
 *
 * The scanner is JSON-aware (tracks string/escape state and brace/bracket depth)
 * and assumes top-level elements are objects or arrays — which matches every array
 * we write in `backup-service.ts`. It does not support top-level scalar elements.
 *
 * The resulting array still lives in memory; only the wire-format string is
 * avoided. Per-element memory is bounded by individual row size (a few MB at most
 * for our largest llm_logs entries).
 */
async function readJsonArrayFile<T>(basePath: string, relativePath: string): Promise<T[]> {
  const filePath = path.join(basePath, relativePath);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });

  const result: T[] = [];
  let started = false;
  let finished = false;
  let inElement = false;
  let elementBuf = '';
  let depth = 0;
  let inString = false;
  let escape = false;

  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  for await (const chunk of stream as AsyncIterable<string>) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];

      if (!started) {
        if (c === '[') {
          started = true;
        } else if (!isWs(c)) {
          throw new Error(`readJsonArrayFile: expected '[' at start of ${relativePath}, got ${JSON.stringify(c)}`);
        }
        continue;
      }

      if (finished) {
        if (!isWs(c)) {
          throw new Error(`readJsonArrayFile: unexpected character after array end in ${relativePath}: ${JSON.stringify(c)}`);
        }
        continue;
      }

      if (inElement) {
        elementBuf += c;

        if (escape) {
          escape = false;
          continue;
        }
        if (inString) {
          if (c === '\\') escape = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') {
          inString = true;
          continue;
        }
        if (c === '{' || c === '[') {
          depth++;
          continue;
        }
        if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) {
            result.push(JSON.parse(elementBuf) as T);
            elementBuf = '';
            inElement = false;
          }
        }
        continue;
      }

      // Between elements: look for next element start or array close.
      if (c === ']') {
        finished = true;
        continue;
      }
      if (c === ',' || isWs(c)) continue;

      if (c !== '{' && c !== '[') {
        throw new Error(
          `readJsonArrayFile: only object/array elements supported at top level (${relativePath}), got ${JSON.stringify(c)}`
        );
      }
      inElement = true;
      elementBuf = c;
      depth = 1;
    }
  }

  if (!started) {
    throw new Error(`readJsonArrayFile: empty file or no array in ${relativePath}`);
  }
  if (!finished) {
    throw new Error(`readJsonArrayFile: unexpected end of input in ${relativePath}`);
  }

  return result;
}

/**
 * Reads and parses an optional JSON file, returning a fallback if missing.
 */
async function readJsonFileOptional<T>(basePath: string, relativePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(basePath, relativePath);
  } catch {
    return fallback;
  }
}

/**
 * Streaming variant of readJsonFileOptional for arrays. Returns the fallback if
 * the file is missing or unreadable; surfaces parse errors otherwise.
 */
async function readJsonArrayFileOptional<T>(
  basePath: string,
  relativePath: string,
  fallback: T[]
): Promise<T[]> {
  const filePath = path.join(basePath, relativePath);
  try {
    await fs.promises.access(filePath);
  } catch {
    return fallback;
  }
  return readJsonArrayFile<T>(basePath, relativePath);
}

/**
 * Parses a backup ZIP file by extracting to disk and reading JSON data files.
 *
 * @param zipPath - Path to the backup ZIP file on disk
 * @returns The parsed backup data and the extraction directory (caller must clean up)
 */
export async function parseBackupZip(zipPath: string): Promise<{ data: BackupData; extractDir: string; rootFolder: string }> {
  const { extractDir, rootFolder } = await extractZipToTemp(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    // Read all data files from disk. Arrays go through readJsonArrayFile so a
    // multi-hundred-MB llm-logs.json doesn't blow past V8's max-string limit.
    const manifest = await readJsonFile<BackupManifest>(rootPath, 'manifest.json');
    const characters = await readJsonArrayFile<Character>(rootPath, 'data/characters.json');
    const chats = await readJsonArrayFile<ChatWithMessages>(rootPath, 'data/chats.json');
    // Back-compat: pre-rework backups stored each character's equippedOutfit slot
    // values as a single UUID-or-null. Upgrade them to the new array shape so the
    // standard restore path consumes a uniform structure.
    let chatsEquippedOutfitUpgraded = 0;
    for (const chat of chats) {
      const equipped = (chat as unknown as { equippedOutfit?: Record<string, LegacyEquippedSlots | EquippedSlots> | null })
        .equippedOutfit;
      if (equipped && typeof equipped === 'object') {
        let mutated = false;
        for (const [characterId, slots] of Object.entries(equipped)) {
          // If any slot is a string (rather than an array), it's the legacy shape.
          const looksLegacy =
            slots !== null &&
            typeof slots === 'object' &&
            (typeof (slots as Record<string, unknown>).top === 'string' ||
              typeof (slots as Record<string, unknown>).bottom === 'string' ||
              typeof (slots as Record<string, unknown>).footwear === 'string' ||
              typeof (slots as Record<string, unknown>).accessories === 'string' ||
              // Or null in any slot — old shape uses null where new shape uses [].
              (slots as Record<string, unknown>).top === null ||
              (slots as Record<string, unknown>).bottom === null ||
              (slots as Record<string, unknown>).footwear === null ||
              (slots as Record<string, unknown>).accessories === null);
          if (looksLegacy) {
            const upgraded = upgradeLegacyEquippedSlots(slots as LegacyEquippedSlots);
            if (upgraded) {
              equipped[characterId] = upgraded;
              mutated = true;
            }
          }
        }
        if (mutated) chatsEquippedOutfitUpgraded++;
      }
    }
    if (chatsEquippedOutfitUpgraded > 0) {
      moduleLogger.info('Upgraded legacy per-character equippedOutfit slot shape', {
        chatsTouched: chatsEquippedOutfitUpgraded,
      });
    }
    const tags = await readJsonArrayFile<Tag>(rootPath, 'data/tags.json');
    const connectionProfiles = await readJsonArrayFile<ConnectionProfile>(rootPath, 'data/connection-profiles.json');
    const imageProfiles = await readJsonArrayFile<ImageProfile>(rootPath, 'data/image-profiles.json');
    const embeddingProfiles = await readJsonArrayFile<EmbeddingProfile>(rootPath, 'data/embedding-profiles.json');
    const memories = await readJsonArrayFile<Memory>(rootPath, 'data/memories.json');
    const files = await readJsonArrayFile<FileEntry>(rootPath, 'data/files.json');
    // Templates are optional for backwards compatibility with older backups
    const promptTemplates = await readJsonArrayFileOptional<PromptTemplate>(rootPath, 'data/prompt-templates.json', []);
    const roleplayTemplates = await readJsonArrayFileOptional<RoleplayTemplate>(rootPath, 'data/roleplay-templates.json', []);
    // Provider models are optional for backwards compatibility with older backups
    const providerModels = await readJsonArrayFileOptional<ProviderModel>(rootPath, 'data/provider-models.json', []);
    // Projects are optional for backwards compatibility with older backups
    const projects = await readJsonArrayFileOptional<Project>(rootPath, 'data/projects.json', []);
    // LLM logs are optional for backwards compatibility with older backups
    const llmLogs = await readJsonArrayFileOptional<LLMLog>(rootPath, 'data/llm-logs.json', []);
    // Plugin configs are optional for backwards compatibility with older backups
    const pluginConfigs = await readJsonArrayFileOptional<PluginConfig>(rootPath, 'data/plugin-configs.json', []);
    // Chat settings are optional for backwards compatibility with older backups
    const chatSettings = await readJsonArrayFileOptional<ChatSettings>(rootPath, 'data/chat-settings.json', []);
    // Folders are optional for backwards compatibility with older backups
    const folders = await readJsonArrayFileOptional<Folder>(rootPath, 'data/folders.json', []);
    // Wardrobe items are optional for backwards compatibility
    let wardrobeItems = await readJsonArrayFileOptional<WardrobeItem>(rootPath, 'data/wardrobe-items.json', []);
    // Back-compat: pre-rework backups stored outfit presets as a separate entity in
    // data/outfit-presets.json. New backups never write that file, but we still
    // read it from older archives and fold each preset into a composite WardrobeItem
    // so the standard wardrobe-restore path picks them up. We preserve the
    // original preset id as the new composite's id; any pre-rework reference
    // (chats, exports) stays valid.
    const legacyOutfitPresets = await readJsonArrayFileOptional<LegacyOutfitPreset>(
      rootPath,
      'data/outfit-presets.json',
      []
    );
    if (legacyOutfitPresets.length > 0) {
      const foldedComposites: WardrobeItem[] = legacyOutfitPresets.map((preset) => ({
        id: preset.id,
        characterId: preset.characterId,
        title: preset.name,
        description: preset.description,
        types: dedupeAndOrderSlotTypes(preset.slots),
        componentItemIds: orderedComponentIds(preset.slots),
        appropriateness: null,
        isDefault: false,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: preset.createdAt,
        updatedAt: preset.updatedAt,
      }));
      moduleLogger.info('Folded legacy outfit presets into composite wardrobe items', {
        legacyPresetCount: legacyOutfitPresets.length,
        existingWardrobeItemCount: wardrobeItems.length,
      });
      wardrobeItems = [...wardrobeItems, ...foldedComposites];
    }
    // Character plugin data and conversation annotations are optional for backwards compatibility
    const characterPluginData = await readJsonArrayFileOptional<CharacterPluginData>(rootPath, 'data/character-plugin-data.json', []);
    const conversationAnnotations = await readJsonArrayFileOptional<ConversationAnnotation>(rootPath, 'data/conversation-annotations.json', []);

    // Format-3 additions (optional so older backups still load).
    const chatDocuments = await readJsonArrayFileOptional<ChatDocument>(rootPath, 'data/chat-documents.json', []);
    const instanceSettings = await readJsonArrayFileOptional<InstanceSettingRow>(rootPath, 'data/instance-settings.json', []);
    const embeddingStatus = await readJsonArrayFileOptional<EmbeddingStatus>(rootPath, 'data/embedding-status.json', []);
    const conversationChunks = await readJsonArrayFileOptional<SerializedConversationChunk>(rootPath, 'data/conversation-chunks.json', []);
    const tfidfVocabularies = await readJsonArrayFileOptional<TfidfVocabulary>(rootPath, 'data/tfidf-vocabularies.json', []);
    const vectorIndexMetas = await readJsonArrayFileOptional<VectorIndexMeta>(rootPath, 'data/vector-index-metas.json', []);
    const vectorEntries = await readJsonArrayFileOptional<SerializedVectorEntry>(rootPath, 'data/vector-entries.json', []);
    const docMountPoints = await readJsonArrayFileOptional<DocMountPoint>(rootPath, 'data/doc-mount-points.json', []);
    const docMountFolders = await readJsonArrayFileOptional<DocMountFolder>(rootPath, 'data/doc-mount-folders.json', []);
    const docMountFiles = await readJsonArrayFileOptional<DocMountFile>(rootPath, 'data/doc-mount-files.json', []);
    const docMountFileLinks = await readJsonArrayFileOptional<DocMountFileLink>(rootPath, 'data/doc-mount-file-links.json', []);
    const docMountChunks = await readJsonArrayFileOptional<SerializedDocMountChunk>(rootPath, 'data/doc-mount-chunks.json', []);
    const docMountDocuments = await readJsonArrayFileOptional<DocMountDocument>(rootPath, 'data/doc-mount-documents.json', []);
    const docMountBlobs = await readJsonArrayFileOptional<DocMountBlobMetadata>(rootPath, 'data/doc-mount-blobs.json', []);
    const projectDocMountLinks = await readJsonArrayFileOptional<ProjectDocMountLink>(rootPath, 'data/project-doc-mount-links.json', []);

    moduleLogger.info('Parsed backup ZIP', {
      version: manifest.version,
      createdAt: manifest.createdAt,
      counts: manifest.counts,
    });

    const data: BackupData = {
      manifest,
      characters,
      chats,
      tags,
      connectionProfiles,
      imageProfiles,
      embeddingProfiles,
      memories,
      files,
      promptTemplates,
      roleplayTemplates,
      providerModels,
      projects,
      llmLogs,
      pluginConfigs,
      chatSettings,
      folders,
      wardrobeItems,
      characterPluginData,
      conversationAnnotations,
      chatDocuments,
      instanceSettings,
      embeddingStatus,
      conversationChunks,
      tfidfVocabularies,
      vectorIndexMetas,
      vectorEntries,
      docMountPoints,
      docMountFolders,
      docMountFiles,
      docMountFileLinks,
      docMountChunks,
      docMountDocuments,
      docMountBlobs,
      projectDocMountLinks,
    };

    return { data, extractDir, rootFolder };
  } catch (error) {
    // Clean up on parse failure
    await cleanupDir(extractDir);
    throw error;
  }
}

/**
 * Gets a file from the extracted backup directory by its metadata.
 * Returns the file contents as a Buffer, or null if not found.
 * Only one file is in memory at a time.
 */
export async function getFileFromExtractedBackup(
  rootPath: string,
  file: FileEntry,
  backupFormat?: number
): Promise<Buffer | null> {
  // New format (backupFormat: 2): files stored by storageKey path
  if (backupFormat === 2 && file.storageKey) {
    const newFormatPath = path.join(rootPath, 'files', file.storageKey);
    try {
      await fs.promises.access(newFormatPath);
      return await fs.promises.readFile(newFormatPath);
    } catch {
      // Fall through to old format as fallback
    }
  }

  // Old format (backupFormat: 1 or unset): files/{CATEGORY}/{fileId}_{originalFilename}
  const oldFormatPath = path.join(rootPath, 'files', file.category, `${file.id}_${file.originalFilename}`);
  try {
    await fs.promises.access(oldFormatPath);
    return await fs.promises.readFile(oldFormatPath);
  } catch {
    moduleLogger.warn('File not found in extracted backup', {
      fileId: file.id,
      triedPaths: backupFormat === 2
        ? [path.join('files', file.storageKey || ''), path.join('files', file.category, `${file.id}_${file.originalFilename}`)]
        : [path.join('files', file.category, `${file.id}_${file.originalFilename}`)],
    });
    return null;
  }
}

/**
 * Counts npm plugin directories in the extracted backup
 */
async function countNpmPluginsInExtractedBackup(rootPath: string): Promise<number> {
  const pluginsPath = path.join(rootPath, 'plugins', 'npm');

  try {
    const entries = await fs.promises.readdir(pluginsPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * Previews what will be restored without actually restoring.
 * Extracts the zip to a temp directory, counts entities, then cleans up.
 */
export async function previewRestore(zipPath: string): Promise<RestoreSummary> {
  const { data, extractDir, rootFolder } = await parseBackupZip(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    const totalMessages = data.chats.reduce((sum, chat) => sum + chat.messages.length, 0);
    const npmPluginCount = await countNpmPluginsInExtractedBackup(rootPath);

    return {
      characters: data.characters.length,
      chats: data.chats.length,
      messages: totalMessages,
      tags: data.tags.length,
      files: data.files.length,
      memories: data.memories.length,
      profiles: {
        connection: data.connectionProfiles.length,
        image: data.imageProfiles.length,
        embedding: data.embeddingProfiles.length,
      },
      templates: {
        prompt: data.promptTemplates.length,
        roleplay: data.roleplayTemplates.length,
      },
      providerModels: data.providerModels.length,
      projects: data.projects.length,
      llmLogs: data.llmLogs.length,
      pluginConfigs: data.pluginConfigs?.length || 0,
      chatSettings: data.chatSettings?.length || 0,
      folders: data.folders?.length || 0,
      wardrobeItems: data.wardrobeItems?.length || 0,
      npmPlugins: npmPluginCount,
      characterPluginData: data.characterPluginData?.length || 0,
      conversationAnnotations: data.conversationAnnotations?.length || 0,
      userInstalledThemes: 0, // Counted after zip extraction; not shown in preview
      chatDocuments: data.chatDocuments?.length || 0,
      instanceSettings: data.instanceSettings?.length || 0,
      embeddingStatus: data.embeddingStatus?.length || 0,
      conversationChunks: data.conversationChunks?.length || 0,
      tfidfVocabularies: data.tfidfVocabularies?.length || 0,
      vectorIndexMetas: data.vectorIndexMetas?.length || 0,
      vectorEntries: data.vectorEntries?.length || 0,
      docMountPoints: data.docMountPoints?.length || 0,
      docMountFolders: data.docMountFolders?.length || 0,
      docMountFiles: data.docMountFiles?.length || 0,
      docMountFileLinks: data.docMountFileLinks?.length || 0,
      docMountChunks: data.docMountChunks?.length || 0,
      docMountDocuments: data.docMountDocuments?.length || 0,
      docMountBlobs: data.docMountBlobs?.length || 0,
      projectDocMountLinks: data.projectDocMountLinks?.length || 0,
      warnings: [],
    };
  } finally {
    await cleanupDir(extractDir);
  }
}

/**
 * Truncate the format-3 tables (mount-index + new main-DB tables) before a
 * replace-mode restore. Done via raw DELETEs because per-row repository
 * deletes are expensive at scale (especially vector_entries and
 * doc_mount_chunks). Each statement is independently guarded — if a table
 * doesn't exist on a very old database, the rest still run.
 */
async function clearFormat3Entities(): Promise<void> {
  const mainTables = [
    'chat_documents',
    'conversation_chunks',
    'tfidf_vocabularies',
    'embedding_status',
    'vector_entries',
    'vector_indices',
  ];
  for (const table of mainTables) {
    try {
      await rawQuery(`DELETE FROM "${table}"`);
    } catch (error) {
      moduleLogger.debug('Skipping table truncate (table missing or empty)', {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // instance_settings is special: we don't want to drop EVERYTHING since some
  // keys are written by startup migrations and aren't part of the backup. The
  // restore upserts each backup row by key, which is the right behavior. So
  // we leave the table alone here.

  if (isMountIndexDegraded()) return;
  const db = getRawMountIndexDatabase();
  if (!db) return;
  const mountTables = [
    'doc_mount_chunks',
    'doc_mount_blobs',
    'doc_mount_documents',
    'doc_mount_file_links',
    'doc_mount_files',
    'doc_mount_folders',
    'project_doc_mount_links',
    'doc_mount_points',
  ];
  for (const table of mountTables) {
    try {
      db.prepare(`DELETE FROM "${table}"`).run();
    } catch (error) {
      moduleLogger.debug('Skipping mount-index table truncate', {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Deletes all user data before restore (for 'replace' mode)
 * Also used for the "delete all data" feature
 */
async function deleteUserData(userId: string): Promise<void> {
  moduleLogger.info('Deleting existing user data for replace mode', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // Get all entities to delete
  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, promptTemplates, roleplayTemplates, projects, llmLogs, chatSettings, folders, wardrobeItems] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
      repos.llmLogs.findAll(10000), // High limit to get all user logs
      globalRepos.chatSettings.findByUserId(userId),
      globalRepos.folders.findByUserId(userId),
      globalRepos.wardrobe.findAll(),
    ]);

  // Delete memories for each character first
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    for (const memory of memories) {
      await repos.memories.delete(memory.id);
    }
  }

  // Delete all entities (including user-created templates, projects, and LLM logs)
  await Promise.all([
    ...characters.map((c) => repos.characters.delete(c.id)),
    ...chats.map((c) => repos.chats.delete(c.id)),
    ...tags.map((t) => repos.tags.delete(t.id)),
    ...connectionProfiles.map((cp) => repos.connections.delete(cp.id)),
    ...imageProfiles.map((ip) => repos.imageProfiles.delete(ip.id)),
    ...embeddingProfiles.map((ep) => repos.embeddingProfiles.delete(ep.id)),
    ...promptTemplates.map((pt) => globalRepos.promptTemplates.delete(pt.id)),
    ...roleplayTemplates.map((rt) => globalRepos.roleplayTemplates.delete(rt.id)),
    ...projects.map((p) => repos.projects.delete(p.id)),
    ...llmLogs.map((log) => repos.llmLogs.delete(log.id)),
    ...(chatSettings ? [globalRepos.chatSettings.delete(chatSettings.id)] : []),
    ...folders.map((f) => globalRepos.folders.delete(f.id)),
    ...wardrobeItems.map((w) => globalRepos.wardrobe.delete(w.id)),
  ]);

  // Delete files from storage
  for (const file of files) {
    try {
      if (file.storageKey) {
        await fileStorageManager.deleteFile(file);
      }
      await repos.files.delete(file.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete file during cleanup', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Bulk-delete format-3 entities so the restore can re-insert them with
  // their backup ids without colliding. Raw DELETEs because the row counts
  // (chunks, vectors, etc.) can be large and per-row cascades through the
  // repositories are slow.
  await clearFormat3Entities();

  moduleLogger.info('Deleted existing user data', {
    userId,
    deletedCounts: {
      characters: characters.length,
      chats: chats.length,
      tags: tags.length,
      files: files.length,
      connectionProfiles: connectionProfiles.length,
      imageProfiles: imageProfiles.length,
      embeddingProfiles: embeddingProfiles.length,
      promptTemplates: promptTemplates.length,
      roleplayTemplates: roleplayTemplates.length,
      projects: projects.length,
      llmLogs: llmLogs.length,
      chatSettings: chatSettings ? 1 : 0,
      folders: folders.length,
      wardrobeItems: wardrobeItems.length,
    },
  });
}

/**
 * Summary of deleted data counts
 */
export interface DeleteSummary {
  characters: number;
  chats: number;
  tags: number;
  files: number;
  memories: number;
  apiKeys: number;
  backups: number;
  projects: number;
  profiles: {
    connection: number;
    image: number;
    embedding: number;
  };
  templates: {
    prompt: number;
    roleplay: number;
  };
}

/**
 * Deletes all user data including API keys and backups
 * This is a complete account reset
 */
export async function deleteAllUserData(userId: string): Promise<DeleteSummary> {
  moduleLogger.info('Starting complete user data deletion', { userId });

  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  // First, count everything before deletion
  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, projects] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // List and count backups
  const allBackupFiles = files.filter(
    (f: FileEntry) => f.folderPath === '/backups' || f.originalFilename?.endsWith('.zip')
  );
  const backupsCount = allBackupFiles.length;

  // Now delete everything using the existing function (includes templates)
  await deleteUserData(userId);

  // Delete API keys
  for (const apiKey of apiKeys) {
    try {
      await repos.connections.deleteApiKey(apiKey.id);
    } catch (error) {
      moduleLogger.warn('Failed to delete API key', {
        apiKeyId: apiKey.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Delete backups from storage (note: already deleted by deleteUserData above)
  // but we log for clarity
  moduleLogger.info('Backups deleted with other files', {
    backupsCount,
  });

  const summary: DeleteSummary = {
    characters: characters.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupsCount,
    projects: projects.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
  };

  moduleLogger.info('Complete user data deletion finished', { userId, summary });

  return summary;
}

/**
 * Preview what will be deleted (counts only, no actual deletion)
 */
export async function previewDeleteAllUserData(userId: string): Promise<DeleteSummary> {
  const repos = getUserRepositories(userId);
  const globalRepos = getRepositories();

  const [characters, chats, tags, files, connectionProfiles, imageProfiles, embeddingProfiles, apiKeys, promptTemplates, roleplayTemplates, projects] =
    await Promise.all([
      repos.characters.findAll(),
      repos.chats.findAll(),
      repos.tags.findAll(),
      repos.files.findAll(),
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
      repos.connections.getAllApiKeys(),
      globalRepos.promptTemplates.findByUserId(userId),
      globalRepos.roleplayTemplates.findByUserId(userId),
      repos.projects.findAll(),
    ]);

  // Count memories
  let memoriesCount = 0;
  for (const character of characters) {
    const memories = await repos.memories.findByCharacterId(character.id);
    memoriesCount += memories.length;
  }

  // List and count backups from files
  const backupFiles = files.filter(
    (f: FileEntry) => f.folderPath === '/backups' || f.originalFilename?.endsWith('.zip')
  );

  return {
    characters: characters.length,
    chats: chats.length,
    tags: tags.length,
    files: files.length,
    memories: memoriesCount,
    apiKeys: apiKeys.length,
    backups: backupFiles.length,
    projects: projects.length,
    profiles: {
      connection: connectionProfiles.length,
      image: imageProfiles.length,
      embedding: embeddingProfiles.length,
    },
    templates: {
      prompt: promptTemplates.length,
      roleplay: roleplayTemplates.length,
    },
  };
}

/**
 * Remaps all UUIDs in the backup data for new-account mode
 */
function remapBackupData(
  data: BackupData,
  targetUserId: string,
  remapper: UuidRemapper
): BackupData {
  // Remap tags
  const remappedTags = data.tags.map((tag) => ({
    ...remapper.remapFields(tag, ['id']),
    userId: targetUserId,
  }));

  // Remap files
  // IMPORTANT: Chain remapFields → remapArrayFields so array spread doesn't overwrite remapped scalar fields
  const remappedFiles = data.files.map((file) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(file, ['id', 'projectId']),
      ['linkedTo', 'tags']
    ),
    userId: targetUserId,
  }));

  // Remap characters
  const remappedCharacters = data.characters.map((char) => {
    const remapped = {
      ...remapper.remapArrayFields(
        remapper.remapFields(char, ['id', 'defaultImageId', 'defaultConnectionProfileId', 'defaultPartnerId', 'defaultImageProfileId']),
        ['tags']
      ),
      userId: targetUserId,
    };
    // Handle partnerLinks array of objects (new format)
    if (remapped.partnerLinks) {
      remapped.partnerLinks = remapped.partnerLinks.map((link: { partnerId: string; isDefault: boolean }) => ({
        ...link,
        partnerId: remapper.remap(link.partnerId),
      }));
    }
    // Handle personaLinks backwards compatibility (old backup format)
    const legacy = remapped as Record<string, unknown>;
    if (legacy.personaLinks && !remapped.partnerLinks) {
      remapped.partnerLinks = (legacy.personaLinks as Array<{ personaId: string; isDefault: boolean }>).map((link) => ({
        partnerId: remapper.remap(link.personaId),
        isDefault: link.isDefault,
      }));
      delete legacy.personaLinks;
    }
    // Handle avatarOverrides
    if (remapped.avatarOverrides) {
      remapped.avatarOverrides = remapped.avatarOverrides.map((override: { chatId: string; imageId: string }) => ({
        chatId: remapper.remap(override.chatId),
        imageId: remapper.remap(override.imageId),
      }));
    }
    // Handle physicalDescription: backups may carry either the legacy plural
    // array (`physicalDescriptions`) or the new singular field
    // (`physicalDescription`). Collapse to the first record either way.
    const legacyRecord = legacy as Record<string, unknown>;
    if (Array.isArray(legacyRecord.physicalDescriptions)) {
      const first = legacyRecord.physicalDescriptions[0] as PhysicalDescription | undefined;
      remapped.physicalDescription = first
        ? { ...first, id: remapper.remap(first.id) }
        : null;
      delete legacyRecord.physicalDescriptions;
    } else if (remapped.physicalDescription) {
      remapped.physicalDescription = {
        ...remapped.physicalDescription,
        id: remapper.remap(remapped.physicalDescription.id),
      };
    }
    // Legacy `clothingRecords` — the table is gone; drop silently so old
    // backups still restore.
    if (legacyRecord.clothingRecords) {
      delete legacyRecord.clothingRecords;
    }
    return remapped as Character;
  });


  // Remap connection profiles
  const remappedConnectionProfiles = data.connectionProfiles.map((profile) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(profile, ['id', 'apiKeyId']),
      ['tags']
    ),
    userId: targetUserId,
  })) as ConnectionProfile[];

  // Remap image profiles
  const remappedImageProfiles = data.imageProfiles.map((profile) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(profile, ['id', 'apiKeyId']),
      ['tags']
    ),
    userId: targetUserId,
  })) as ImageProfile[];

  // Remap embedding profiles
  const remappedEmbeddingProfiles = data.embeddingProfiles.map((profile) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(profile, ['id', 'apiKeyId']),
      ['tags']
    ),
    userId: targetUserId,
  })) as EmbeddingProfile[];

  // Remap chats (complex due to participants and messages)
  const remappedChats = data.chats.map((chat) => {
    const remappedChat = {
      ...remapper.remapArrayFields(
        remapper.remapFields(chat, [
          'id',
          'activeTypingParticipantId',
          'lastTurnParticipantId',
          'projectId',
          'storyBackgroundImageId',
          'imageProfileId',
        ]),
        ['tags', 'impersonatingParticipantIds']
      ),
      userId: targetUserId,
    };

    // Remap participants
    remappedChat.participants = chat.participants.map((participant: ChatParticipantBase) => ({
      ...remapper.remapFields(participant, [
        'id',
        'characterId',
        'connectionProfileId',
        'imageProfileId',
      ]),
    })) as ChatParticipantBase[];

    // Remap messages
    remappedChat.messages = chat.messages.map((msg) => ({
      ...remapper.remapArrayFields(
        remapper.remapFields(msg, ['id', 'swipeGroupId', 'participantId']),
        ['attachments']
      ),
    }));

    return remappedChat as ChatWithMessages;
  });

  // Remap memories
  const remappedMemories = data.memories.map((memory) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(memory, ['id', 'characterId', 'aboutCharacterId', 'chatId', 'sourceMessageId', 'projectId']),
      ['tags', 'relatedMemoryIds']
    ),
  })) as Memory[];

  // Remap prompt templates
  const remappedPromptTemplates = data.promptTemplates.map((template) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(template, ['id']),
      ['tags']
    ),
    userId: targetUserId,
  })) as PromptTemplate[];

  // Remap roleplay templates
  const remappedRoleplayTemplates = data.roleplayTemplates.map((template) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(template, ['id']),
      ['tags']
    ),
    userId: targetUserId,
  })) as RoleplayTemplate[];

  // Provider models are global and don't need remapping, just copy them
  const remappedProviderModels = data.providerModels;

  // Remap projects
  const remappedProjects = data.projects.map((project) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(project, ['id', 'staticBackgroundImageId', 'storyBackgroundImageId']),
      ['characterRoster']
    ),
    userId: targetUserId,
  })) as Project[];

  // Remap LLM logs
  const remappedLLMLogs = data.llmLogs.map((log) => ({
    ...remapper.remapFields(log, ['id', 'messageId', 'chatId', 'characterId']),
    userId: targetUserId,
  })) as LLMLog[];

  // Remap plugin configs
  const remappedPluginConfigs = (data.pluginConfigs || []).map((config) => ({
    ...remapper.remapFields(config, ['id']),
    userId: targetUserId,
  })) as PluginConfig[];

  // Remap chat settings
  const remappedChatSettings = (data.chatSettings || []).map((settings) => {
    const remapped = {
      ...remapper.remapFields(settings, ['id', 'imageDescriptionProfileId', 'uncensoredImageDescriptionProfileId', 'defaultRoleplayTemplateId']),
      userId: targetUserId,
    };
    // Remap nested cheapLLMSettings UUID fields
    if (remapped.cheapLLMSettings) {
      remapped.cheapLLMSettings = {
        ...remapped.cheapLLMSettings,
        ...(remapped.cheapLLMSettings.userDefinedProfileId ? { userDefinedProfileId: remapper.remap(remapped.cheapLLMSettings.userDefinedProfileId) } : {}),
        ...(remapped.cheapLLMSettings.defaultCheapProfileId ? { defaultCheapProfileId: remapper.remap(remapped.cheapLLMSettings.defaultCheapProfileId) } : {}),
        ...(remapped.cheapLLMSettings.imagePromptProfileId ? { imagePromptProfileId: remapper.remap(remapped.cheapLLMSettings.imagePromptProfileId) } : {}),
      };
    }
    // Remap nested dangerousContentSettings UUID fields
    if (remapped.dangerousContentSettings) {
      remapped.dangerousContentSettings = {
        ...remapped.dangerousContentSettings,
        ...(remapped.dangerousContentSettings.uncensoredTextProfileId ? { uncensoredTextProfileId: remapper.remap(remapped.dangerousContentSettings.uncensoredTextProfileId) } : {}),
        ...(remapped.dangerousContentSettings.uncensoredImageProfileId ? { uncensoredImageProfileId: remapper.remap(remapped.dangerousContentSettings.uncensoredImageProfileId) } : {}),
      };
    }
    // Remap nested storyBackgroundsSettings UUID fields
    if (remapped.storyBackgroundsSettings?.defaultImageProfileId) {
      remapped.storyBackgroundsSettings = {
        ...remapped.storyBackgroundsSettings,
        defaultImageProfileId: remapper.remap(remapped.storyBackgroundsSettings.defaultImageProfileId),
      };
    }
    return remapped as ChatSettings;
  });

  // Remap folders
  const remappedFolders = (data.folders || []).map((folder) => ({
    ...remapper.remapFields(folder, ['id', 'parentFolderId', 'projectId']),
    userId: targetUserId,
  })) as Folder[];

  // Remap wardrobe items. componentItemIds reference other wardrobe items, which
  // share the same UUID space; remap them along with id/characterId so cross-refs
  // stay consistent in new-account mode. Legacy outfit presets folded into
  // composites at parse time pass through this same path.
  const remappedWardrobeItems = (data.wardrobeItems || []).map((item) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(item, ['id', 'characterId']),
      ['componentItemIds']
    ),
  })) as WardrobeItem[];

  // Chat documents reference chat IDs that have been remapped above.
  const remappedChatDocuments = (data.chatDocuments || []).map((cd) => ({
    ...remapper.remapFields(cd, ['id', 'chatId']),
  })) as ChatDocument[];

  // Conversation chunks reference chats and individual messages.
  const remappedConversationChunks = (data.conversationChunks || []).map((chunk) => ({
    ...remapper.remapArrayFields(
      remapper.remapFields(chunk, ['id', 'chatId']),
      ['messageIds']
    ),
  })) as SerializedConversationChunk[];

  // Vector index meta — id and characterId share the same value by convention.
  const remappedVectorIndexMetas = (data.vectorIndexMetas || []).map((meta) => ({
    ...remapper.remapFields(meta, ['id', 'characterId']),
  })) as VectorIndexMeta[];

  // Vector entries — id is typically the memory id (already remapped through
  // the memory pass). characterId is also remapped.
  const remappedVectorEntries = (data.vectorEntries || []).map((entry) => ({
    ...remapper.remapFields(entry, ['id', 'characterId']),
  })) as SerializedVectorEntry[];

  // TF-IDF vocabularies. profileId is an embedding-profile id; userId moves
  // to the target user.
  const remappedTfidfVocabularies = (data.tfidfVocabularies || []).map((voc) => ({
    ...remapper.remapFields(voc, ['id', 'profileId']),
    userId: targetUserId,
  })) as TfidfVocabulary[];

  // Embedding status — entityId could be a memory/file/help_doc/etc. id, all
  // of which are already in the mapping by the time embeddingStatus is touched.
  const remappedEmbeddingStatus = (data.embeddingStatus || []).map((es) => ({
    ...remapper.remapFields(es, ['id', 'entityId', 'profileId']),
    userId: targetUserId,
  })) as EmbeddingStatus[];

  // Document store tables — remap every FK to keep the graph internally
  // consistent. doc_mount_files row ids are shared by doc_mount_documents and
  // doc_mount_blobs (fileId), so remapping a file id once means everything
  // that points at it gets the same new id.
  const remappedDocMountPoints = (data.docMountPoints || []).map((mp) => ({
    ...remapper.remapFields(mp, ['id']),
  })) as DocMountPoint[];
  const remappedDocMountFolders = (data.docMountFolders || []).map((folder) => ({
    ...remapper.remapFields(folder, ['id', 'mountPointId', 'parentId']),
  })) as DocMountFolder[];
  const remappedDocMountFiles = (data.docMountFiles || []).map((file) => ({
    ...remapper.remapFields(file, ['id']),
  })) as DocMountFile[];
  const remappedDocMountFileLinks = (data.docMountFileLinks || []).map((link) => ({
    ...remapper.remapFields(link, ['id', 'fileId', 'mountPointId', 'folderId']),
  })) as DocMountFileLink[];
  const remappedDocMountChunks = (data.docMountChunks || []).map((chunk) => ({
    ...remapper.remapFields(chunk, ['id', 'linkId', 'mountPointId']),
  })) as SerializedDocMountChunk[];
  const remappedDocMountDocuments = (data.docMountDocuments || []).map((doc) => ({
    ...remapper.remapFields(doc, ['id', 'fileId']),
  })) as DocMountDocument[];
  const remappedDocMountBlobs = (data.docMountBlobs || []).map((blob) => ({
    ...remapper.remapFields(blob, ['id', 'fileId']),
  })) as DocMountBlobMetadata[];
  const remappedProjectDocMountLinks = (data.projectDocMountLinks || []).map((link) => ({
    ...remapper.remapFields(link, ['id', 'projectId', 'mountPointId']),
  })) as ProjectDocMountLink[];

  // Instance settings — only the mount-point keys carry UUIDs we need to
  // remap. Everything else is opaque text (numbers, JSON config blobs).
  const remappedInstanceSettings = (data.instanceSettings || []).map((row) => {
    if (MOUNT_POINT_SETTING_KEYS.has(row.key) && row.value) {
      return { key: row.key, value: remapper.remap(row.value) };
    }
    return row;
  });

  return {
    manifest: data.manifest,
    characters: remappedCharacters,
    chats: remappedChats,
    tags: remappedTags as Tag[],
    connectionProfiles: remappedConnectionProfiles,
    imageProfiles: remappedImageProfiles,
    embeddingProfiles: remappedEmbeddingProfiles,
    memories: remappedMemories,
    files: remappedFiles as FileEntry[],
    promptTemplates: remappedPromptTemplates,
    roleplayTemplates: remappedRoleplayTemplates,
    providerModels: remappedProviderModels,
    projects: remappedProjects,
    llmLogs: remappedLLMLogs,
    pluginConfigs: remappedPluginConfigs,
    chatSettings: remappedChatSettings,
    folders: remappedFolders,
    wardrobeItems: remappedWardrobeItems,
    characterPluginData: (data.characterPluginData || []).map((cpd) => ({
      ...remapper.remapFields(cpd, ['id', 'characterId']),
    })) as CharacterPluginData[],
    conversationAnnotations: (data.conversationAnnotations || []).map((annotation) => ({
      ...remapper.remapFields(annotation, ['id', 'chatId', 'sourceMessageId']),
    })) as ConversationAnnotation[],
    chatDocuments: remappedChatDocuments,
    instanceSettings: remappedInstanceSettings,
    embeddingStatus: remappedEmbeddingStatus,
    conversationChunks: remappedConversationChunks,
    tfidfVocabularies: remappedTfidfVocabularies,
    vectorIndexMetas: remappedVectorIndexMetas,
    vectorEntries: remappedVectorEntries,
    docMountPoints: remappedDocMountPoints,
    docMountFolders: remappedDocMountFolders,
    docMountFiles: remappedDocMountFiles,
    docMountFileLinks: remappedDocMountFileLinks,
    docMountChunks: remappedDocMountChunks,
    docMountDocuments: remappedDocMountDocuments,
    docMountBlobs: remappedDocMountBlobs,
    projectDocMountLinks: remappedProjectDocMountLinks,
  };
}

/**
 * Restores data from a backup ZIP file on disk
 */
export async function restore(
  zipPath: string,
  options: RestoreOptions
): Promise<RestoreSummary> {
  const { mode, targetUserId } = options;

  moduleLogger.info('Starting restore operation', { mode, targetUserId });

  const warnings: string[] = [];

  // Extract zip to temp directory once — all file reads come from disk
  const { data: parsedData, extractDir, rootFolder } = await parseBackupZip(zipPath);
  const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir;

  try {
    let data = parsedData;

    // For replace mode, delete existing data first
    if (mode === 'replace') {
      await deleteUserData(targetUserId);
    }

    // For new-account mode, remap all UUIDs
    if (mode === 'new-account') {
      const remapper = new UuidRemapper();
      data = remapBackupData(data, targetUserId, remapper);
    }

    const repos = getUserRepositories(targetUserId);

    // Restore in dependency order
    // All entities preserve their backup/remapped IDs via CreateOptions.id,
    // so cross-references (characterId in participants, tags, etc.) are already correct.

    // 1. Tags (no dependencies)
    for (const tag of data.tags) {
      try {
        const { userId, createdAt, updatedAt, ...tagData } = tag;
        await repos.tags.create({ ...tagData, nameLower: tagData.nameLower || tagData.name.toLowerCase() }, { id: tag.id });
      } catch (error) {
        warnings.push(`Failed to restore tag "${tag.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore tag', { tagId: tag.id, error });
      }
    }

    // 2. Connection profiles (no entity dependencies, but have tag refs)
    for (const profile of data.connectionProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        // Note: apiKeyId is not restored as API keys are encrypted and can't be restored
        await repos.connections.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore connection profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore connection profile', { profileId: profile.id, error });
      }
    }

    // 3. Image profiles
    for (const profile of data.imageProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        await repos.imageProfiles.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore image profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore image profile', { profileId: profile.id, error });
      }
    }

    // 4. Embedding profiles
    for (const profile of data.embeddingProfiles) {
      try {
        const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
        await repos.embeddingProfiles.create({ ...profileData, apiKeyId: null }, { id: profile.id });
      } catch (error) {
        warnings.push(`Failed to restore embedding profile "${profile.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore embedding profile', { profileId: profile.id, error });
      }
    }

    // 5. Files (read from extracted dir on disk, upload to storage)
    // In new-account mode, file IDs are remapped but on-disk filenames use original IDs.
    // Use parsedData.files (original) for disk lookup, data.files (remapped) for DB records.
    let filesRestored = 0;
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      const originalFile = parsedData.files[i]; // original IDs for disk lookup
      try {
        const fileBuffer = await getFileFromExtractedBackup(rootPath, originalFile, data.manifest?.backupFormat);
        if (fileBuffer) {
          // Project-bound files restore into the project mount (via FSM →
          // project-store-bridge). Project-less files land in the Quilltap
          // Uploads mount under restored/, not the catch-all _general/.
          let restoredStorageKey: string;
          let restoredMimeType: string;
          let restoredSize: number;
          if (file.projectId) {
            const uploadResult = await fileStorageManager.uploadFile({
              filename: file.originalFilename,
              content: fileBuffer,
              contentType: file.mimeType,
              projectId: file.projectId,
              folderPath: file.folderPath || '/',
            });
            restoredStorageKey = uploadResult.storageKey;
            restoredMimeType = uploadResult.storedMimeType;
            restoredSize = uploadResult.sizeBytes;
          } else {
            const written = await writeUserUploadToMountStore({
              filename: file.originalFilename,
              content: fileBuffer,
              contentType: file.mimeType,
              subfolder: 'restored',
            });
            restoredStorageKey = written.storageKey;
            restoredMimeType = written.storedMimeType;
            restoredSize = written.sizeBytes;
          }

          // Create file metadata with storage key. The bridges may transcode
          // bytes (bitmaps → WebP), so we record the post-bridge mime/size
          // rather than what the backup row claimed — a backup made before
          // this fix may carry the pre-transcode lie, and re-writing it would
          // re-introduce the "media_type X but bytes are Y" error.
          // Strip auto-generated and legacy fields from backup data
          const { userId, createdAt, updatedAt, storageKey, ...fileData } = file as typeof file & Record<string, unknown>;
          // Remove legacy fields that may exist in older backups
          delete (fileData as Record<string, unknown>).s3Key;
          delete (fileData as Record<string, unknown>).s3Bucket;
          delete (fileData as Record<string, unknown>).mountPointId;
          await repos.files.create(
            {
              ...fileData,
              mimeType: restoredMimeType,
              size: restoredSize,
              storageKey: restoredStorageKey,
            },
            { id: file.id }
          );
          filesRestored++;
        } else {
          warnings.push(`File not found in backup: ${file.originalFilename}`);
        }
      } catch (error) {
        warnings.push(`Failed to restore file "${file.originalFilename}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore file', { fileId: file.id, error });
      }
    }

    // 6. Characters
    for (const character of data.characters) {
      try {
        const { userId, createdAt, updatedAt, ...charData } = character;
        await repos.characters.create(charData, { id: character.id });
      } catch (error) {
        warnings.push(`Failed to restore character "${character.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore character', { characterId: character.id, error });
      }
    }

    // 7. Chats (with messages)
    let messagesRestored = 0;
    for (const chat of data.chats) {
      try {
        const { userId, createdAt, updatedAt, messages, ...chatData } = chat;
        const createdChat = await repos.chats.create(chatData, { id: chat.id });

        // Add messages to the chat
        for (const message of messages) {
          try {
            await repos.chats.addMessage(createdChat.id, message);
            messagesRestored++;
          } catch (msgError) {
            warnings.push(`Failed to restore message in chat "${chat.title}": ${msgError instanceof Error ? msgError.message : String(msgError)}`);
          }
        }
      } catch (error) {
        warnings.push(`Failed to restore chat "${chat.title}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat', { chatId: chat.id, error });
      }
    }

    // 9. Memories
    // IDs are preserved during creation, so characterId/aboutCharacterId already point
    // to the correct (preserved) character IDs — no remapping needed.
    for (const memory of data.memories) {
      try {
        const { id, createdAt, updatedAt, ...memoryData } = memory;

        // Strip legacy personaId from old backups (column no longer exists)
        const { personaId: _legacyPersonaId, ...cleanMemoryData } = memoryData as Record<string, unknown>;
        await repos.memories.create(cleanMemoryData as Parameters<typeof repos.memories.create>[0]);
      } catch (error) {
        warnings.push(`Failed to restore memory: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore memory', { memoryId: memory.id, error });
      }
    }

    // 10. Prompt Templates (user-created only)
    const globalRepos = getRepositories();
    let promptTemplatesRestored = 0;
    for (const template of data.promptTemplates) {
      try {
        const { id, userId, createdAt, updatedAt, ...templateData } = template;
        await globalRepos.promptTemplates.create({
          ...templateData,
          userId: targetUserId,
        });
        promptTemplatesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore prompt template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore prompt template', { templateId: template.id, error });
      }
    }

    // 11. Roleplay Templates (user-created only)
    let roleplayTemplatesRestored = 0;
    for (const template of data.roleplayTemplates) {
      try {
        const { id, userId, createdAt, updatedAt, ...templateData } = template;
        await globalRepos.roleplayTemplates.create({
          ...templateData,
          userId: targetUserId,
        });
        roleplayTemplatesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore roleplay template "${template.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore roleplay template', { templateId: template.id, error });
      }
    }

    // 12. Provider Models (global cache)
    let providerModelsRestored = 0;
    for (const model of data.providerModels) {
      try {
        const { id, createdAt, updatedAt, ...modelData } = model;
        await globalRepos.providerModels.upsertModel(modelData);
        providerModelsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore provider model "${model.modelId}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore provider model', { modelId: model.modelId, error });
      }
    }

    // 13. Projects
    let projectsRestored = 0;
    for (const project of data.projects) {
      try {
        const { userId, createdAt, updatedAt, ...projectData } = project;
        await repos.projects.create(projectData, { id: project.id });
        projectsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore project "${project.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore project', { projectId: project.id, error });
      }
    }

    // 14. LLM Logs
    let llmLogsRestored = 0;
    if (isLLMLogsDegraded()) {
      moduleLogger.warn('Skipping LLM logs restore — logs database is in degraded mode');
      warnings.push('LLM logs were not restored because the logs database is in degraded mode');
    } else {
      for (const log of data.llmLogs) {
        try {
          const { id, createdAt, ...logData } = log;
          await repos.llmLogs.create(logData, { id, createdAt });
          llmLogsRestored++;
        } catch (error) {
          warnings.push(`Failed to restore LLM log: ${error instanceof Error ? error.message : String(error)}`);
          moduleLogger.warn('Failed to restore LLM log', { logId: log.id, error });
        }
      }
    }

    // 15. Plugin Configs
    let pluginConfigsRestored = 0;
    for (const config of data.pluginConfigs || []) {
      try {
        const { id, createdAt, updatedAt, ...configData } = config;
        // Use upsert to merge with existing configs or create new ones
        await globalRepos.pluginConfigs.upsertForUserPlugin(
          targetUserId,
          configData.pluginName,
          configData.config as Record<string, unknown>
        );
        pluginConfigsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore plugin config for "${config.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore plugin config', { pluginName: config.pluginName, error });
      }
    }

    // 16. Chat Settings
    let chatSettingsRestored = 0;
    for (const settings of data.chatSettings || []) {
      try {
        const { id, createdAt, updatedAt, ...settingsData } = settings;
        await globalRepos.chatSettings.create(settingsData, { id });
        chatSettingsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore chat settings: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat settings', { settingsId: settings.id, error });
      }
    }

    // 17. Folders
    let foldersRestored = 0;
    for (const folder of data.folders || []) {
      try {
        const { id, createdAt, updatedAt, ...folderData } = folder;
        await globalRepos.folders.create({ ...folderData, userId: targetUserId }, { id: folder.id });
        foldersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore folder "${folder.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore folder', { folderId: folder.id, error });
      }
    }

    // 19. Wardrobe Items
    let wardrobeItemsRestored = 0;
    for (const item of data.wardrobeItems || []) {
      try {
        const { id, createdAt, updatedAt, ...itemData } = item;
        await globalRepos.wardrobe.create(itemData, { id: item.id });
        wardrobeItemsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore wardrobe item "${item.title}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore wardrobe item', { wardrobeItemId: item.id, error });
      }
    }

    // 20. Outfit Presets — REMOVED: presets are now composite WardrobeItems and
    // were folded into data.wardrobeItems at parse time for back-compat with
    // older backups. Nothing to restore here.

    // 21. Character Plugin Data (depends on characters)
    let characterPluginDataRestored = 0;
    for (const cpd of data.characterPluginData || []) {
      try {
        const { id, createdAt, updatedAt, ...cpdData } = cpd;
        await globalRepos.characterPluginData.create(cpdData, { id: cpd.id });
        characterPluginDataRestored++;
      } catch (error) {
        warnings.push(`Failed to restore character plugin data for plugin "${cpd.pluginName}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore character plugin data', { cpdId: cpd.id, pluginName: cpd.pluginName, error });
      }
    }

    // 22. Conversation Annotations (depends on chats)
    let conversationAnnotationsRestored = 0;
    for (const annotation of data.conversationAnnotations || []) {
      try {
        const { id, createdAt, updatedAt, ...annotationData } = annotation;
        await globalRepos.conversationAnnotations.create(annotationData, { id: annotation.id });
        conversationAnnotationsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore conversation annotation: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore conversation annotation', { annotationId: annotation.id, error });
      }
    }

    // ========================================================================
    // Format-3 entities (depend on the entities created above)
    // ========================================================================

    // 22a. Document store mount points
    let docMountPointsRestored = 0;
    for (const mp of data.docMountPoints || []) {
      try {
        const { id, createdAt, updatedAt, ...mpData } = mp;
        await globalRepos.docMountPoints.create(mpData, { id: mp.id });
        docMountPointsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore document store "${mp.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount point', { mountPointId: mp.id, error });
      }
    }

    // 22b. Document store folders — sort by path length so parents precede
    // children (parentId is a self-FK into the same table).
    let docMountFoldersRestored = 0;
    const sortedFolders = [...(data.docMountFolders || [])].sort(
      (a, b) => (a.path?.length ?? 0) - (b.path?.length ?? 0)
    );
    for (const folder of sortedFolders) {
      try {
        const { id, createdAt, updatedAt, ...folderData } = folder;
        await globalRepos.docMountFolders.create(folderData, { id: folder.id });
        docMountFoldersRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store folder "${folder.name}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount folder', { folderId: folder.id, error });
      }
    }

    // 22c. Document store file content rows (content-addressed by sha256).
    let docMountFilesRestored = 0;
    for (const file of data.docMountFiles || []) {
      try {
        const { id, createdAt, updatedAt, ...fileData } = file;
        await globalRepos.docMountFiles.create(fileData, { id: file.id });
        docMountFilesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store file row: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount file', { fileId: file.id, error });
      }
    }

    // 22d. Document store file links (hard links to file content).
    let docMountFileLinksRestored = 0;
    for (const link of data.docMountFileLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = link;
        await globalRepos.docMountFileLinks.create(linkData, { id: link.id });
        docMountFileLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store file link "${link.relativePath}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount file link', { linkId: link.id, error });
      }
    }

    // 22e. Document store text documents (database-backed text content).
    let docMountDocumentsRestored = 0;
    for (const doc of data.docMountDocuments || []) {
      try {
        const { id, createdAt, updatedAt, ...docData } = doc;
        await globalRepos.docMountDocuments.create(docData, { id: doc.id });
        docMountDocumentsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store document: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount document', { documentId: doc.id, error });
      }
    }

    // 22f. Document store binary blobs (metadata rows + bytes from disk).
    // Bytes were staged in mount-blobs/<blobId> at backup time. We restore
    // them by writing the metadata row + bytes directly to the mount-index
    // DB so we preserve the original blob id (a UNIQUE column on fileId).
    let docMountBlobsRestored = 0;
    if ((data.docMountBlobs || []).length > 0) {
      // In new-account mode the metadata id is remapped but the bytes on
      // disk are still keyed by the *original* id. Pair them by index, the
      // same trick used for user files higher up.
      const originalBlobs = parsedData.docMountBlobs || [];
      const blobsDir = path.join(rootPath, 'mount-blobs');
      const mountIndexDb = isMountIndexDegraded() ? null : getRawMountIndexDatabase();
      if (!mountIndexDb) {
        warnings.push('Doc-store blobs were not restored — mount-index database is unavailable');
      } else {
        const insert = mountIndexDb.prepare(
          `INSERT INTO "doc_mount_blobs" (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (let i = 0; i < (data.docMountBlobs || []).length; i++) {
          const blob = (data.docMountBlobs || [])[i];
          const original = originalBlobs[i] ?? blob;
          try {
            const bytesPath = path.join(blobsDir, original.id);
            const bytes = await fs.promises.readFile(bytesPath);
            insert.run(
              blob.id,
              blob.fileId,
              blob.sha256,
              blob.sizeBytes,
              blob.storedMimeType,
              bytes,
              blob.createdAt,
              blob.updatedAt
            );
            docMountBlobsRestored++;
          } catch (error) {
            warnings.push(`Failed to restore doc-store blob ${blob.id}: ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore doc mount blob', { blobId: blob.id, error });
          }
        }
      }
    }

    // 22g. Document store embedded chunks. The repo's create() accepts the
    // chunk in serialised form; the schema rehydrates embedding as Float32Array.
    let docMountChunksRestored = 0;
    for (const chunk of data.docMountChunks || []) {
      try {
        const { id, createdAt, updatedAt, ...chunkData } = chunk;
        await globalRepos.docMountChunks.create(chunkData as unknown as Parameters<typeof globalRepos.docMountChunks.create>[0], { id: chunk.id });
        docMountChunksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore doc-store chunk: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore doc mount chunk', { chunkId: chunk.id, error });
      }
    }

    // 22h. Project ↔ document-store links.
    let projectDocMountLinksRestored = 0;
    for (const link of data.projectDocMountLinks || []) {
      try {
        const { id, createdAt, updatedAt, ...linkData } = link;
        await globalRepos.projectDocMountLinks.create(linkData, { id: link.id });
        projectDocMountLinksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore project↔store link: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore project doc mount link', { linkId: link.id, error });
      }
    }

    // 22i. Chat documents (Document Mode pane state per chat).
    let chatDocumentsRestored = 0;
    for (const cd of data.chatDocuments || []) {
      try {
        const { id, createdAt, updatedAt, ...cdData } = cd;
        await globalRepos.chatDocuments.create(cdData, { id: cd.id });
        chatDocumentsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore chat document: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore chat document', { chatDocumentId: cd.id, error });
      }
    }

    // 22j. Vector index metas + entries. Without these every memory would
    // need to be re-embedded after restore.
    let vectorIndexMetasRestored = 0;
    for (const meta of data.vectorIndexMetas || []) {
      try {
        await globalRepos.vectorIndices.saveMeta(meta.characterId, meta.dimensions);
        vectorIndexMetasRestored++;
      } catch (error) {
        warnings.push(`Failed to restore vector index meta for character ${meta.characterId}: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore vector index meta', { characterId: meta.characterId, error });
      }
    }

    // The repo's addEntries batch path expects Float32Array; the serialised
    // form holds plain number arrays, so rehydrate before insert.
    let vectorEntriesRestored = 0;
    if ((data.vectorEntries || []).length > 0) {
      try {
        const rehydrated = (data.vectorEntries || []).map((e) => ({
          id: e.id,
          characterId: e.characterId,
          embedding: new Float32Array(e.embedding),
        }));
        await globalRepos.vectorIndices.addEntries(rehydrated);
        vectorEntriesRestored = rehydrated.length;
      } catch (error) {
        warnings.push(`Failed to restore vector entries: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore vector entries batch', { error });
      }
    }

    // 22k. Conversation chunks (semantic chunks with embeddings).
    let conversationChunksRestored = 0;
    for (const chunk of data.conversationChunks || []) {
      try {
        const { id, createdAt, updatedAt, ...chunkData } = chunk;
        // The repo's create accepts ConversationChunkInput; embeddings come
        // through as number[] and the Zod transform rehydrates them.
        await globalRepos.conversationChunks.create(
          chunkData as unknown as Parameters<typeof globalRepos.conversationChunks.create>[0],
          { id: chunk.id }
        );
        conversationChunksRestored++;
      } catch (error) {
        warnings.push(`Failed to restore conversation chunk: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore conversation chunk', { chunkId: chunk.id, error });
      }
    }

    // 22l. TF-IDF vocabularies (one per BUILTIN embedding profile).
    let tfidfVocabulariesRestored = 0;
    for (const voc of data.tfidfVocabularies || []) {
      try {
        const { id, createdAt, updatedAt, ...vocData } = voc;
        await globalRepos.tfidfVocabularies.create(
          { ...vocData, userId: targetUserId },
          { id: voc.id }
        );
        tfidfVocabulariesRestored++;
      } catch (error) {
        warnings.push(`Failed to restore TF-IDF vocabulary: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore tfidf vocabulary', { vocabularyId: voc.id, error });
      }
    }

    // 22m. Embedding status flags.
    let embeddingStatusRestored = 0;
    for (const es of data.embeddingStatus || []) {
      try {
        const { id, createdAt, updatedAt, ...esData } = es;
        await globalRepos.embeddingStatus.create(
          { ...esData, userId: targetUserId },
          { id: es.id }
        );
        embeddingStatusRestored++;
      } catch (error) {
        warnings.push(`Failed to restore embedding status: ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore embedding status', { statusId: es.id, error });
      }
    }

    // 22n. Instance settings — applied last because the mount-point keys
    // reference doc_mount_points that we just restored above. Upsert by key
    // so a fresh instance's auto-provisioned defaults get overwritten by the
    // backup's values.
    let instanceSettingsRestored = 0;
    for (const row of data.instanceSettings || []) {
      try {
        await rawQuery(
          'INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?) ' +
            'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"',
          [row.key, row.value]
        );
        instanceSettingsRestored++;
      } catch (error) {
        warnings.push(`Failed to restore instance setting "${row.key}": ${error instanceof Error ? error.message : String(error)}`);
        moduleLogger.warn('Failed to restore instance setting', { key: row.key, error });
      }
    }

    // 23. NPM Plugins (copy from extracted dir to plugins/npm directory)
    let npmPluginsRestored = 0;
    const npmPluginsSrcDir = path.join(rootPath, 'plugins', 'npm');

    try {
      const pluginEntries = await fs.promises.readdir(npmPluginsSrcDir, { withFileTypes: true });
      const npmPluginsDir = getNpmPluginsDir();

      // Ensure the npm plugins directory exists
      await fs.promises.mkdir(npmPluginsDir, { recursive: true });

      for (const entry of pluginEntries) {
        if (entry.isDirectory()) {
          try {
            const srcPath = path.join(npmPluginsSrcDir, entry.name);
            const destPath = path.join(npmPluginsDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true });
            npmPluginsRestored++;
            moduleLogger.debug('Restored npm plugin', { pluginName: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore npm plugin "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore npm plugin', { pluginName: entry.name, error });
          }
        }
      }

      if (npmPluginsRestored > 0) {
        moduleLogger.info('Restored npm plugins', {
          count: npmPluginsRestored,
          plugins: pluginEntries.filter((e) => e.isDirectory()).map((e) => e.name),
        });
      }
    } catch {
      // No plugins/npm directory in the backup — that's fine
      moduleLogger.debug('No npm plugins directory in backup');
    }

    // 24. User-installed theme bundles (copy from extracted dir to themes directory)
    let userInstalledThemesRestored = 0;
    const themesSrcDir = path.join(rootPath, 'themes');

    try {
      const themeEntries = await fs.promises.readdir(themesSrcDir, { withFileTypes: true });
      const themesDir = getThemesDir();

      // Ensure the themes directory exists
      await fs.promises.mkdir(themesDir, { recursive: true });

      for (const entry of themeEntries) {
        if (entry.isDirectory() && entry.name !== '.cache') {
          try {
            const srcPath = path.join(themesSrcDir, entry.name);
            const destPath = path.join(themesDir, entry.name);
            await fs.promises.cp(srcPath, destPath, { recursive: true, force: true });
            userInstalledThemesRestored++;
            moduleLogger.debug('Restored theme bundle', { themeId: entry.name });
          } catch (error) {
            warnings.push(`Failed to restore theme bundle "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
            moduleLogger.warn('Failed to restore theme bundle', { themeId: entry.name, error });
          }
        } else if (entry.isFile() && entry.name === 'themes-index.json') {
          // Restore the themes index file
          try {
            const themesDir2 = getThemesDir();
            await fs.promises.cp(path.join(themesSrcDir, 'themes-index.json'), path.join(themesDir2, 'themes-index.json'), { force: true });
          } catch (error) {
            moduleLogger.warn('Failed to restore themes-index.json', { error });
          }
        }
      }

      if (userInstalledThemesRestored > 0) {
        moduleLogger.info('Restored user-installed theme bundles', {
          count: userInstalledThemesRestored,
        });
      }
    } catch {
      // No themes directory in the backup — that's fine
      moduleLogger.debug('No themes directory in backup');
    }

    moduleLogger.info('All entities restored with preserved IDs - no reconciliation needed');

    const summary: RestoreSummary = {
      characters: data.characters.length,
      chats: data.chats.length,
      messages: messagesRestored,
      tags: data.tags.length,
      files: filesRestored,
      memories: data.memories.length,
      profiles: {
        connection: data.connectionProfiles.length,
        image: data.imageProfiles.length,
        embedding: data.embeddingProfiles.length,
      },
      templates: {
        prompt: promptTemplatesRestored,
        roleplay: roleplayTemplatesRestored,
      },
      providerModels: providerModelsRestored,
      projects: projectsRestored,
      llmLogs: llmLogsRestored,
      pluginConfigs: pluginConfigsRestored,
      chatSettings: chatSettingsRestored,
      folders: foldersRestored,
      wardrobeItems: wardrobeItemsRestored,
      npmPlugins: npmPluginsRestored,
      characterPluginData: characterPluginDataRestored,
      conversationAnnotations: conversationAnnotationsRestored,
      userInstalledThemes: userInstalledThemesRestored,
      chatDocuments: chatDocumentsRestored,
      instanceSettings: instanceSettingsRestored,
      embeddingStatus: embeddingStatusRestored,
      conversationChunks: conversationChunksRestored,
      tfidfVocabularies: tfidfVocabulariesRestored,
      vectorIndexMetas: vectorIndexMetasRestored,
      vectorEntries: vectorEntriesRestored,
      docMountPoints: docMountPointsRestored,
      docMountFolders: docMountFoldersRestored,
      docMountFiles: docMountFilesRestored,
      docMountFileLinks: docMountFileLinksRestored,
      docMountChunks: docMountChunksRestored,
      docMountDocuments: docMountDocumentsRestored,
      docMountBlobs: docMountBlobsRestored,
      projectDocMountLinks: projectDocMountLinksRestored,
      warnings,
    };

    moduleLogger.info('Restore operation completed', {
      targetUserId,
      mode,
      summary,
      warningCount: warnings.length,
    });

    return summary;
  } finally {
    // Always clean up the extracted temp directory
    await cleanupDir(extractDir);
  }
}
