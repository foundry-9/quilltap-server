/**
 * A character's corpus, read once per maintenance run.
 *
 * {@link loadCorpus} is the one paged, yielding read of a character's memories
 * (it replaces housekeeping's and consolidation's two load-and-yield loops).
 * {@link MaintenanceCorpus} holds what it read and is kept in step with every
 * phase's plan as the run goes — dry run and live alike — so a later phase
 * plans against what the earlier ones did. That matters in the job child,
 * whose reads would not otherwise see what an earlier phase buffered, and it
 * is what makes a dry run report the same later-phase counts a live run does
 * (invariant 10).
 *
 * @module memory/maintenance/corpus
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'memory:maintenance:corpus' })

/** Rows per page. Small enough that one page's validation never starves the event loop. */
export const CORPUS_PAGE_SIZE = 250

export type MemoryTierName = 'hot' | 'cold'
export type MemorySourceName = 'AUTO' | 'MANUAL' | 'CONSOLIDATED'

export interface LoadCorpusOptions {
  /** Keep only these tiers; omitted, both. */
  tiers?: readonly MemoryTierName[]
  /** Keep only these sources; omitted, all. */
  sources?: readonly MemorySourceName[]
  pageSize?: number
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export function tierOf(memory: Pick<Memory, 'tier'>): MemoryTierName {
  return memory.tier === 'cold' ? 'cold' : 'hot'
}

/**
 * Page through a character's memories, yielding to the event loop between
 * pages. Filters apply per page; a page may come back empty.
 */
export async function* loadCorpus(
  characterId: string,
  opts: LoadCorpusOptions = {},
): AsyncGenerator<Memory[], void, unknown> {
  const pageSize = opts.pageSize ?? CORPUS_PAGE_SIZE
  const tiers = opts.tiers ? new Set(opts.tiers) : null
  const sources = opts.sources ? new Set(opts.sources) : null
  for await (const page of getRepositories().memories.findByCharacterIdInBatches(characterId, pageSize)) {
    yield page.filter(
      (m) => (!tiers || tiers.has(tierOf(m))) && (!sources || sources.has((m.source ?? 'AUTO') as MemorySourceName)),
    )
    await yieldToEventLoop()
  }
}

/** The run's view of a character's corpus. */
export class MaintenanceCorpus {
  private readonly rows = new Map<string, Memory>()

  constructor(readonly characterId: string, rows: Iterable<Memory> = []) {
    for (const row of rows) this.rows.set(row.id, row)
  }

  /** Read the whole corpus (both tiers, every source). */
  static async load(characterId: string): Promise<MaintenanceCorpus> {
    const corpus = new MaintenanceCorpus(characterId)
    for await (const page of loadCorpus(characterId)) {
      for (const row of page) corpus.rows.set(row.id, row)
    }
    log.debug('Maintenance corpus loaded', { characterId, rows: corpus.rows.size })
    return corpus
  }

  get size(): number {
    return this.rows.size
  }

  get(id: string): Memory | undefined {
    return this.rows.get(id)
  }

  all(): Memory[] {
    return Array.from(this.rows.values())
  }

  hot(): Memory[] {
    return this.all().filter((m) => tierOf(m) === 'hot')
  }

  /** Replace or add a row. */
  put(row: Memory): void {
    this.rows.set(row.id, row)
  }

  /** Merge a patch into a row that is still here. */
  patch(id: string, patch: Partial<Memory>): void {
    const row = this.rows.get(id)
    if (row) this.rows.set(id, { ...row, ...patch })
  }

  remove(ids: Iterable<string>): void {
    for (const id of ids) this.rows.delete(id)
    // A retired row leaves no link behind (retireMemories scrubs them).
    const gone = new Set(ids)
    if (gone.size === 0) return
    for (const row of this.rows.values()) {
      if (row.relatedMemoryIds?.some((id) => gone.has(id))) {
        this.rows.set(row.id, { ...row, relatedMemoryIds: row.relatedMemoryIds.filter((id) => !gone.has(id)) })
      }
    }
  }
}
