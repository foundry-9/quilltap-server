/**
 * Knowledge Injector
 *
 * Per-turn retrieval of relevant files from the three Knowledge/ scopes
 * available to the responding character: their own vault, the active
 * chat-project's linked mounts, and the instance-wide Quilltap General
 * mount. Parallels `memory-injector.ts` but operates on the document-chunk
 * index (the same index that powers the unified search tool's `documents`
 * and `knowledge` sources).
 *
 * Each tier runs as an independent scoped search with a distinct literal-
 * boost fraction (`LITERAL_BOOST_CHARACTER` / `_PROJECT` / `_GLOBAL`) so a
 * verbatim hit in the character's own vault outranks the same hit in the
 * project pool, which in turn outranks the same hit in Quilltap General.
 * Hits are merged, deduplicated by chunkId, and greedy-packed by boosted
 * score into a single budget-bounded string.
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
 * Errors are converted to warnings by the caller — never throw mid-turn.
 *
 * @module chat/context/knowledge-injector
 */

import type { Provider } from '@/lib/schemas/types';
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service';
import { searchDocumentChunks, type DocumentSearchResult } from '@/lib/mount-index/document-search';
import {
  LITERAL_BOOST_CHARACTER,
  LITERAL_BOOST_PROJECT,
  LITERAL_BOOST_GLOBAL,
} from '@/lib/embedding/literal-boost';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { estimateTokens } from '@/lib/tokens/token-counter';
import { getRepositories } from '@/lib/repositories/factory';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('KnowledgeInjector');

const DEFAULT_CANDIDATE_LIMIT = 5;
const DEFAULT_INLINE_TOKEN_THRESHOLD = 500;
const DEFAULT_MIN_SCORE = 0.3;
const POINTER_TEASER_MAX_CHARS = 120;

export type KnowledgeTier = 'character' | 'project' | 'global';

export interface KnowledgeRetrievalParams {
  characterId: string;
  userId: string;
  embeddingProfileId?: string;
  query: string;
  /**
   * Mount point of the responding character's own vault. The Knowledge/
   * folder under it gets the tightest literal-boost (character tier).
   */
  characterMountPointId?: string | null;
  /**
   * Mount points linked to the active chat's project. The Knowledge/
   * folder under each gets the project-tier literal-boost.
   */
  projectMountPointIds?: string[];
  /**
   * The Quilltap General singleton mount. Knowledge/ under it gets the
   * loosest literal-boost (global tier). Null when the mount hasn't been
   * provisioned yet (pre-migration tolerance).
   */
  globalMountPointId?: string | null;
  budgetTokens: number;
  provider: Provider;
  /** Override default 0.3 minimum cosine score */
  minScore?: number;
  /** Override default 5 candidates per tier from the chunk search */
  candidateLimit?: number;
  /** Override default 500-token inline threshold */
  inlineTokenThreshold?: number;
}

export interface KnowledgeDebugEntry {
  filePath: string;
  tier: KnowledgeTier;
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
  tier: KnowledgeTier;
  mountPointId: string;
  mountPointName: string;
  chunkId: string;
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

  // Build the tier plan, dropping duplicates between tiers so the same
  // mount can't enter the pool twice if a user has somehow linked their
  // character vault into a project, etc.
  const characterMountPointId = params.characterMountPointId ?? null;
  const projectMountPointIdSet = new Set(params.projectMountPointIds ?? []);
  if (characterMountPointId) projectMountPointIdSet.delete(characterMountPointId);
  let globalMountPointId = params.globalMountPointId ?? null;
  if (globalMountPointId && globalMountPointId === characterMountPointId) {
    globalMountPointId = null;
  }
  if (globalMountPointId) projectMountPointIdSet.delete(globalMountPointId);
  const projectMountPointIds = Array.from(projectMountPointIdSet);

  const tiers: Array<{ tier: KnowledgeTier; mountPointIds: string[]; boost: number }> = [];
  if (characterMountPointId) {
    tiers.push({ tier: 'character', mountPointIds: [characterMountPointId], boost: LITERAL_BOOST_CHARACTER });
  }
  if (projectMountPointIds.length > 0) {
    tiers.push({ tier: 'project', mountPointIds: projectMountPointIds, boost: LITERAL_BOOST_PROJECT });
  }
  if (globalMountPointId) {
    tiers.push({ tier: 'global', mountPointIds: [globalMountPointId], boost: LITERAL_BOOST_GLOBAL });
  }

  if (tiers.length === 0) return empty;

  // 1. Embed the query once, share it across all tier searches.
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

  // 2. Run each tier's scoped search in parallel.
  const tierHits: Array<{ tier: KnowledgeTier; hits: DocumentSearchResult[] }> = await Promise.all(
    tiers.map(async ({ tier, mountPointIds, boost }) => {
      try {
        const hits = await searchDocumentChunks(embeddingResult.embedding, {
          mountPointIds,
          pathPrefix: 'Knowledge/',
          limit: candidateLimit,
          minScore,
          query: params.query,
          applyLiteralPhraseBoost: true,
          literalBoostFraction: boost,
        });
        return { tier, hits };
      } catch (error) {
        logger.warn('Knowledge tier search failed, skipping tier', {
          tier,
          characterId: params.characterId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { tier, hits: [] };
      }
    }),
  );

  const repos = getRepositories();

  // 3. Mount-name lookup table for pointer templates. Read once.
  const mountNames = new Map<string, string>();
  const seenMountIds = new Set<string>();
  for (const { hits } of tierHits) {
    for (const h of hits) seenMountIds.add(h.mountPointId);
  }
  for (const mpId of seenMountIds) {
    try {
      const mp = await repos.docMountPoints.findById(mpId);
      mountNames.set(mpId, mp?.name ?? 'Knowledge Source');
    } catch {
      mountNames.set(mpId, 'Knowledge Source');
    }
  }

  // 4. Build candidates from every tier, dedup by chunkId across tiers
  // (best score wins — already biased toward the tighter tier by the
  // tier-specific literal boost).
  const candidatesByChunkId = new Map<string, Candidate>();

  for (const { tier, hits } of tierHits) {
    for (const hit of hits) {
      try {
        const file = await repos.docMountFiles.findByMountPointAndPath(
          hit.mountPointId,
          hit.relativePath,
        );

        if (!file) {
          logger.debug('Knowledge hit file no longer present, skipping', {
            tier,
            characterId: params.characterId,
            path: hit.relativePath,
          });
          continue;
        }

        const teaser = buildPointerTeaser(hit.headingContext, hit.content);

        let body: string | null = null;
        let fmTags: string | null = null;

        if (file.fileType === 'pdf' || file.fileType === 'docx' || file.fileType === 'blob') {
          // Derived blobs are always pointer-only — extracted text is the
          // wrong granularity for recall.
          body = null;
        } else {
          const doc = await repos.docMountDocuments.findByMountPointAndPath(
            hit.mountPointId,
            hit.relativePath,
          );

          if (doc) {
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
            body = bodyTokens <= inlineThreshold ? doc.content : null;
          }
        }

        const candidate: Candidate = {
          tier,
          mountPointId: hit.mountPointId,
          mountPointName: mountNames.get(hit.mountPointId) ?? hit.mountPointName ?? 'Knowledge Source',
          chunkId: hit.chunkId,
          filePath: hit.relativePath,
          fileName: hit.fileName,
          fileType: file.fileType,
          score: hit.score,
          pointerTeaser: teaser,
          body,
          fmTags,
        };

        const existing = candidatesByChunkId.get(hit.chunkId);
        if (!existing || candidate.score > existing.score) {
          candidatesByChunkId.set(hit.chunkId, candidate);
        }
      } catch (error) {
        logger.debug('Knowledge candidate construction failed, skipping', {
          tier,
          path: hit.relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (candidatesByChunkId.size === 0) return empty;

  // 5. Greedy pack into the budget. Try each candidate inline first (when
  // it has a body); if the inline form would overflow, demote to pointer.
  // After a single pass we stop the moment the next entry won't fit.
  const candidates = Array.from(candidatesByChunkId.values()).sort((a, b) => b.score - a.score);

  const sections: string[] = [];
  const debug: KnowledgeDebugEntry[] = [];
  const seenFilePaths = new Set<string>();
  let runningTokens = 0;

  for (const c of candidates) {
    // Two chunks of the same file shouldn't both surface here.
    const fileKey = `${c.mountPointId}::${c.filePath}`;
    if (seenFilePaths.has(fileKey)) continue;
    seenFilePaths.add(fileKey);

    let rendered = '';
    let renderedTokens = 0;
    let inlined = false;

    if (c.body !== null) {
      rendered = renderInlineEntry(c);
      renderedTokens = estimateTokens(rendered, params.provider);
      if (runningTokens + renderedTokens <= params.budgetTokens) {
        inlined = true;
      } else {
        rendered = renderPointerEntry(c);
        renderedTokens = estimateTokens(rendered, params.provider);
      }
    } else {
      rendered = renderPointerEntry(c);
      renderedTokens = estimateTokens(rendered, params.provider);
    }

    if (runningTokens + renderedTokens > params.budgetTokens) {
      break;
    }

    sections.push(rendered);
    runningTokens += renderedTokens;
    debug.push({
      filePath: c.filePath,
      tier: c.tier,
      score: c.score,
      inline: inlined,
      tokenCount: renderedTokens,
    });
  }

  if (sections.length === 0) return empty;

  return {
    content: sections.join('\n\n'),
    tokenCount: runningTokens,
    debug,
  };
}

function tierLabel(tier: KnowledgeTier): string {
  if (tier === 'character') return 'character';
  if (tier === 'project') return 'project';
  return 'general';
}

function renderInlineEntry(c: Candidate): string {
  const lines: string[] = [];
  lines.push(`### Knowledge (${tierLabel(c.tier)}) — ${c.mountPointName}/${c.filePath}`);
  if (c.fmTags) {
    lines.push(`Tags: ${c.fmTags}`);
  }
  lines.push('');
  lines.push((c.body ?? '').trimEnd());
  lines.push('');
  lines.push(
    `If you need to re-read with offset/limit: doc_read_file(scope="document_store", mount_point="${c.mountPointName}", path="${c.filePath}")`,
  );
  return lines.join('\n');
}

function renderPointerEntry(c: Candidate): string {
  const lines: string[] = [];
  lines.push(`### Knowledge (${tierLabel(c.tier)}) — ${c.mountPointName}/${c.filePath}`);
  if (c.pointerTeaser) {
    lines.push(`Why: ${c.pointerTeaser}`);
  }
  if (c.fmTags) {
    lines.push(`Tags: ${c.fmTags}`);
  }
  lines.push(
    `Read with: doc_read_file(scope="document_store", mount_point="${c.mountPointName}", path="${c.filePath}")`,
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
