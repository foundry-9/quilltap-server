/**
 * Pure parsing/validation helpers for character vault files.
 *
 * Each parser turns raw file content (JSON or markdown-with-frontmatter) into
 * a validated domain value, falling back to null and logging a warning when
 * the content is missing/malformed so a single bad file never blows up a whole
 * overlay read. None of these reach the database; they operate on already-read
 * content (or pre-fetched `DocMountDocument`s).
 *
 * @module characters/vault/parsers
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import type {
  CharacterRow,
  CharacterSystemPrompt,
  CharacterScenario,
} from '@/lib/schemas/types';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { sortScenarios } from '@/lib/scenarios/sort';
import type {
  DocMountDocumentWithLink as DocMountDocument,
} from '@/lib/database/repositories/doc-mount-documents.repository';

import { resolveFileItemId, stableUuidFromString } from '@/lib/utils/stable-uuid';
import {
  CharacterVaultPropertiesSchema,
  type CharacterVaultProperties,
  CharacterVaultMetadataSchema,
  type CharacterVaultMetadata,
  CharacterVaultPhysicalPromptsSchema,
  type CharacterVaultPhysicalPrompts,
} from './file-schemas';

export { stableUuidFromString };

/**
 * Returns true if this character has a linked vault and is therefore subject
 * to vault-managed-field routing. Post-cutover this is the only condition;
 * the per-character opt-in flag is gone.
 */
export function hasLinkedVault(character: Pick<CharacterRow, 'characterDocumentMountPointId'>): boolean {
  return !!character.characterDocumentMountPointId;
}

/**
 * Parse one JSON-backed vault file into a validated value, returning null (and
 * logging a warning) when the content is missing/malformed or fails schema
 * validation. The single shape shared by every JSON vault parser below; each
 * caller supplies only its schema, log messages, and log context.
 */
export function parseJsonVaultFile<T>(
  raw: string,
  schema: z.ZodType<T>,
  opts: {
    parseErrorMessage: string;
    validationErrorMessage: string;
    logContext: Record<string, unknown>;
  },
): T | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    logger.warn(opts.parseErrorMessage, {
      ...opts.logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.warn(opts.validationErrorMessage, {
      ...opts.logContext,
      issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }

  return parsed.data;
}

export function parseVaultProperties(
  raw: string,
  characterId: string,
): CharacterVaultProperties | null {
  return parseJsonVaultFile(raw, CharacterVaultPropertiesSchema, {
    parseErrorMessage: 'Invalid JSON in vault properties.json; falling back to DB values',
    validationErrorMessage: 'Vault properties.json failed schema validation; falling back to DB values',
    logContext: { characterId },
  });
}

/**
 * Parse `metadata.json` — the character's freeform fact sheet.
 *
 * Returns null for anything that isn't a JSON object (invalid JSON, a
 * top-level array, a bare scalar), and the caller hydrates `{}` instead.
 * Deliberately unlike `properties.json`: metadata is not a keystone, so a file
 * the user fat-fingered costs them their metadata for that read and nothing
 * else. Hollowing the character over it would be wildly out of proportion to a
 * missing brace.
 */
export function parseVaultMetadata(
  raw: string,
  characterId: string,
  mountPointId?: string,
): CharacterVaultMetadata | null {
  return parseJsonVaultFile(raw, CharacterVaultMetadataSchema, {
    parseErrorMessage: 'Invalid JSON in vault metadata.json; hydrating empty metadata',
    validationErrorMessage: 'Vault metadata.json is not a JSON object; hydrating empty metadata',
    logContext: { characterId, mountPointId },
  });
}

export function parseVaultPhysicalPrompts(
  raw: string,
  characterId: string,
): CharacterVaultPhysicalPrompts | null {
  return parseJsonVaultFile(raw, CharacterVaultPhysicalPromptsSchema, {
    parseErrorMessage: 'Invalid JSON in vault physical-prompts.json; falling back to DB values',
    validationErrorMessage: 'Vault physical-prompts.json failed schema validation; falling back to DB values',
    logContext: { characterId },
  });
}

/**
 * Convert markdown file content into an overlay value. Empty strings become
 * null so that clearing a file collapses to the "unset" state that nullable
 * schema fields expect.
 */
export function markdownToNullable(content: string): string | null {
  return content === '' ? null : content;
}

/** Why a `Prompts/*.md` file is not a prompt, or its parsed fields. */
type PromptFileFields =
  | { ok: true; name: string; isDefault: boolean; body: string; id: unknown }
  | { ok: false; reason: 'no-frontmatter' | 'no-name' | 'empty-body' };

/**
 * The one reading of a `Prompts/*.md` file, shared by {@link parsePromptFile}
 * (which logs why a file is skipped) and {@link isPromptItemDocument} (which
 * must stay quiet). Frontmatter supplies `name` and `isDefault`; the body after
 * the closing `---` is the prompt.
 */
function readPromptFileFields(content: string): PromptFileFields {
  const parsed = parseFrontmatter(content);
  if (!parsed.data) return { ok: false, reason: 'no-frontmatter' };
  const name = parsed.data.name;
  if (typeof name !== 'string' || name.trim().length === 0) return { ok: false, reason: 'no-name' };
  const body = content.slice(parsed.bodyStartOffset).trimStart();
  if (body.length === 0) return { ok: false, reason: 'empty-body' };
  return { ok: true, name, isDefault: parsed.data.isDefault === true, body, id: parsed.data.id };
}

const PROMPT_SKIP_MESSAGES: Record<Exclude<PromptFileFields, { ok: true }>['reason'], string> = {
  'no-frontmatter': 'Prompts/*.md file has no parseable frontmatter; skipping',
  'no-name': 'Prompts/*.md file missing `name` in frontmatter; skipping',
  'empty-body': 'Prompts/*.md body is empty; skipping',
};

/**
 * Parse a prompt-variant file. The YAML frontmatter carries the display name
 * and isDefault flag; the body (after the closing ---) becomes the prompt
 * content. Files without frontmatter or without a `name` field are skipped.
 */
export function parsePromptFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterSystemPrompt | null {
  const fields = readPromptFileFields(doc.content);
  if (!fields.ok) {
    logger.warn(PROMPT_SKIP_MESSAGES[fields.reason], {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }
  return {
    id: resolveFileItemId(fields.id, 'prompt', doc.mountPointId, doc.relativePath),
    name: fields.name.trim().slice(0, 100),
    content: fields.body,
    isDefault: fields.isDefault,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * True for a `Prompts/*.md` document that parses as a prompt — exactly the
 * files {@link parsePromptFile} turns into items. The prompt projection sweeps
 * only these, so a draft the operator wrote by hand without frontmatter is
 * never deleted by a prompt save. Quiet: no logging.
 */
export function isPromptItemDocument(doc: { relativePath: string; content?: string | null }): boolean {
  return readPromptFileFields(doc.content ?? '').ok;
}

/** Why a `Scenarios/*.md` file is not a scenario, or its parsed fields. */
type ScenarioFileFields =
  | { ok: true; title: string; body: string; description?: string; archived: boolean; id: unknown }
  | { ok: false; reason: 'no-title' | 'empty-body' };

/**
 * The one reading of a `Scenarios/*.md` file, shared by
 * {@link parseScenarioFile} (which logs) and {@link isScenarioItemDocument}
 * (which must stay quiet). Title: frontmatter `name`, then the first
 * `# heading`, then the file name without its extension.
 */
function readScenarioFileFields(content: string, fileName: string): ScenarioFileFields {
  const parsed = parseFrontmatter(content);

  let title: string | null = null;
  let description: string | undefined;
  if (parsed.data) {
    const name = parsed.data.name;
    if (typeof name === 'string' && name.trim().length > 0) {
      title = name.trim();
    }
    const fmDescription = parsed.data.description;
    if (typeof fmDescription === 'string' && fmDescription.trim().length > 0) {
      description = fmDescription.trim().slice(0, 500);
    }
  }
  // Absence means active — matches the file-backed scenario scopes.
  const archived = parsed.data?.archived === true || parsed.data?.archived === 'true';

  // Body excludes the frontmatter block (parsed.bodyStartOffset is 0 when
  // no frontmatter was present, so this is safe in either case).
  const afterFrontmatter = content.slice(parsed.bodyStartOffset);
  const lines = afterFrontmatter.split('\n');
  let titleLineIndex = -1;

  if (title === null) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#\s+(.+)$/);
      if (match) {
        titleLineIndex = i;
        title = match[1].trim();
        break;
      }
    }
  }

  if (title === null) {
    title = fileName.replace(/\.md$/i, '').trim().slice(0, 200);
    if (title.length === 0) return { ok: false, reason: 'no-title' };
  }

  // Body: when a `# heading` was used as the title, drop that line; otherwise
  // use everything after the frontmatter block.
  const body = titleLineIndex >= 0
    ? lines.slice(titleLineIndex + 1).join('\n').trim()
    : afterFrontmatter.trim();
  if (body.length === 0) return { ok: false, reason: 'empty-body' };

  return { ok: true, title, body, ...(description !== undefined && { description }), archived, id: parsed.data?.id };
}

/**
 * Parse a scenario file. Frontmatter — when present — supplies `name` (title)
 * and `description`; the body after the closing `---` becomes the scenario
 * content. When no frontmatter is present, falls back to the legacy heading
 * convention: the first `# heading` is the title and everything after it is
 * the body. Files with neither fall back to the filename-without-extension as
 * the title so malformed files are still visible rather than silently dropped.
 *
 * The file-backed scenario tiers (`lib/mount-index/scenarios-common.ts`, via
 * the scenario location in `lib/scenarios/location.ts`) use the same
 * shape (frontmatter-first, heading-fallback) for symmetry between vault and
 * project scenario authoring.
 */
export function parseScenarioFile(
  doc: DocMountDocument,
  characterId: string,
): CharacterScenario | null {
  const fields = readScenarioFileFields(doc.content, doc.fileName);
  if (!fields.ok) {
    logger.warn(
      fields.reason === 'no-title'
        ? 'Scenarios/*.md file has no title; skipping'
        : 'Scenarios/*.md body is empty; skipping',
      { characterId, mountPointId: doc.mountPointId, relativePath: doc.relativePath },
    );
    return null;
  }
  return {
    id: resolveFileItemId(fields.id, 'scenario', doc.mountPointId, doc.relativePath),
    title: fields.title.slice(0, 200),
    content: fields.body,
    ...(fields.description !== undefined && { description: fields.description }),
    ...(fields.archived && { archived: true }),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * True for a `Scenarios/*.md` document that parses as a scenario — exactly the
 * files {@link parseScenarioFile} turns into items. The scenario projection
 * sweeps only these, so a file with an empty body (a scenario still being
 * written by hand) is never deleted by a scenario save. Quiet: no logging.
 */
export function isScenarioItemDocument(doc: { relativePath: string; content?: string | null }): boolean {
  const fileName = doc.relativePath.slice(doc.relativePath.lastIndexOf('/') + 1);
  return readScenarioFileFields(doc.content ?? '', fileName).ok;
}

/**
 * Exactly one prompt is the default. Frontmatter declaring several keeps the
 * first; declaring none promotes the first, so a reader can always pick a
 * default. The one copy of this rule — the hydrator calls it.
 */
export function normalizeDefaultPrompt(prompts: CharacterSystemPrompt[]): CharacterSystemPrompt[] {
  if (prompts.length === 0) return prompts;
  let seenDefault = false;
  const out = prompts.map((p) => {
    if (!p.isDefault) return p;
    if (seenDefault) return { ...p, isDefault: false };
    seenDefault = true;
    return p;
  });
  if (!seenDefault) out[0] = { ...out[0], isDefault: true };
  return out;
}

/**
 * Parse every `Scenarios/*.md` document of one vault and return them in
 * display order — title, then filename, leading "The" ignored
 * (`lib/scenarios/sort.ts`). The one way a vault's scenario array is built, so
 * `character.scenarios` and therefore its "first scenario" agree with every
 * picker.
 */
export function parseScenarioFilesSorted(
  docs: DocMountDocument[],
  characterId: string,
): CharacterScenario[] {
  const parsed: Array<{ doc: DocMountDocument; scenario: CharacterScenario }> = [];
  for (const doc of docs) {
    const scenario = parseScenarioFile(doc, characterId);
    if (scenario) parsed.push({ doc, scenario });
  }
  return sortScenarios(parsed, ({ doc, scenario }) => ({
    title: scenario.title,
    filename: doc.fileName.replace(/\.md$/i, ''),
    path: doc.relativePath,
  })).map(({ scenario }) => scenario);
}
