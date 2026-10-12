/**
 * Scenario Location — the one answer to "where does this scenario live, and
 * how do I read and write there".
 *
 * A location is one owner's `Scenarios/` folder: a character's vault, a
 * project's official store, a group's official store, or Quilltap General.
 * Routes, the chat-side resolver, the instance-wide lister and the startup
 * heals all address a scenario through this; nobody switches on scope to pick
 * a reader or a writer, and a `ScenarioRef` (`{ mountPointId, path }`) is the
 * one pointer that names a scenario anywhere.
 *
 * Provisioning is opt-in: `ensure: true` creates a project/group store and its
 * `Scenarios/` folder when missing, and is for callers about to write. A read
 * probe passes nothing and gets null for a store that doesn't exist yet.
 *
 * The character tier is different on disk (a `# Heading` title, ids hashed
 * from the file path, the default in `characters.defaultScenarioId`) and the
 * vault overlay re-projects the whole `character.scenarios` array over the
 * folder on every write, deleting any file it did not write. So the character
 * location reads the folder directly but writes only through the characters
 * repository, which keeps the vault projection the single writer.
 *
 * Archived characters are tombstones: they resolve and classify as null, so a
 * pruned vault is never browsed, plucked from, or written through here.
 *
 * Server-only.
 *
 * @module lib/scenarios/location
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store';
import {
  deleteDatabaseDocument,
  moveDatabaseDocument,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { sanitizeFileName } from '@/lib/mount-index/character-vault';
import {
  SCENARIOS_FOLDER,
  buildScenarioFileContent,
  buildScenarioList,
  createScenarioSchema,
  isScenarioContentArchived,
  parseScenarioDoc,
  resolveScenarioPath,
  setScenarioDefaultInFolder,
  updateScenarioSchema,
  type ListScenariosResult,
  type ParsedScenario,
} from '@/lib/mount-index/scenarios-common';
import {
  parseScenarioFile,
  stableUuidFromString,
} from '@/lib/database/repositories/vault-overlay/parsers';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';
import type { RepositoryContainer } from '@/lib/repositories/factory';

export const ScenarioScopeSchema = z.enum(['character', 'project', 'group', 'general']);
export type ScenarioScope = z.infer<typeof ScenarioScopeSchema>;

/** The universal pointer to one scenario file (schema in `chat.types`, client-safe). */
export { ScenarioRefSchema, type ScenarioRef } from '@/lib/schemas/chat.types';
import type { ScenarioRef } from '@/lib/schemas/chat.types';

export type CreateScenarioInput = z.infer<typeof createScenarioSchema>;
export type UpdateScenarioInput = z.infer<typeof updateScenarioSchema>;

/** Display name of General as an owner. */
export const GENERAL_OWNER_NAME = 'Quilltap General';

/** A create or rename would land on a file that already exists. */
export class ScenarioConflictError extends Error {
  constructor(public readonly filename: string) {
    super(`A scenario named "${filename}" already exists`);
    this.name = 'ScenarioConflictError';
  }
}

/** The scenario named by a path is not in this location. */
export class ScenarioNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Scenario not found: ${path}`);
    this.name = 'ScenarioNotFoundError';
  }
}

/** A filename that sanitises to nothing. */
export class ScenarioFilenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioFilenameError';
  }
}

/** The scopes whose scenarios are plain files this module writes: General, projects, groups. */
export type StoreScenarioScope = Exclude<ScenarioScope, 'character'>;

/**
 * One owner's `Scenarios/` folder, for reading. Every scope has one. Writes
 * live on {@link StoreScenarioLocation}: the character tier is written through
 * the characters repository (its vault projection is the single writer), so
 * its location is read-only.
 */
export interface ScenarioLocation {
  scope: ScenarioScope;
  /** Owner id; null for General. */
  id: string | null;
  mountPointId: string;
  /** Display name of the owner: character name, project name, group name, 'Quilltap General'. */
  ownerName: string;
  list(opts?: { includeArchived?: boolean }): Promise<ListScenariosResult>;
  /** One scenario, archived included; `isDefault` reflects only the file (or column) itself. */
  read(path: string): Promise<ParsedScenario | null>;
  /** The id a character-tier scenario carries (`stableUuidFromString('scenario:…')`); null for other scopes. */
  idForPath(path: string): string | null;
  /** Parse one of this folder's documents with the scope's parser. */
  parse(doc: DocMountDocument, defaultScenarioId?: string | null): ParsedScenario | null;
}

/** A file-backed owner's folder — General, a project, a group — with its writes. */
export interface StoreScenarioLocation extends ScenarioLocation {
  scope: StoreScenarioScope;
  create(input: CreateScenarioInput): Promise<ParsedScenario>;
  update(path: string, patch: UpdateScenarioInput): Promise<ParsedScenario>;
  rename(path: string, filename: string): Promise<ParsedScenario>;
  delete(path: string): Promise<void>;
  setDefault(path: string | null): Promise<void>;
}

export interface ResolveScenarioLocationOptions {
  /** Provision a missing project/group store and the `Scenarios/` folder. For writers. */
  ensure?: boolean;
}

/** The slice of a raw character row a character location is built from. */
type CharacterRow = {
  id: string;
  name: string;
  userId: string;
  archivedAt?: string | null;
  characterDocumentMountPointId?: string | null;
  defaultScenarioId?: string | null;
};

/** A raw character row that may carry scenarios: the caller's, live, with a vault. */
function usableCharacter(character: CharacterRow | null, userId: string): (CharacterRow & { characterDocumentMountPointId: string }) | null {
  if (!character || character.userId !== userId || character.archivedAt) return null;
  if (!character.characterDocumentMountPointId) return null;
  return character as CharacterRow & { characterDocumentMountPointId: string };
}

/** Ref → character-scenario id. A pure function of the ref. */
export function characterScenarioIdForPath(mountPointId: string, path: string): string {
  return stableUuidFromString(`scenario:${mountPointId}:${path}`);
}

/**
 * Parse a document from any owner's `Scenarios/` folder with that scope's
 * parser. The character tier's default is a column, so its caller passes the
 * character's `defaultScenarioId`.
 */
export function parseScenarioForScope(
  scope: ScenarioScope,
  doc: DocMountDocument,
  options: { characterId?: string; defaultScenarioId?: string | null } = {},
): ParsedScenario | null {
  if (scope !== 'character') return parseScenarioDoc(doc);

  const parsed = parseScenarioFile(doc, options.characterId ?? '');
  if (!parsed) return null;
  const isDefault = !!options.defaultScenarioId && parsed.id === options.defaultScenarioId;
  return {
    path: doc.relativePath,
    filename: doc.fileName.replace(/\.md$/i, ''),
    name: parsed.title,
    ...(parsed.description !== undefined && { description: parsed.description }),
    isDefault,
    rawIsDefault: isDefault,
    archived: parsed.archived === true,
    body: parsed.content,
    lastModified: doc.lastModified,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Normalise a path into `Scenarios/<file>.md`, or explain why not. */
export function normalizeScenarioPath(
  path: string,
): { ok: true; path: string } | { ok: false; error: string } {
  return resolveScenarioPath(path, SCENARIOS_FOLDER);
}

function requirePath(path: string): string {
  const resolved = normalizeScenarioPath(path);
  if (!resolved.ok) throw new ScenarioNotFoundError(path);
  return resolved.path;
}

function cleanFilename(filename: string, emptyMessage: string): string {
  const cleaned = sanitizeFileName(filename).replace(/\.md$/i, '');
  if (!cleaned) throw new ScenarioFilenameError(emptyMessage);
  return cleaned;
}

// ============================================================================
// Store tiers — General, project, group
// ============================================================================

function storeLocation(
  scope: StoreScenarioScope,
  id: string | null,
  mountPointId: string,
  ownerName: string,
  repos: RepositoryContainer,
): StoreScenarioLocation {
  const findDoc = (path: string) => repos.docMountDocuments.findByMountPointAndPath(mountPointId, path);

  const list: ScenarioLocation['list'] = async (opts = {}) => {
    const docs = await repos.docMountDocuments.findManyByMountPointsInFolder(
      [mountPointId],
      SCENARIOS_FOLDER,
      '.md',
    );
    return buildScenarioList(docs, parseScenarioDoc, opts, { scope, id, mountPointId });
  };

  const read: ScenarioLocation['read'] = async (path) => {
    const doc = await findDoc(requirePath(path));
    return doc ? parseScenarioDoc(doc) : null;
  };

  return {
    scope,
    id,
    mountPointId,
    ownerName,
    list,
    read,
    async create(input) {
      const cleaned = cleanFilename(input.filename, 'Filename cannot be empty after sanitisation');
      const path = `${SCENARIOS_FOLDER}/${cleaned}.md`;
      if (await findDoc(path)) throw new ScenarioConflictError(cleaned);
      await writeDatabaseDocument(
        mountPointId,
        path,
        buildScenarioFileContent({
          name: input.name,
          description: input.description,
          isDefault: input.isDefault,
          archived: input.archived,
          body: input.body,
        }),
      );
      if (input.isDefault) await setScenarioDefaultInFolder(mountPointId, path, SCENARIOS_FOLDER);
      logger.debug('[ScenarioLocation] Created scenario', { scope, id, mountPointId, path });
      const created = await read(path);
      if (!created) throw new ScenarioNotFoundError(path);
      return created;
    },
    async update(path, patch) {
      const resolved = requirePath(path);
      const existing = await findDoc(resolved);
      if (!existing) throw new ScenarioNotFoundError(resolved);
      await writeDatabaseDocument(
        mountPointId,
        resolved,
        buildScenarioFileContent({
          name: patch.name,
          description: patch.description,
          isDefault: patch.isDefault,
          // The serializer rewrites the whole file; an unmentioned flag would
          // otherwise be dropped and the scenario would un-archive itself.
          archived: patch.archived ?? isScenarioContentArchived(existing.content),
          body: patch.body,
        }),
      );
      if (patch.isDefault) await setScenarioDefaultInFolder(mountPointId, resolved, SCENARIOS_FOLDER);
      logger.debug('[ScenarioLocation] Updated scenario', { scope, id, mountPointId, path: resolved });
      const updated = await read(resolved);
      if (!updated) throw new ScenarioNotFoundError(resolved);
      return updated;
    },
    async rename(path, filename) {
      const resolved = requirePath(path);
      const cleaned = cleanFilename(filename, 'newFilename cannot be empty after sanitisation');
      const newPath = `${SCENARIOS_FOLDER}/${cleaned}.md`;
      if (newPath !== resolved) {
        if (!(await findDoc(resolved))) throw new ScenarioNotFoundError(resolved);
        if (await findDoc(newPath)) throw new ScenarioConflictError(cleaned);
        await moveDatabaseDocument(mountPointId, resolved, newPath);
        logger.debug('[ScenarioLocation] Renamed scenario', { scope, id, mountPointId, from: resolved, to: newPath });
      }
      const renamed = await read(newPath);
      if (!renamed) throw new ScenarioNotFoundError(newPath);
      return renamed;
    },
    async delete(path) {
      const resolved = requirePath(path);
      const deleted = await deleteDatabaseDocument(mountPointId, resolved);
      if (!deleted) throw new ScenarioNotFoundError(resolved);
      logger.debug('[ScenarioLocation] Deleted scenario', { scope, id, mountPointId, path: resolved });
    },
    async setDefault(path) {
      await setScenarioDefaultInFolder(mountPointId, path === null ? null : requirePath(path), SCENARIOS_FOLDER);
    },
    idForPath() {
      return null;
    },
    parse(doc) {
      return parseScenarioDoc(doc);
    },
  };
}

// ============================================================================
// Character tier — read-only; writes go through the characters repository
// ============================================================================

function characterLocation(
  character: CharacterRow,
  mountPointId: string,
  repos: RepositoryContainer,
): ScenarioLocation {
  const characterId = character.id;
  // The character's default is a column on the row this location was built
  // from; nothing writes through a character location, so that copy holds.
  const defaultScenarioId = character.defaultScenarioId ?? null;
  const idForPath = (path: string) => characterScenarioIdForPath(mountPointId, path);
  const parse = (doc: DocMountDocument, defaultId: string | null = defaultScenarioId) =>
    parseScenarioForScope('character', doc, { characterId, defaultScenarioId: defaultId });

  return {
    scope: 'character',
    id: characterId,
    mountPointId,
    ownerName: character.name,
    async list(opts = {}) {
      const docs = await repos.docMountDocuments.findManyByMountPointsInFolder([mountPointId], SCENARIOS_FOLDER, '.md');
      return buildScenarioList(docs, (doc) => parse(doc), opts, {
        scope: 'character',
        id: characterId,
        mountPointId,
      });
    },
    async read(path) {
      const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, requirePath(path));
      return doc ? parse(doc) : null;
    },
    idForPath,
    parse,
  };
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve `{ scope, id }` to a location, or null when the owner is missing
 * (or, for a character, not `userId`'s, archived, or vaultless), when a
 * non-General scope arrives without an id, or when the backing store doesn't
 * exist and `ensure` is off (or can't be provisioned).
 */
export async function resolveScenarioLocation(
  scope: StoreScenarioScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
  opts?: ResolveScenarioLocationOptions,
): Promise<StoreScenarioLocation | null>;
export async function resolveScenarioLocation(
  scope: ScenarioScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
  opts?: ResolveScenarioLocationOptions,
): Promise<ScenarioLocation | null>;
export async function resolveScenarioLocation(
  scope: ScenarioScope,
  id: string | null | undefined,
  repos: RepositoryContainer,
  userId: string,
  opts: ResolveScenarioLocationOptions = {},
): Promise<ScenarioLocation | null> {
  const ensure = opts.ensure === true;
  const location = await resolve(scope, id ?? null, repos, userId, ensure);
  logger.debug('[ScenarioLocation] Resolved scenario location', {
    scope,
    id: id ?? null,
    ensure,
    found: location !== null,
    mountPointId: location?.mountPointId ?? null,
    context: 'scenarios',
  });
  return location;
}

/**
 * Heal the `Scenarios/` folder. Runs only for `ensure: true` callers — a
 * writer about to write, or a startup heal — so a failure is theirs to see:
 * it is logged and rethrown rather than swallowed.
 */
async function ensureScenariosFolder(mountPointId: string): Promise<void> {
  try {
    await ensureFolderPath(mountPointId, SCENARIOS_FOLDER);
  } catch (error) {
    logger.warn('[ScenarioLocation] Failed to ensure Scenarios folder', {
      mountPointId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function resolve(
  scope: ScenarioScope,
  id: string | null,
  repos: RepositoryContainer,
  userId: string,
  ensure: boolean,
): Promise<ScenarioLocation | null> {
  if (scope === 'general') {
    const mountPointId = await getGeneralMountPointId();
    if (!mountPointId) return null;
    if (ensure) await ensureScenariosFolder(mountPointId);
    return storeLocation('general', null, mountPointId, GENERAL_OWNER_NAME, repos);
  }

  if (!id) return null;

  if (scope === 'character') {
    // Raw read: only the row's mount pointer and name are needed, and a
    // broken vault should cost a null rather than a throw.
    const character = usableCharacter(await repos.characters.findByIdRaw(id), userId);
    if (!character) return null;
    return characterLocation(character, character.characterDocumentMountPointId, repos);
  }

  // Raw read: only `name` and `officialMountPointId` are needed.
  const owner =
    scope === 'project' ? await repos.projects.findByIdRaw(id) : await repos.groups.findByIdRaw(id);
  if (!owner) return null;
  const name = owner.name || (scope === 'project' ? 'Project' : 'Group');

  let mountPointId: string | null;
  if (ensure) {
    const ensured = await ensureOwnerOfficialStore(scope, owner.id, name);
    if (!ensured) return null;
    mountPointId = ensured.mountPointId;
    await ensureScenariosFolder(mountPointId);
  } else {
    mountPointId = owner.officialMountPointId ?? null;
  }
  if (!mountPointId) return null;

  return storeLocation(scope, owner.id, mountPointId, name, repos);
}

/** Which owner a mount belongs to, or null when it is none of the four kinds. */
export async function classifyScenarioMount(
  mountPointId: string,
  repos: RepositoryContainer,
  userId: string,
): Promise<{ scope: ScenarioScope; id: string | null } | null> {
  const owner = await classify(mountPointId, repos, userId);
  return owner ? { scope: owner.scope, id: owner.id } : null;
}

/** `classifyScenarioMount`, keeping the character row it read so a ref lookup needn't read it again. */
async function classify(
  mountPointId: string,
  repos: RepositoryContainer,
  userId: string,
): Promise<{ scope: ScenarioScope; id: string | null; character?: CharacterRow } | null> {
  if (mountPointId === (await getGeneralMountPointId())) {
    return { scope: 'general', id: null };
  }

  const character = await repos.characters.findByDocumentMountPointIdRaw(mountPointId);
  if (character) {
    if (character.userId !== userId || character.archivedAt) {
      logger.debug('[ScenarioLocation] Mount belongs to an unavailable character', {
        mountPointId,
        characterId: character.id,
        archived: !!character.archivedAt,
      });
      return null;
    }
    return { scope: 'character', id: character.id, character };
  }

  const project = await repos.projects.findByOfficialMountPointIdRaw(mountPointId);
  if (project) return { scope: 'project', id: project.id };

  const group = await repos.groups.findByOfficialMountPointIdRaw(mountPointId);
  if (group) return { scope: 'group', id: group.id };

  return null;
}

/** The outcome of looking a ref up, for callers that must tell a refusal from a miss. */
export type ScenarioRefLookup =
  | { status: 'ok'; location: ScenarioLocation; scenario: ParsedScenario }
  | { status: 'missing'; location: ScenarioLocation; path: string }
  | { status: 'refused'; reason: string };

/**
 * Look a ref up. `refused` when the path is outside `Scenarios/` (checked
 * before any store read) or the mount is not one of the four kinds of owner;
 * `missing` when the owner is fine but the file is gone.
 */
export async function lookupScenarioRef(
  ref: ScenarioRef,
  repos: RepositoryContainer,
  userId: string,
): Promise<ScenarioRefLookup> {
  const normalized = normalizeScenarioPath(ref.path);
  if (!normalized.ok) {
    logger.warn('[ScenarioLocation] Refused scenario ref: bad path', {
      mountPointId: ref.mountPointId,
      path: ref.path,
      reason: normalized.error,
    });
    return { status: 'refused', reason: normalized.error };
  }

  const owner = await classify(ref.mountPointId, repos, userId);
  if (!owner) {
    logger.warn('[ScenarioLocation] Refused scenario ref: mount is not a scenario owner', {
      mountPointId: ref.mountPointId,
      path: normalized.path,
    });
    return { status: 'refused', reason: 'That store does not hold scenarios' };
  }

  // A character's row was read to classify the mount; build its location from
  // that row rather than reading it again.
  const usable = owner.character ? usableCharacter(owner.character, userId) : null;
  const location = usable
    ? characterLocation(usable, usable.characterDocumentMountPointId, repos)
    : await resolveScenarioLocation(owner.scope, owner.id, repos, userId);
  if (!location) {
    logger.warn('[ScenarioLocation] Refused scenario ref: owner did not resolve', {
      mountPointId: ref.mountPointId,
      scope: owner.scope,
      id: owner.id,
    });
    return { status: 'refused', reason: 'That store does not hold scenarios' };
  }

  const scenario = await location.read(normalized.path);
  if (!scenario) {
    logger.debug('[ScenarioLocation] Scenario ref points at a missing file', {
      mountPointId: ref.mountPointId,
      path: normalized.path,
    });
    return { status: 'missing', location, path: normalized.path };
  }
  return { status: 'ok', location, scenario };
}

