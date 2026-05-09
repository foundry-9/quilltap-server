/**
 * Knowledge Injector
 *
 * Per-turn retrieval of relevant files from the responding character's
 * vault `Knowledge/` folder. Parallels `memory-injector.ts` but operates on
 * the document-chunk index (the same index that powers the unified search
 * tool's `documents` and `knowledge` sources).
 *
 * Output is a single formatted string ready to drop into
 * `CommonplaceParts.knowledge`. Each entry is either:
 *
 *   - **Inline**: full file body (≤ 500 tokens by default), with frontmatter
 *     tags surfaced on a header line and a `doc_read_file` pointer footer in
 *     case the LLM wants to re-read with offset/limit.
 *   - **Pointer**: a teaser plus a `doc_read_file` call template. Used when
 *     the file body is too large, when the file is a derived blob (PDF,
 *     DOCX), or when the inline form would exceed the remaining budget.
 *
 * Greedy packing by relevance score under a caller-supplied token budget.
 * Errors are converted to warnings by the caller — never throw mid-turn.
 *
 * @module chat/context/knowledge-injector
 */

import type { Provider } from '@/lib/schemas/types';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { searchDocumentChunks } from '@/lib/mount-index/document-search';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { estimateTokens } from '@/lib/tokens/token-counter';
import { getRepositories } from '@/lib/repositories/factory';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('KnowledgeInjector');

const DEFAULT_CANDIDATE_LIMIT = 5;
const DEFAULT_INLINE_TOKEN_THRESHOLD = 500;
const DEFAULT_MIN_SCORE = 0.3;
const POINTER_TEASER_MAX_CHARS = 120;

export interface KnowledgeRetrievalParams {
  characterId: string;
  userId: string;
  embeddingProfileId?: string;
  query: string;
  vaultMountPointId: string;
  budgetTokens: number;
  provider: Provider;
  /** Override default 0.3 minimum cosine score */
  minScore?: number;
  /** Override default 5 candidates from the chunk search */
  candidateLimit?: number;
  /** Override default 500-token inline threshold */
  inlineTokenThreshold?: number;
}

export interface KnowledgeDebugEntry {
  filePath: string;
  score: number;
  inline: boolean;
  tokenCount: number;
}

export interface KnowledgeRetrievalResult {
  /** Formatted block ready for CommonplaceParts.knowledge — empty string if nothing fit. */
  content: string;
  /** Estimated token count of `content` for the caller's accounting. */
  tokenCount: number;
  debug: KnowledgeDebugEntry[];
}

interface Candidate {
  filePath: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'markdown' | 'txt' | 'json' | 'jsonl' | 'blob';
  score: number;
  /** Heading or short teaser pulled from the matched chunk. */
  pointerTeaser: string;
  /** Body for inline candidates; null when the file should be pointer-only. */
  body: string | null;
  /** Tags/topics extracted from frontmatter when present. */
  fmTags: string | null;
}

export async function retrieveKnowledgeForTurn(
  params: KnowledgeRetrievalParams,
): Promise<KnowledgeRetrievalResult> {
  const empty: KnowledgeRetrievalResult = { content: '', tokenCount: 0, debug: [] };

  if (params.budgetTokens <= 0) return empty;
  if (!params.query.trim()) return empty;

  const minScore = params.minScore ?? DEFAULT_MIN_SCORE;
  const candidateLimit = params.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const inlineThreshold = params.inlineTokenThreshold ?? DEFAULT_INLINE_TOKEN_THRESHOLD;

  // 1. Embed the query and search the vault, scoped to Knowledge/.
  let embeddingResult;
  try {
    embeddingResult = await generateEmbeddingForUser(
      params.query,
      params.userId,
      params.embeddingProfileId,
    );
  } catch (error) {
    logger.warn('Failed to generate embedding for knowledge retrieval', {
      characterId: params.characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }

  const hits = await searchDocumentChunks(embeddingResult.embedding, {
    mountPointIds: [params.vaultMountPointId],
    pathPrefix: 'Knowledge/',
    limit: candidateLimit,
    minScore,
  });

  if (hits.length === 0) {
    return empty;
  }

  // 2. Resolve the vault's display name once for pointer templates. Reading
  // the literal name from the record (rather than reconstructing it) keeps
  // pointers correct if the system ever disambiguates duplicate vault names.
  const repos = getRepositories();
  const vault = await repos.docMountPoints.findById(params.vaultMountPointId);
  const vaultName = vault?.name ?? hits[0]?.mountPointName ?? 'Character Vault';

  // 3. Build a candidate per hit, deciding inline vs pointer based on file
  // type and size. Files that disappeared between scan and now are skipped.
  const candidates: Candidate[] = [];

  for (const hit of hits) {
    try {
      const file = await repos.docMountFiles.findByMountPointAndPath(
        params.vaultMountPointId,
        hit.relativePath,
      );

      if (!file) {
        logger.debug('Knowledge hit file no longer present, skipping', {
          characterId: params.characterId,
          path: hit.relativePath,
        });
        continue;
      }

      const teaser = buildPointerTeaser(hit.headingContext, hit.content);

      // Derived blobs (pdf, docx, blob) are always pointer-only — the
      // extracted text can be huge and is the wrong granularity for recall.
      if (file.fileType === 'pdf' || file.fileType === 'docx' || file.fileType === 'blob') {
        candidates.push({
          filePath: hit.relativePath,
          fileName: hit.fileName,
          fileType: file.fileType,
          score: hit.score,
          pointerTeaser: teaser,
          body: null,
          fmTags: null,
        });
        continue;
      }

      // Text-shaped files: try to load the document body.
      const doc = await repos.docMountDocuments.findByMountPointAndPath(
        params.vaultMountPointId,
        hit.relativePath,
      );

      if (!doc) {
        // No doc row but the file row exists — fall back to pointer.
        candidates.push({
          filePath: hit.relativePath,
          fileName: hit.fileName,
          fileType: file.fileType,
          score: hit.score,
          pointerTeaser: teaser,
          body: null,
          fmTags: null,
        });
        continue;
      }

      let fmTags: string | null = null;
      if (file.fileType === 'markdown') {
        try {
          const fm = parseFrontmatter(doc.content);
          if (fm.data) {
            fmTags = renderFrontmatterTags(fm.data);
          }
        } catch (error) {
          logger.debug('Frontmatter parse failed for knowledge file', {
            path: hit.relativePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const bodyTokens = estimateTokens(doc.content, params.provider);

      candidates.push({
        filePath: hit.relativePath,
        fileName: hit.fileName,
        fileType: file.fileType,
        score: hit.score,
        pointerTeaser: teaser,
        body: bodyTokens <= inlineThreshold ? doc.content : null,
        fmTags,
      });
    } catch (error) {
      logger.debug('Knowledge candidate construction failed, skipping', {
        path: hit.relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (candidates.length === 0) {
    return empty;
  }

  // 4. Greedy pack into the budget. Try each candidate inline first (when
  // it has a body); if the inline form would overflow, demote to pointer.
  // After a single pass we stop the moment the next entry won't fit.
  candidates.sort((a, b) => b.score - a.score);

  const sections: string[] = [];
  const debug: KnowledgeDebugEntry[] = [];
  let runningTokens = 0;

  for (const c of candidates) {
    let rendered = '';
    let renderedTokens = 0;
    let inlined = false;

    if (c.body !== null) {
      rendered = renderInlineEntry(c, vaultName);
      renderedTokens = estimateTokens(rendered, params.provider);
      if (runningTokens + renderedTokens <= params.budgetTokens) {
        inlined = true;
      } else {
        // Demote to pointer.
        rendered = renderPointerEntry(c, vaultName);
        renderedTokens = estimateTokens(rendered, params.provider);
      }
    } else {
      rendered = renderPointerEntry(c, vaultName);
      renderedTokens = estimateTokens(rendered, params.provider);
    }

    if (runningTokens + renderedTokens > params.budgetTokens) {
      // Even the pointer doesn't fit — stop.
      break;
    }

    sections.push(rendered);
    runningTokens += renderedTokens;
    debug.push({
      filePath: c.filePath,
      score: c.score,
      inline: inlined,
      tokenCount: renderedTokens,
    });
  }

  if (sections.length === 0) {
    return empty;
  }

  const content = sections.join('\n\n');
  return {
    content,
    tokenCount: runningTokens,
    debug,
  };
}

function renderInlineEntry(c: Candidate, vaultName: string): string {
  const lines: string[] = [];
  lines.push(`### Knowledge: ${c.filePath}`);
  if (c.fmTags) {
    lines.push(`Tags: ${c.fmTags}`);
  }
  lines.push('');
  lines.push((c.body ?? '').trimEnd());
  lines.push('');
  lines.push(
    `If you need to re-read with offset/limit: doc_read_file(scope="document_store", mount_point="${vaultName}", path="${c.filePath}")`,
  );
  return lines.join('\n');
}

function renderPointerEntry(c: Candidate, vaultName: string): string {
  const lines: string[] = [];
  lines.push(`### Knowledge: ${c.filePath}`);
  if (c.pointerTeaser) {
    lines.push(`Why: ${c.pointerTeaser}`);
  }
  if (c.fmTags) {
    lines.push(`Tags: ${c.fmTags}`);
  }
  lines.push(
    `Read with: doc_read_file(scope="document_store", mount_point="${vaultName}", path="${c.filePath}")`,
  );
  return lines.join('\n');
}

function buildPointerTeaser(headingContext: string | null, chunkContent: string): string {
  const heading = headingContext?.trim();
  if (heading) return heading;
  const collapsed = chunkContent.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= POINTER_TEASER_MAX_CHARS) return collapsed;
  // Trim to last word boundary within the cap, then ellipsis.
  const cut = collapsed.slice(0, POINTER_TEASER_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[.,;:!?-]+$/, '')}…`;
}

function renderFrontmatterTags(data: Record<string, unknown>): string | null {
  const parts: string[] = [];

  const tagsValue = data.tags;
  if (Array.isArray(tagsValue)) {
    const items = tagsValue.filter(t => typeof t === 'string').map(t => String(t).trim()).filter(Boolean);
    if (items.length > 0) parts.push(items.join(', '));
  } else if (typeof tagsValue === 'string' && tagsValue.trim()) {
    parts.push(tagsValue.trim());
  }

  const topicsValue = data.topics;
  if (Array.isArray(topicsValue)) {
    const items = topicsValue.filter(t => typeof t === 'string').map(t => String(t).trim()).filter(Boolean);
    if (items.length > 0) parts.push(items.join(', '));
  } else if (typeof topicsValue === 'string' && topicsValue.trim()) {
    parts.push(topicsValue.trim());
  }

  if (parts.length === 0) return null;
  return parts.join(' · ');
}
