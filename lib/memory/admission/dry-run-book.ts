/**
 * The extraction dry run's scratch book (review of PR 94).
 *
 * A dry run previews a regenerate, which first retires the chat's extracted
 * memories and then admits each candidate against a book that grows as it
 * goes. Admission in a dry run writes nothing, so without help it would decide
 * against rows the regenerate retires first, and never let a later candidate
 * fold into an earlier one. The book supplies both halves:
 *
 *  - `retiring` — the ids the chat wipe would retire (`previewChatWipe`):
 *    the neighbour search goes past them;
 *  - `inserted` — what this dry run would have inserted, per holder, with its
 *    vector: a later candidate is decided against these too.
 *
 * Parent-only and in memory: the dry run runs in the API route, never the job
 * child.
 *
 * @module memory/admission/dry-run-book
 */

import type { Memory } from '@/lib/schemas/types'
import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import type { AdmissionNeighbour, AdmissionRow } from './types'

export interface DryRunBook {
  retiring: ReadonlySet<string>
  inserted: Map<string, Array<{ memory: Memory; embedding: Float32Array }>>
}

export function createDryRunBook(retiring: Iterable<string> = []): DryRunBook {
  return { retiring: new Set(retiring), inserted: new Map() }
}

/** The holder's would-be inserts as neighbours of `embedding`, closest first. */
export function bookNeighbours(book: DryRunBook, characterId: string, embedding: Float32Array): AdmissionNeighbour[] {
  return (book.inserted.get(characterId) ?? [])
    .filter((e) => e.embedding.length === embedding.length)
    .map((e) => ({ memory: e.memory, cosine: cosineSimilarity(embedding, e.embedding) }))
    .sort((a, b) => b.cosine - a.cosine)
}

/** Record a would-be insert, as the row admission would have written. */
export function recordBookInsert(book: DryRunBook, row: AdmissionRow, embedding: Float32Array): Memory {
  const list = book.inserted.get(row.characterId) ?? []
  const now = new Date().toISOString()
  const memory = {
    id: `dry-run:${row.characterId}:${list.length + 1}`,
    characterId: row.characterId,
    aboutCharacterId: row.aboutCharacterId ?? null,
    chatId: row.chatId ?? null,
    projectId: row.projectId ?? null,
    content: row.content,
    summary: row.summary,
    keywords: row.keywords ?? [],
    tags: row.tags ?? [],
    importance: row.importance ?? 0.5,
    source: row.source ?? 'AUTO',
    kind: row.kind ?? 'semantic',
    occurredAt: row.occurredAt ?? null,
    narrativeTime: row.narrativeTime ?? null,
    entities: row.entities ?? [],
    tier: 'hot',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as Memory
  list.push({ memory, embedding })
  book.inserted.set(row.characterId, list)
  return memory
}
