/**
 * Subprompts — smaller, optional instructions kept in a character's vault.
 *
 * A subprompt is one Markdown file in the root-level `Subprompts/` folder of a
 * character's database-backed vault: a `title` in the frontmatter, the
 * instruction itself as the body, written in the second person like every
 * other prompt the character receives. A chat picks which of them are in play
 * per participant (`selectedSubpromptIds` on the participant record), and the
 * chosen ones ride into the compiled identity stack directly after the
 * character's system prompt — and into the green-room dressing call when the
 * character chooses their own opening outfit.
 *
 * The folder is a lazy convention like Suparṇā's `Mail/` and Pascal's `Tools/`:
 * never scaffolded, created on the first write, and a missing folder lists as
 * empty rather than erroring. The file name (sans `.md`) is the subprompt's
 * id, so a selection survives edits to the title.
 *
 * Everything here is a content read/write, a folder ensure, or a single-file
 * delete. Reads and writes are meant for the parent (API routes and the
 * identity-stack compiler); nothing here is called from the forked job child.
 *
 * @module subprompts
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  listDatabaseFiles,
  readDatabaseDocument,
  writeDatabaseDocument,
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';

const logger = createServiceLogger('Subprompts');

/** Root-level vault folder holding a character's subprompts. */
export const SUBPROMPTS_FOLDER = 'Subprompts';

/** Longest title accepted; also bounds the derived file name. */
export const SUBPROMPT_TITLE_MAX_LENGTH = 100;

/** Longest id accepted — a file name sans extension. */
export const SUBPROMPT_ID_MAX_LENGTH = 120;

/** A subprompt as read from the vault. */
export interface Subprompt {
  /** File name without `.md` — stable across title edits. */
  id: string;
  /** Vault-relative path, `Subprompts/<id>.md`. */
  path: string;
  /** From frontmatter `title`; falls back to the id when absent. */
  title: string;
  /** The instruction body (no frontmatter). */
  content: string;
  /** ISO 8601 timestamp of the underlying file's last modification. */
  updatedAt: string;
}

/** The slice of a subprompt a prompt builder needs. */
export interface SubpromptForPrompt {
  title: string;
  content: string;
}

export class SubpromptNotFoundError extends Error {
  constructor(public readonly characterId: string, public readonly subpromptId: string) {
    super(`Subprompt "${subpromptId}" not found for character ${characterId}`);
    this.name = 'SubpromptNotFoundError';
  }
}

export class SubpromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubpromptValidationError';
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * A subprompt id is one path segment: no slashes, no `.`/`..`, no control or
 * filesystem-reserved characters, and short enough to be a file name.
 */
export function isValidSubpromptId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > SUBPROMPT_ID_MAX_LENGTH) return false;
  if (id === '.' || id === '..') return false;
  if (/[\\\/<>:"|?*]/.test(id)) return false;
  for (let i = 0; i < id.length; i += 1) { if (id.charCodeAt(i) < 32) return false; }
  if (id.trim() !== id) return false;
  return true;
}

/** Vault-relative path for a subprompt id. */
export function subpromptPathForId(id: string): string {
  return `${SUBPROMPTS_FOLDER}/${id}.md`;
}

/**
 * Derive a file-name slug from a title: lower-case, letters/digits/hyphens
 * only, collapsed, trimmed, capped. A title that yields nothing becomes
 * `subprompt`.
 */
export function slugifySubpromptTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'subprompt';
}

/** Compose the on-disk content: frontmatter + a blank line + the body. */
export function composeSubpromptContent(title: string, content: string): string {
  return `${serializeFrontmatter({ title })}\n${content.trim()}\n`;
}

/**
 * Parse a subprompt file. The title falls back to the id when the frontmatter
 * carries none, so a file dropped straight into the folder still lists.
 */
export function parseSubpromptContent(
  id: string,
  raw: string,
  updatedAt: string,
): Subprompt {
  const parsed = parseFrontmatter(raw);
  const data = parsed.data ?? {};
  const body = raw.slice(parsed.bodyStartOffset).replace(/^\n+/, '').trimEnd();
  const title = typeof data.title === 'string' && data.title.trim().length > 0
    ? data.title.trim()
    : id;
  return { id, path: subpromptPathForId(id), title, content: body, updatedAt };
}

/**
 * Only files directly inside `Subprompts/` count — `listDatabaseFiles` filters
 * by prefix, so a nested `Subprompts/drafts/x.md` would otherwise sneak in.
 */
function isRootSubpromptFile(relativePath: string): boolean {
  const prefix = `${SUBPROMPTS_FOLDER}/`;
  if (!relativePath.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  const rest = relativePath.slice(prefix.length);
  return !rest.includes('/') && rest.toLowerCase().endsWith('.md');
}

function idFromRelativePath(relativePath: string): string {
  const fileName = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  return fileName.replace(/\.md$/i, '');
}

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new SubpromptValidationError('A subprompt needs a title');
  }
  if (trimmed.length > SUBPROMPT_TITLE_MAX_LENGTH) {
    throw new SubpromptValidationError(
      `A subprompt title is at most ${SUBPROMPT_TITLE_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new SubpromptValidationError('A subprompt needs some instruction text');
  }
  return trimmed;
}

// ── Vault resolution ─────────────────────────────────────────────────────────

/**
 * The vault id for reads: overlay-free lookup so a broken vault does not turn
 * a listing into a throw. `null` when the character is missing or has no
 * vault. Archived characters still resolve — reads are harmless, and a chat
 * that still carries the seat should keep compiling the same prompt.
 */
async function resolveVaultForRead(characterId: string): Promise<string | null> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  return character?.characterDocumentMountPointId ?? null;
}

/**
 * The vault id for writes. Refuses an archived character (the vault is a
 * tombstone) and provisions a vault for a live character that somehow lacks
 * one — the same posture as the wardrobe writers.
 */
async function resolveVaultForWrite(characterId: string): Promise<string> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character) {
    throw new SubpromptNotFoundError(characterId, '(character)');
  }
  if (character.archivedAt) {
    throw new CharacterArchivedError(characterId);
  }
  if (character.characterDocumentMountPointId) {
    return character.characterDocumentMountPointId;
  }
  const ensured = await ensureCharacterVault(character);
  logger.warn('Provisioned a vault for a character with none before writing a subprompt', {
    characterId,
    mountPointId: ensured.mountPointId,
  });
  return ensured.mountPointId;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * List a vault's subprompts, sorted by title (then id). A missing or empty
 * folder is `[]`, never an error; a file that fails to read is skipped with a
 * warning so one bad file cannot hide the rest.
 */
export async function listSubpromptsInVault(vaultId: string): Promise<Subprompt[]> {
  const entries = await listDatabaseFiles(vaultId, { folder: SUBPROMPTS_FOLDER });
  const files = entries.filter((e) => e.kind !== 'folder' && isRootSubpromptFile(e.relativePath));

  const out: Subprompt[] = [];
  for (const entry of files) {
    try {
      const { content, mtime } = await readDatabaseDocument(vaultId, entry.relativePath);
      const updatedAt = new Date(mtime).toISOString();
      out.push(parseSubpromptContent(idFromRelativePath(entry.relativePath), content, updatedAt));
    } catch (error) {
      logger.warn('Skipping unreadable subprompt file', {
        vaultId,
        relativePath: entry.relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  out.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  logger.debug('Listed subprompts', { vaultId, count: out.length });
  return out;
}

/** List a character's subprompts. No vault → `[]`. */
export async function listCharacterSubprompts(characterId: string): Promise<Subprompt[]> {
  const vaultId = await resolveVaultForRead(characterId);
  if (!vaultId) {
    logger.debug('Character has no vault; no subprompts', { characterId });
    return [];
  }
  return listSubpromptsInVault(vaultId);
}

/** Read one subprompt by id. `null` when absent (or the character has no vault). */
export async function readCharacterSubprompt(
  characterId: string,
  subpromptId: string,
): Promise<Subprompt | null> {
  if (!isValidSubpromptId(subpromptId)) return null;
  const vaultId = await resolveVaultForRead(characterId);
  if (!vaultId) return null;
  try {
    const { content, mtime } = await readDatabaseDocument(vaultId, subpromptPathForId(subpromptId));
    return parseSubpromptContent(subpromptId, content, new Date(mtime).toISOString());
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * Resolve a participant's selection to the subprompts that still exist, in
 * the order they appear in the vault listing (by title) so the prompt is
 * stable regardless of the order boxes were ticked. Ids that no longer match
 * a file are dropped with a debug log — a deleted subprompt must never sink a
 * turn. Fails soft to `[]` on any read error for the same reason.
 */
export async function resolveSelectedSubprompts(
  characterId: string,
  selectedIds: readonly string[] | null | undefined,
): Promise<SubpromptForPrompt[]> {
  if (!selectedIds || selectedIds.length === 0) return [];
  try {
    const all = await listCharacterSubprompts(characterId);
    const wanted = new Set(selectedIds.map((id) => id.toLowerCase()));
    const found = all.filter((s) => wanted.has(s.id.toLowerCase()));
    if (found.length !== wanted.size) {
      logger.debug('Some selected subprompts no longer exist', {
        characterId,
        selected: selectedIds.length,
        found: found.length,
      });
    }
    return found.map(({ title, content }) => ({ title, content }));
  } catch (error) {
    logger.warn('Failed to resolve selected subprompts — continuing without them', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Create a subprompt. Ensures the `Subprompts/` folder exists first, picks a
 * collision-free id from the title, and writes the file.
 */
export async function createCharacterSubprompt(
  characterId: string,
  input: { title: string; content: string },
): Promise<Subprompt> {
  const title = validateTitle(input.title);
  const content = validateContent(input.content);
  const vaultId = await resolveVaultForWrite(characterId);

  // ensureFolderPath is idempotent (mkdir -p); writeDatabaseDocument also
  // creates parents, but the explicit ensure makes the folder row exist even
  // before the first listing.
  await ensureFolderPath(vaultId, SUBPROMPTS_FOLDER);

  const existing = new Set((await listSubpromptsInVault(vaultId)).map((s) => s.id.toLowerCase()));
  const base = slugifySubpromptTitle(title);
  let id = base;
  let n = 2;
  while (existing.has(id.toLowerCase())) {
    id = `${base}-${n}`;
    n += 1;
  }

  const { mtime } = await writeDatabaseDocument(
    vaultId,
    subpromptPathForId(id),
    composeSubpromptContent(title, content),
  );
  logger.info('Created subprompt', { characterId, vaultId, subpromptId: id });
  return { id, path: subpromptPathForId(id), title, content, updatedAt: new Date(mtime).toISOString() };
}

/** Update a subprompt's title and/or content in place. The id never changes. */
export async function updateCharacterSubprompt(
  characterId: string,
  subpromptId: string,
  patch: { title?: string; content?: string },
): Promise<Subprompt> {
  if (!isValidSubpromptId(subpromptId)) {
    throw new SubpromptNotFoundError(characterId, subpromptId);
  }
  const vaultId = await resolveVaultForWrite(characterId);
  const path = subpromptPathForId(subpromptId);

  let current: Subprompt;
  try {
    const { content, mtime } = await readDatabaseDocument(vaultId, path);
    current = parseSubpromptContent(subpromptId, content, new Date(mtime).toISOString());
  } catch (error) {
    if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
      throw new SubpromptNotFoundError(characterId, subpromptId);
    }
    throw error;
  }

  const title = patch.title !== undefined ? validateTitle(patch.title) : current.title;
  const content = patch.content !== undefined ? validateContent(patch.content) : current.content;

  const { mtime } = await writeDatabaseDocument(vaultId, path, composeSubpromptContent(title, content));
  logger.info('Updated subprompt', {
    characterId,
    vaultId,
    subpromptId,
    changed: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined),
  });
  return { id: subpromptId, path, title, content, updatedAt: new Date(mtime).toISOString() };
}

/** Delete a subprompt. Returns false when there was nothing to delete. */
export async function deleteCharacterSubprompt(
  characterId: string,
  subpromptId: string,
): Promise<boolean> {
  if (!isValidSubpromptId(subpromptId)) return false;
  const vaultId = await resolveVaultForWrite(characterId);
  const deleted = await deleteDatabaseDocument(vaultId, subpromptPathForId(subpromptId));
  logger.info('Deleted subprompt', { characterId, vaultId, subpromptId, deleted });
  return deleted;
}
