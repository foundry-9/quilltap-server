/**
 * Default image aesthetics + the Ariel Clause.
 *
 * Single source of truth for finding, reading, and writing the three guidance
 * files that shape image-prompt generation:
 *
 *   - `lantern-aesthetics.md`  — general / scene / background look
 *   - `aurora-aesthetics.md`   — how people and their outfits are depicted
 *   - `depiction-guidelines.md` — per-character depiction override (Ariel Clause)
 *
 * Aesthetics resolve across two tiers, project-overrides-global, per file and
 * independently: the active chat's project **official** document store first,
 * then the Quilltap General singleton store. The Ariel Clause is NOT tiered —
 * it reads only the depicted character's own vault root.
 *
 * Every read here fails **soft**: a missing/unreadable guidance file logs a
 * warning and resolves to null/[]. Image generation must never break because a
 * guidance file couldn't be read.
 */

import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
} from '@/lib/mount-index/database-store';

const logger = createServiceLogger('ImageGen:Aesthetic');

export const LANTERN_AESTHETICS_FILENAME = 'lantern-aesthetics.md';
export const AURORA_AESTHETICS_FILENAME = 'aurora-aesthetics.md';
export const DEPICTION_GUIDELINES_FILENAME = 'depiction-guidelines.md';

export type AestheticKind = 'lantern' | 'aurora';

const FILENAME_BY_KIND: Record<AestheticKind, string> = {
  lantern: LANTERN_AESTHETICS_FILENAME,
  aurora: AURORA_AESTHETICS_FILENAME,
};

/** Default cap for an aesthetic block fed into a prompt-crafting call. */
const DEFAULT_AESTHETIC_MAX_CHARS = 4000;
/** Default cap for a single character's depiction-guidelines block. */
const DEFAULT_DEPICTION_MAX_CHARS = 2000;

// ============================================================================
// Low-level store-file primitives (private)
// ============================================================================

/**
 * Read a single named file from one store, trimmed and capped. Returns null
 * when the file is absent, empty/whitespace-only, or unreadable. Whitespace-only
 * is treated as absent so a hand-dropped empty file never suppresses the
 * fallback tier.
 */
async function readStoreFileInternal(
  mountPointId: string,
  filename: string,
  maxChars: number,
): Promise<{ content: string; capped: boolean } | null> {
  try {
    const repos = getRepositories();
    const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, filename);
    if (!doc) return null;
    const trimmed = (doc.content ?? '').trim();
    if (!trimmed) return null;
    if (trimmed.length > maxChars) {
      return { content: trimmed.slice(0, maxChars), capped: true };
    }
    return { content: trimmed, capped: false };
  } catch (err) {
    logger.warn('Failed to read store file; treating as absent', {
      mountPointId,
      filename,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Read a named file from a single store for the editors (raw, untrimmed,
 * uncapped — the editor shows exactly what is on disk). Returns '' when absent;
 * null only on read error.
 */
export async function readStoreFile(
  mountPointId: string,
  filename: string,
): Promise<string | null> {
  try {
    const repos = getRepositories();
    const doc = await repos.docMountDocuments.findByMountPointAndPath(mountPointId, filename);
    return doc?.content ?? '';
  } catch (err) {
    logger.warn('Failed to read store file for editor', {
      mountPointId,
      filename,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Editor writer: empty/whitespace content deletes the file (so clearing a
 * project override restores the fallback); otherwise create-or-update it.
 */
export async function writeStoreFile(
  mountPointId: string,
  filename: string,
  content: string,
): Promise<void> {
  if (!content || !content.trim()) {
    await deleteDatabaseDocument(mountPointId, filename);
    return;
  }
  await writeDatabaseDocument(mountPointId, filename, content);
}

// ============================================================================
// Project official store resolution
// ============================================================================

/**
 * The project's official document store mount id, or null. Reads the slim row
 * via `findByIdRaw` (no validating overlay — it can throw mid-transition) and
 * fails soft. Pass the active chat's `projectId`; a null/absent project yields
 * null (global-only resolution).
 */
export async function getProjectOfficialMountPointId(
  projectId?: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  try {
    const repos = getRepositories();
    const row = await repos.projects.findByIdRaw(projectId);
    return row?.officialMountPointId ?? null;
  } catch (err) {
    logger.warn('Failed to read project official mount id; using global tier only', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ============================================================================
// Aesthetic resolution (tiered: project official overrides Quilltap General)
// ============================================================================

interface ResolveAestheticArgs {
  kind: AestheticKind;
  /** Project tier — the project's OFFICIAL store. Null/undefined ⇒ global only. */
  projectOfficialMountPointId?: string | null;
  maxChars?: number;
}

/**
 * Resolve one aesthetic file. Project official store overrides Quilltap General;
 * returns null when neither tier has (non-empty) content. Never throws.
 */
export async function resolveAesthetic(
  args: ResolveAestheticArgs,
): Promise<string | null> {
  const { kind } = args;
  const maxChars = args.maxChars ?? DEFAULT_AESTHETIC_MAX_CHARS;
  const filename = FILENAME_BY_KIND[kind];

  // Project tier first.
  if (args.projectOfficialMountPointId) {
    const hit = await readStoreFileInternal(args.projectOfficialMountPointId, filename, maxChars);
    if (hit) {
      logger.debug('Aesthetic resolved from project official store', {
        kind,
        mountPointId: args.projectOfficialMountPointId,
        length: hit.content.length,
        capped: hit.capped,
      });
      return hit.content;
    }
  }

  // Global tier fallback.
  const generalMountId = await getGeneralMountPointId();
  if (generalMountId) {
    const hit = await readStoreFileInternal(generalMountId, filename, maxChars);
    if (hit) {
      logger.debug('Aesthetic resolved from Quilltap General store', {
        kind,
        mountPointId: generalMountId,
        length: hit.content.length,
        capped: hit.capped,
      });
      return hit.content;
    }
  }

  logger.debug('No aesthetic resolved (neither tier had content)', { kind });
  return null;
}

/**
 * Single-tier read for the editors: show exactly this store's file (no
 * fallback). Returns '' when absent, null on read error.
 */
export async function readAestheticForMount(
  mountPointId: string,
  kind: AestheticKind,
): Promise<string | null> {
  return readStoreFile(mountPointId, FILENAME_BY_KIND[kind]);
}

/** Editor writer for an aesthetic file; empty content deletes it. */
export async function writeAestheticForMount(
  mountPointId: string,
  kind: AestheticKind,
  content: string,
): Promise<void> {
  await writeStoreFile(mountPointId, FILENAME_BY_KIND[kind], content);
}

// ============================================================================
// Shared route helpers (project + system aesthetic editors)
// ============================================================================

/**
 * Parse the `kind` query param for an aesthetic editor route. Returns the typed
 * kind, or null when absent/invalid (caller responds with a 400).
 */
export function parseAestheticKind(req: NextRequest): AestheticKind | null {
  const kind = req.nextUrl.searchParams.get('kind');
  return kind === 'lantern' || kind === 'aurora' ? kind : null;
}

/** Request-body schema for the aesthetic editor PUT routes. */
export const aestheticContentSchema = z.object({ content: z.string() });

/**
 * Single-tier read for an aesthetic editor route, coalescing the "absent" and
 * read-error cases to `''` so callers can return the value directly.
 */
export async function readAesthetic(
  mountPointId: string,
  kind: AestheticKind,
): Promise<string> {
  const content = await readAestheticForMount(mountPointId, kind);
  return content ?? '';
}

/** Editor writer for an aesthetic editor route; empty content deletes the file. */
export async function writeAesthetic(
  mountPointId: string,
  kind: AestheticKind,
  content: string,
): Promise<void> {
  await writeAestheticForMount(mountPointId, kind, content);
}

// ============================================================================
// The Ariel Clause — per-character depiction guidelines (NOT tiered)
// ============================================================================

export interface DepictionGuideline {
  characterId: string;
  characterName: string;
  content: string;
}

interface DepictedCharacter {
  id: string;
  name: string;
  characterDocumentMountPointId?: string | null;
}

/**
 * For each depicted character, read `depiction-guidelines.md` from that
 * character's own vault root. Characters without a vault or without the file
 * are skipped. Each contributing guideline is logged at INFO level — it is a
 * mandatory clause and its application must be auditable.
 *
 * Reads only the character's own vault; unaffected by project/global tiers.
 */
export async function resolveDepictionGuidelines(
  characters: DepictedCharacter[],
  maxCharsEach: number = DEFAULT_DEPICTION_MAX_CHARS,
): Promise<DepictionGuideline[]> {
  const out: DepictionGuideline[] = [];
  for (const character of characters) {
    if (!character.characterDocumentMountPointId) {
      logger.debug('Character has no vault; skipping depiction guidelines', {
        characterId: character.id,
        characterName: character.name,
      });
      continue;
    }
    const hit = await readStoreFileInternal(
      character.characterDocumentMountPointId,
      DEPICTION_GUIDELINES_FILENAME,
      maxCharsEach,
    );
    if (!hit) {
      logger.debug('No depiction guidelines for character', {
        characterId: character.id,
        characterName: character.name,
        mountPointId: character.characterDocumentMountPointId,
      });
      continue;
    }
    logger.info('Applying mandatory depiction guidelines for character', {
      characterId: character.id,
      characterName: character.name,
      mountPointId: character.characterDocumentMountPointId,
      length: hit.content.length,
      capped: hit.capped,
    });
    out.push({
      characterId: character.id,
      characterName: character.name,
      content: hit.content,
    });
  }
  return out;
}
