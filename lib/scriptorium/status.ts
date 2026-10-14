/**
 * A conversation's Scriptorium status, as the chat cards show it.
 *
 * Derived from the chat's interchange chunks alone — the rendered Markdown is
 * no longer stored (see `render-chat.ts`), so "rendered" means "its chunks
 * exist". Both chat-list endpoints call this rather than re-deriving it.
 *
 *  - `none`      — no chunks yet: never rendered.
 *  - `rendered`  — chunks exist, but at least one still lacks an embedding
 *                  (queued, or the embedder was unavailable).
 *  - `embedded`  — every chunk is embedded; semantic search can find it.
 *
 * @module scriptorium/status
 */

export type ScriptoriumStatus = 'none' | 'rendered' | 'embedded';

export interface ChunkCounts {
  total: number;
  embedded: number;
}

export function deriveScriptoriumStatus(counts: ChunkCounts | undefined): ScriptoriumStatus {
  if (!counts || counts.total === 0) return 'none';
  return counts.embedded >= counts.total ? 'embedded' : 'rendered';
}
