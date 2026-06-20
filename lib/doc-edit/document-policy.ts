/**
 * Per-document policy frontmatter (`embed`, `character_read`, `character_write`)
 *
 * A mounted markdown document may carry three frontmatter properties that
 * govern how Quilltap treats it:
 *
 *   - `embed`          — whether the document is embedded for semantic retrieval
 *   - `character_read` — whether any LLM character may read it (doc_ tools + RAG)
 *   - `character_write`— whether any LLM character may mutate it (doc_ tools)
 *
 * Each **defaults to `true`** and is only `false` when the frontmatter says so.
 * Values may be quoted strings (`"false"`) or bare YAML (`false`); coercion is
 * case-insensitive and treats `false`/`no`/`0`/`off`/`n` as false, with absent
 * or unrecognized values falling back to the permissive default.
 *
 * This module is the SINGLE SOURCE OF TRUTH for coercing those three flags off
 * frontmatter. Every indexer / migration / tool gate that needs them imports
 * the helpers here rather than re-deriving the coercion — that drift is exactly
 * what bit `enabled`-style flags elsewhere.
 *
 * The flags are persisted on the `doc_mount_file_links` row (positive-sense
 * `allow*` columns) so the scheduler and RAG path read them without re-parsing
 * disk on every call; see the columns' semantics in DDL.md.
 *
 * @module doc-edit/document-policy
 */

import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';

export interface DocumentPolicy {
  /** Embed for semantic retrieval. Default true. */
  embed: boolean;
  /** Readable by LLM characters (doc_ read tools, listing, RAG). Default true. */
  characterRead: boolean;
  /** Mutable by LLM characters (doc_ write/move/delete tools). Default true. */
  characterWrite: boolean;
}

export const DEFAULT_DOCUMENT_POLICY: DocumentPolicy = {
  embed: true,
  characterRead: true,
  characterWrite: true,
};

const FALSE_TOKENS = new Set(['false', 'no', '0', 'off', 'n']);
const TRUE_TOKENS = new Set(['true', 'yes', '1', 'on', 'y']);

/**
 * Coerce a frontmatter value to a policy boolean.
 *
 * Treats the QUOTED-STRING forms (`"false"`/`"no"`/`"0"`/`"off"`/`"n"`) and the
 * bare YAML `false`/`0` as false; absent or anything-else as the permissive
 * default. Case-insensitive, whitespace-trimmed.
 *
 * @param value    The raw frontmatter value (any YAML-parsed type)
 * @param fallback The default when the value is absent or unrecognized (true)
 */
export function coercePolicyBool(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '') return fallback;
    if (FALSE_TOKENS.has(v)) return false;
    if (TRUE_TOKENS.has(v)) return true;
    return fallback; // unrecognized string → default
  }
  return fallback;
}

/**
 * Read the three policy flags from already-parsed frontmatter data.
 *
 * `character_read` is the master gate: a document characters cannot read can be
 * neither retrieved (embedded) nor written. So when `character_read` is false
 * the other two are forced false regardless of what they say — the cascade is
 * materialized HERE, once, so every downstream consumer (persisted `allow*`
 * columns, the embedding scheduler, RAG, the doc_ gates) inherits the effective
 * policy without re-deriving it. When `character_read` is true the `embed` and
 * `character_write` settings stand on their own.
 */
export function policyFromFrontmatterData(
  data: Record<string, unknown> | null
): DocumentPolicy {
  if (!data) return { ...DEFAULT_DOCUMENT_POLICY };
  const characterRead = coercePolicyBool(data['character_read']);
  return {
    embed: characterRead && coercePolicyBool(data['embed']),
    characterRead,
    characterWrite: characterRead && coercePolicyBool(data['character_write']),
  };
}

/**
 * Parse raw file text → policy. Non-markdown / no-frontmatter / malformed
 * frontmatter all fall back to the permissive all-true default.
 *
 * IMPORTANT: pass the RAW file content that still contains the frontmatter
 * block, not the frontmatter-stripped plain text used for chunking.
 */
export function policyFromContent(content: string): DocumentPolicy {
  try {
    const { data } = parseFrontmatter(content);
    return policyFromFrontmatterData(data);
  } catch {
    return { ...DEFAULT_DOCUMENT_POLICY };
  }
}
