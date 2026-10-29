/**
 * Database Abstraction Layer - Memories Repository
 *
 * Backend-agnostic repository for Memory entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles CRUD operations and advanced queries for Memory entities.
 * Each memory is stored as a document in the 'memories' collection/table.
 */

import { Memory, MemorySchema, MemoryTier } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, DatabaseCollection } from '../interfaces';
import { rawQuery, registerBlobColumns } from '../manager';
import { chunkArray, SQLITE_VARIABLE_CHUNK_SIZE } from '@/lib/utils/chunk';
import { getRawDatabase } from '../backends/sqlite/client';
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance';
import { appendCappedFootnotes } from '@/lib/memory/reinforcement-footnotes';
import { blobToFloat32 } from '@/lib/embedding/float32-conversion';

/**
 * Input to {@link MemoriesRepository.create}. The tier fields are optional
 * here — a new row is hot with no consolidation history unless the caller
 * (the consolidation job, an import) says otherwise.
 */
export type MemoryCreateInput = Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'tier' | 'consolidatedFrom' | 'keystone'> &
  Partial<Pick<Memory, 'tier' | 'consolidatedFrom' | 'keystone'>>;

/** One dangling link: row `id` (held by `characterId`) names `target`, which no longer exists. */
export interface DanglingMemoryLink {
  id: string;
  characterId: string;
  target: string;
}

/** {@link MemoriesRepository.findDanglingLinks}: dangling links by column. */
export interface DanglingMemoryLinks {
  related: DanglingMemoryLink[];
  /** `memberCount` is the digest's whole `consolidatedFrom` length, dangling members included. */
  consolidatedFrom: Array<DanglingMemoryLink & { memberCount: number }>;
  /** A member whose digest is gone; `tier` is the member's own. */
  supersededBy: Array<DanglingMemoryLink & { tier: MemoryTier }>;
}

/**
 * SQL predicate for "this row is in the hot tier". A NULL tier (a row written
 * before `add-memory-tiers-v1`, or by a path that bypassed `create`) reads as
 * hot, never cold.
 */
const HOT_TIER_SQL = `COALESCE(tier, 'hot') = 'hot'`;

/** A JSON id-list column as stored, read leniently (malformed reads as empty). */
function parseJsonIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * A stored embedding as `rawQuery` returns it — a BLOB (raw Float32 or the
 * quantized format) or, on a row older than `normalize-vector-storage-v1`, JSON
 * text — decoded to a Float32Array. Null when it is neither.
 */
function decodeStoredEmbedding(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (Buffer.isBuffer(value)) return blobToFloat32(value);
  if (value instanceof Uint8Array) return blobToFloat32(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  if (Array.isArray(value)) return Float32Array.from(value as number[]);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? Float32Array.from(parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Maximum allowed search query length to prevent ReDoS and excessive memory usage */
const MAX_SEARCH_QUERY_LENGTH = 1000;

/**
 * Memories Repository
 * Implements CRUD operations for memories with character-scoping and advanced search capabilities.
 */
export class MemoriesRepository extends AbstractBaseRepository<Memory> {
  constructor() {
    super('memories', MemorySchema);
  }

  /**
   * Override getCollection to register blob columns for embedding.
   * The embedding column stores Float32 BLOBs after the normalize-vector-storage migration.
   * Without this registration, BLOB embeddings are not deserialized to number[] and fail
   * Zod validation, causing memories to be silently filtered out.
   *
   * Registration is keyed to the backend, so it is re-asserted on every call
   * rather than remembered on this instance: a repository outlives the backend
   * it first ran against (reconnect, or a dev-server reload), and a stale
   * "already registered" flag would leave the fresh backend without blob
   * handling — the write path would then persist an index-keyed object in place
   * of the BLOB and corrupt the embedding. Merging an already-registered column
   * is a no-op, so re-asserting is cheap. (Same rationale as `HelpDocsRepository`.)
   */
  protected async getCollection(): Promise<DatabaseCollection<Memory>> {
    await registerBlobColumns('memories', ['embedding']);
    return super.getCollection();
  }

  /**
   * Find a memory by ID
   * @param id The memory ID
   * @returns Promise<Memory | null> The memory if found, null otherwise
   */
  async findById(id: string): Promise<Memory | null> {
    return this._findById(id);
  }

  /**
   * Find all memories
   * @returns Promise<Memory[]> Array of all memories
   */
  async findAll(): Promise<Memory[]> {
    return this._findAll();
  }

  /**
   * Find a specific memory by ID for a character
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The memory if found and belongs to character, null otherwise
   */
  async findByIdForCharacter(characterId: string, memoryId: string): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findOneByFilter({
          id: memoryId,
          characterId,
        });

        return memory;
      },
      'Error finding memory by ID for character',
      { characterId, memoryId },
      null
    );
  }

  /**
   * Find all memories for a specific character
   * @param characterId The character ID
   * @returns Promise<Memory[]> Array of memories for the character
   */
  async findByCharacterId(characterId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ characterId });
        return memories;
      },
      'Error finding memories by character ID',
      { characterId },
      []
    );
  }

  /**
   * Stream a character's memories in fixed-size batches, sorted by id for a
   * stable page boundary. Housekeeping uses this so that a character with
   * tens of thousands of memories can yield to the event loop between pages
   * instead of doing one ~19k-row Zod-validated read in a single synchronous
   * chunk.
   */
  async *findByCharacterIdInBatches(
    characterId: string,
    batchSize: number,
  ): AsyncGenerator<Memory[], void, unknown> {
    if (batchSize <= 0) {
      throw new Error('batchSize must be positive');
    }
    let skip = 0;
    while (true) {
      const batch = await this.safeQuery(
        async () =>
          this.findByFilter(
            { characterId },
            { limit: batchSize, skip, sort: { id: 1 } },
          ),
        'Error loading memory batch',
        { characterId, skip, batchSize },
        [],
      );
      if (batch.length === 0) return;
      yield batch;
      if (batch.length < batchSize) return;
      skip += batchSize;
    }
  }

  /**
   * Find memories by a list of IDs. Missing IDs are silently dropped.
   * @param ids Array of memory IDs
   * @returns Promise<Memory[]> Array of memories matching any of the given IDs
   */
  async findByIds(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          id: { $in: ids },
        } as TypedQueryFilter<Memory>);
        return memories;
      },
      'Error finding memories by IDs',
      { count: ids.length },
      []
    );
  }

  /**
   * Find memories for a character with pagination support.
   * Returns a page of memories and the total count matching the filter.
   *
   * @param characterId The character ID
   * @param options Pagination, sorting, and filtering options
   * @returns Promise with memories array and totalCount
   */
  async findByCharacterIdPaginated(
    characterId: string,
    options: {
      limit: number
      offset: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
      search?: string
      source?: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
      minImportance?: number
      /** Restrict to one tier; omitted lists both. */
      tier?: MemoryTier
      /** Keystones only. */
      keystone?: boolean
    }
  ): Promise<{ memories: Memory[]; totalCount: number }> {
    return this.safeQuery(
      async () => {
        const { limit, offset, sortBy = 'createdAt', sortOrder = 'desc', search, source, minImportance, tier, keystone } = options;

        // Build filter
        const filter: TypedQueryFilter<Memory> = { characterId };
        if (source) {
          (filter as any).source = source;
        }
        if (minImportance !== undefined) {
          (filter as any).reinforcedImportance = { $gte: minImportance };
        }
        if (tier) {
          (filter as any).tier = tier;
        }
        if (keystone) {
          (filter as any).keystone = true;
        }

        // Get total count before pagination (but after filtering except search,
        // since search is applied in-memory)
        let allMatching = await this.findByFilter(filter, {
          sort: { [sortBy]: sortOrder === 'desc' ? -1 : 1 },
        });

        // Apply text search in-memory (same as existing behavior)
        if (search) {
          const searchLower = search.toLowerCase();
          allMatching = allMatching.filter((memory) =>
            memory.content.toLowerCase().includes(searchLower) ||
            memory.summary.toLowerCase().includes(searchLower) ||
            memory.keywords.some((k) => k.toLowerCase().includes(searchLower))
          );
        }

        const totalCount = allMatching.length;
        const memories = allMatching.slice(offset, offset + limit);

        return { memories, totalCount };
      },
      'Error finding paginated memories for character',
      { characterId, limit: options.limit, offset: options.offset },
      { memories: [], totalCount: 0 }
    );
  }

  /**
   * Text search in memory content and summary
   * @param characterId The character ID
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContent(characterId: string, query: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (query.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search query exceeds maximum length', {
            characterId,
            queryLength: query.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return [];
        }
        // Escape special regex characters to treat query as literal text
        const escapedQuery = this.escapeRegex(query);
        const regex = new RegExp(escapedQuery, 'i'); // Case-insensitive regex search

        const memories = await this.findByFilter({
          characterId,
          $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
        });
        return memories;
      },
      'Error searching memories by content',
      { characterId, queryLength: query.length },
      []
    );
  }

  /**
   * Find memories whose reinforced importance is >= minImportance (the value every importance filter reads)
   * @param characterId The character ID
   * @param minImportance Minimum importance value (0-1)
   * @returns Promise<Memory[]> Array of memories meeting importance threshold
   */
  async findByImportance(characterId: string, minImportance: number): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (minImportance < 0 || minImportance > 1) {
          logger.warn('Invalid importance threshold', { minImportance });
          return [];
        }

        const memories = await this.findByFilter({
          characterId,
          reinforcedImportance: { $gte: minImportance },
        });
        return memories;
      },
      'Error finding memories by importance',
      { characterId, minImportance },
      []
    );
  }

  /**
   * Find memories by source type
   * @param characterId The character ID
   * @param source Source type ('AUTO' or 'MANUAL')
   * @returns Promise<Memory[]> Array of memories with the specified source
   */
  async findBySource(characterId: string, source: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          characterId,
          source,
        });
        return memories;
      },
      'Error finding memories by source',
      { characterId, source },
      []
    );
  }

  /**
   * Find the most recent memories for a character
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of recent memories, sorted by creation date (newest first)
   */
  async findRecent(characterId: string, limit: number = 10): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId },
          {
            sort: { createdAt: -1 },
            limit,
          }
        );
        return memories;
      },
      'Error finding recent memories',
      { characterId, limit },
      []
    );
  }

  /**
   * Find the most important memories for a character — the frozen archive's
   * candidate pool.
   *
   * Ranked on `reinforcedImportance` (importance plus the reinforcement
   * signal), then `COALESCE(lastReinforcedAt, createdAt)` so a recently
   * re-observed memory beats a stale one of equal score, then `id` so ties
   * resolve the same way every time. Raw `importance` alone left most of a
   * large corpus tied near 0.9, and the pool became whatever order SQLite
   * returned ties in.
   *
   * @param characterId The character ID
   * @param limit Maximum number of memories to return (default: 10)
   * @returns Promise<Memory[]> Array of memories, best first
   */
  async findMostImportant(characterId: string, limit: number = 10): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (limit <= 0) return [];
        const rows = await rawQuery<Record<string, unknown>[]>(
          `SELECT * FROM memories
            WHERE characterId = ?
              AND ${HOT_TIER_SQL}
            ORDER BY reinforcedImportance DESC,
                     COALESCE(lastReinforcedAt, createdAt) DESC,
                     id ASC
            LIMIT ?`,
          [characterId, limit],
        );
        const memories = this.hydrateRawRows(rows, 'most-important fetch');
        logger.debug('Fetched most important memories', {
          characterId,
          limit,
          returned: memories.length,
        });
        return memories;
      },
      'Error finding most important memories',
      { characterId, limit },
      []
    );
  }

  /**
   * Validate rows read through `rawQuery`. SQLiteCollection hydrates the
   * JSON-encoded array columns for us; a raw query has to do it by hand.
   */
  private hydrateRawRows(rows: Record<string, unknown>[], context: string): Memory[] {
    const memories: Memory[] = [];
    for (const row of rows) {
      for (const col of ['keywords', 'tags', 'relatedMemoryIds', 'entities', 'consolidatedFrom']) {
        const val = row[col];
        if (typeof val === 'string') {
          try {
            row[col] = JSON.parse(val);
          } catch {
            row[col] = [];
          }
        }
      }

      // SQLite stores the boolean as 0 / 1; SQLiteCollection converts it, a raw query must.
      if (typeof row.keystone === 'number' || typeof row.keystone === 'bigint' || row.keystone === null) {
        row.keystone = Number(row.keystone ?? 0) === 1;
      }

      const validation = MemorySchema.safeParse(row);
      if (validation.success) {
        memories.push(validation.data);
      } else {
        logger.warn(`Memory failed validation in ${context}`, {
          memoryId: row.id,
          error: validation.error.message,
        });
      }
    }
    return memories;
  }

  /**
   * Find recent memories for a character across importance tiers.
   * Returns three arrays: high (≥0.7), medium (0.3–0.7), low (<0.3),
   * each sorted by createdAt descending (newest first).
   *
   * Every band is one predicate on `reinforcedImportance` — the importance
   * ranking, protection and recall read — so each hot row falls in exactly one
   * band, and SQL does the limit. Bug 215: the high and low bands used to
   * filter raw `importance` while the medium ceiling read reinforced
   * importance, so a 0.65 row reinforced past 0.7 landed in no band at all.
   *
   * @param characterId The character ID
   * @param limits Optional per-tier limits (defaults: highLimit=20, mediumLimit=10, lowLimit=5)
   * @returns Promise with high, medium, and low importance memory arrays
   */
  async findRecentByImportanceTier(
    characterId: string,
    limits: { high?: number; medium?: number; low?: number } = {}
  ): Promise<{ high: Memory[]; medium: Memory[]; low: Memory[] }> {
    const highLimit = limits.high ?? 20;
    const mediumLimit = limits.medium ?? 10;
    const lowLimit = limits.low ?? 5;
    const HIGH_FLOOR = 0.7;
    const MEDIUM_FLOOR = 0.3;

    const band = (
      name: 'high' | 'medium' | 'low',
      predicate: Record<string, number>,
      limit: number,
    ): Promise<Memory[]> =>
      this.safeQuery(
        async () => {
          if (limit <= 0) return [];
          const memories = await this.findByFilter(
            { characterId, tier: 'hot', reinforcedImportance: predicate } as TypedQueryFilter<Memory>,
            { sort: { createdAt: -1 }, limit }
          );
          logger.debug('Fetched recap importance band', {
            characterId,
            band: name,
            limit,
            returned: memories.length,
          });
          return memories;
        },
        `Error finding ${name}-importance memories`,
        { characterId, limit },
        []
      );

    const [high, medium, low] = await Promise.all([
      band('high', { $gte: HIGH_FLOOR }, highLimit),
      band('medium', { $gte: MEDIUM_FLOOR, $lt: HIGH_FLOOR }, mediumLimit),
      band('low', { $lt: MEDIUM_FLOOR }, lowLimit),
    ]);

    return { high, medium, low };
  }

  /**
   * Create a new memory
   * @param data The memory data (without id, createdAt, updatedAt)
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Memory> The created memory with generated id and timestamps
   */
  async create(
    data: MemoryCreateInput,
    options?: CreateOptions
  ): Promise<Memory> {
    return this.safeQuery(
      async () => {
        const memory = await this._create(
          { ...data, tier: data.tier ?? 'hot', consolidatedFrom: data.consolidatedFrom ?? [], keystone: data.keystone ?? false },
          options,
        );
        return memory;
      },
      'Error creating memory',
      { characterId: data.characterId }
    );
  }

  /**
   * Update a memory
   * @param id The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this._update(id, data);
        return memory;
      },
      'Error updating memory',
      { memoryId: id }
    );
  }

  /**
   * Update a specific character's memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @param data Partial memory data to update
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateForCharacter(
    characterId: string,
    memoryId: string,
    data: Partial<Memory>
  ): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for update', { memoryId, characterId });
          return null;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return null;
        }

        return await this.update(memoryId, data);
      },
      'Error updating memory for character',
      { characterId, memoryId }
    );
  }

  /**
   * Count one more observation of a memory: `reinforcementCount + 1`, a fresh
   * `lastReinforcedAt`, and `reinforcedImportance` recomputed from the new
   * count — all from the row as it stands at write time, in one synchronous
   * transaction, so two jobs reinforcing the same row both count (bug 182).
   *
   * Callers must not write these three fields through `updateForCharacter`:
   * an absolute count taken from an earlier read is exactly the lost update
   * this method exists to prevent. In the forked job child this is a buffered
   * write (`increment*` prefix) and returns nothing there; the parent replays
   * it against the committed row.
   *
   * `by` counts several observations at once — a dedup merge folding losers
   * applies their summed counts as one delta here rather than an absolute
   * total read earlier (bug 226). `lastReinforcedAt` only moves forward: an
   * `at` older than the stored value (a merge carrying a loser's timestamp)
   * never rewinds a reinforcement committed since.
   *
   * @returns the new count, importance and lastReinforcedAt, or null when the
   *   memory does not exist or belongs to another character
   */
  async incrementReinforcement(
    characterId: string,
    memoryId: string,
    at: string,
    by: number = 1,
  ): Promise<{ reinforcementCount: number; reinforcedImportance: number; lastReinforcedAt: string } | null> {
    if (!Number.isInteger(by) || by < 1) {
      throw new Error(`Memory reinforcement: delta must be a positive integer (got ${by})`);
    }
    return this.safeQuery(
      async () => {
        const db = getRawDatabase();
        if (!db) {
          throw new Error('Memory reinforcement: the main database is not initialized');
        }
        const now = this.getCurrentTimestamp();
        const result = db.transaction(() => {
          const row = db
            .prepare('SELECT "importance", "reinforcementCount", "lastReinforcedAt" FROM "memories" WHERE "id" = ? AND "characterId" = ?')
            .get(memoryId, characterId) as
            | { importance: number | null; reinforcementCount: number | null; lastReinforcedAt: string | null }
            | undefined;
          if (!row) return null;
          const reinforcementCount = (row.reinforcementCount ?? 1) + by;
          const reinforcedImportance = calculateReinforcedImportance(row.importance ?? 0.5, reinforcementCount);
          const lastReinforcedAt = row.lastReinforcedAt && row.lastReinforcedAt > at ? row.lastReinforcedAt : at;
          db.prepare(
            'UPDATE "memories" SET "reinforcementCount" = ?, "reinforcedImportance" = ?, "lastReinforcedAt" = ?, "updatedAt" = ? WHERE "id" = ?'
          ).run(reinforcementCount, reinforcedImportance, lastReinforcedAt, now, memoryId);
          return { reinforcementCount, reinforcedImportance, lastReinforcedAt };
        })();

        if (!result) {
          logger.warn('Memory not found for reinforcement', { memoryId, characterId });
          return null;
        }
        logger.debug('Memory reinforcement counted', { memoryId, characterId, by, ...result });
        return result;
      },
      'Error reinforcing memory',
      { characterId, memoryId }
    );
  }

  /**
   * Add `ids` to one memory's `relatedMemoryIds`, against the row as it stands
   * at write time. A delta, not a whole-array write: two jobs that each link a
   * new memory to the same neighbour both land their link when the parent
   * replays their batches, where an absolute list built from each job's
   * snapshot let the later one drop the earlier one's (bug 231). Ids already
   * present, and the row's own id, are skipped. Returns the list as written,
   * or null when the row is missing (`undefined` in the job child, where the
   * write is buffered).
   */
  async addRelatedMemoryIds(
    characterId: string,
    memoryId: string,
    ids: readonly string[],
  ): Promise<string[] | null> {
    return this.updateRelatedMemoryIdsAtomically(characterId, memoryId, 'add', ids);
  }

  /**
   * Remove `ids` from one memory's `relatedMemoryIds`, against the row as it
   * stands at write time (the delta twin of {@link addRelatedMemoryIds}).
   */
  async removeRelatedMemoryIds(
    characterId: string,
    memoryId: string,
    ids: readonly string[],
  ): Promise<string[] | null> {
    return this.updateRelatedMemoryIdsAtomically(characterId, memoryId, 'remove', ids);
  }

  private async updateRelatedMemoryIdsAtomically(
    characterId: string,
    memoryId: string,
    op: 'add' | 'remove',
    ids: readonly string[],
  ): Promise<string[] | null> {
    return this.safeQuery(
      async () => {
        const db = getRawDatabase();
        if (!db) {
          throw new Error('Memory link update: the main database is not initialized');
        }
        const delta = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
        const now = this.getCurrentTimestamp();
        const result = db.transaction(() => {
          const row = db
            .prepare('SELECT "relatedMemoryIds" FROM "memories" WHERE "id" = ? AND "characterId" = ?')
            .get(memoryId, characterId) as { relatedMemoryIds: string | null } | undefined;
          if (!row) return null;
          const current = parseJsonIdList(row.relatedMemoryIds);
          let next: string[];
          if (op === 'add') {
            const present = new Set(current);
            next = [...current];
            for (const id of delta) {
              if (id === memoryId || present.has(id)) continue;
              present.add(id);
              next.push(id);
            }
          } else {
            const removing = new Set(delta);
            next = current.filter((id) => !removing.has(id));
          }
          if (next.length === current.length && next.every((id, i) => id === current[i])) {
            return { list: current, changed: false };
          }
          db.prepare('UPDATE "memories" SET "relatedMemoryIds" = ?, "updatedAt" = ? WHERE "id" = ?')
            .run(JSON.stringify(next), now, memoryId);
          return { list: next, changed: true };
        })();

        if (!result) {
          logger.warn('Memory not found for link update', { memoryId, characterId, op });
          return null;
        }
        logger.debug('Memory links updated', {
          memoryId,
          characterId,
          op,
          requested: delta.length,
          changed: result.changed,
          size: result.list.length,
        });
        return result.list;
      },
      'Error updating memory links',
      { characterId, memoryId, op }
    );
  }

  /**
   * Remove `ids` from the `relatedMemoryIds` of every row, whichever character
   * holds it, that names any of them — the delete chokepoints' neighbour
   * scrub. One SQL removal delta per chunk, applied against the rows as they
   * stand at write time, so two deletes in one job (or in two jobs) each
   * remove only their own id and the replay applies both (bug 234).
   * Instance-wide on purpose: the gate links only within a holder, but an
   * import, a restore or legacy data can cross characters, and an id whose row
   * is already gone still has to leave its neighbours. Returns rows changed (0
   * in the job child, where the write is buffered).
   */
  async removeRelatedMemoryIdsEverywhere(ids: readonly string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        const removing = Array.from(new Set(ids));
        if (removing.length === 0) return 0;
        const db = getRawDatabase();
        if (!db) {
          throw new Error('Memory link scrub: the main database is not initialized');
        }
        const now = this.getCurrentTimestamp();
        let changed = 0;
        // Each chunk binds its ids twice (the filter and the EXISTS), plus updatedAt.
        const chunkSize = Math.max(1, Math.floor((SQLITE_VARIABLE_CHUNK_SIZE - 1) / 2));
        for (const chunk of chunkArray(removing, chunkSize)) {
          const placeholders = chunk.map(() => '?').join(',');
          const result = db
            .prepare(
              `UPDATE memories
                  SET relatedMemoryIds = (
                        SELECT COALESCE(json_group_array(value), '[]')
                          FROM json_each(memories.relatedMemoryIds)
                         WHERE value NOT IN (${placeholders})
                      ),
                      updatedAt = ?
                WHERE relatedMemoryIds IS NOT NULL
                  AND relatedMemoryIds <> '[]'
                  AND json_valid(relatedMemoryIds)
                  AND EXISTS (
                        SELECT 1 FROM json_each(memories.relatedMemoryIds)
                         WHERE value IN (${placeholders})
                      )`,
            )
            .run(...chunk, now, ...chunk);
          changed += result.changes;
        }
        logger.debug('Scrubbed deleted ids from related links', { ids: removing.length, changed });
        return changed;
      },
      'Error scrubbing related memory links',
      { count: ids.length },
      0,
    );
  }

  /**
   * Append reinforcement footnotes to one memory's content, against the row as
   * it stands at write time: the cap and the "already there" check read the
   * live content inside the write transaction, so two jobs reinforcing one
   * memory both land their footnotes, where a whole-content write built from
   * each job's snapshot let the later one drop the earlier one's (bug 231).
   * Returns the content as written and the details appended, or null when the
   * row is missing (`undefined` in the job child, where the write is buffered).
   */
  async appendReinforcementFootnotes(
    characterId: string,
    memoryId: string,
    details: readonly string[],
  ): Promise<{ content: string; appended: string[] } | null> {
    return this.safeQuery(
      async () => {
        const db = getRawDatabase();
        if (!db) {
          throw new Error('Memory footnotes: the main database is not initialized');
        }
        const now = this.getCurrentTimestamp();
        const result = db.transaction(() => {
          const row = db
            .prepare('SELECT "content" FROM "memories" WHERE "id" = ? AND "characterId" = ?')
            .get(memoryId, characterId) as { content: string } | undefined;
          if (!row) return null;
          const next = appendCappedFootnotes(row.content ?? '', details);
          if (next.appended.length > 0) {
            db.prepare('UPDATE "memories" SET "content" = ?, "updatedAt" = ? WHERE "id" = ?')
              .run(next.content, now, memoryId);
          }
          return next;
        })();

        if (!result) {
          logger.warn('Memory not found for reinforcement footnotes', { memoryId, characterId });
          return null;
        }
        logger.debug('Reinforcement footnotes appended', {
          memoryId,
          characterId,
          offered: details.length,
          appended: result.appended.length,
        });
        return result;
      },
      'Error appending reinforcement footnotes',
      { characterId, memoryId }
    );
  }

  /**
   * Refused. A memory row is deleted only by `retireMemories`
   * (`lib/memory/retire.ts`), which scrubs the links that name it and evicts
   * its vector; a bare delete is how orphan vectors and dangling links were
   * made (bugs 200, 225). Present only because the base repository declares it.
   */
  async delete(id: string): Promise<boolean> {
    logger.error('Refused a bare memory delete; memories are deleted through retireMemories', { memoryId: id });
    throw new Error('MemoriesRepository.delete is refused: delete memories through retireMemories (lib/memory/retire.ts)');
  }

  /**
   * Delete a character's memory rows outright — nothing else. Named *Unsafe*
   * because it scrubs no links and touches no index: `retireMemories`
   * (`lib/memory/retire.ts`) is its only caller and does both, and a test
   * greps for any other.
   * @param characterId The character ID
   * @param memoryIds Array of memory IDs to delete
   * @returns Promise<number> Number of memories successfully deleted
   */
  async bulkDeleteUnsafe(characterId: string, memoryIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return 0;
        }

        // Chunked: the query translator expands `$in` to one bind variable
        // per ID, and a full-wipe cascade can exceed SQLITE_MAX_VARIABLE_NUMBER.
        let deletedCount = 0;
        for (const chunk of chunkArray(memoryIds, SQLITE_VARIABLE_CHUNK_SIZE)) {
          deletedCount += await this.deleteMany({
            characterId,
            id: { $in: chunk },
          });
        }
        return deletedCount;
      },
      'Error bulk deleting memories for character',
      { characterId, count: memoryIds.length }
    );
  }

  /**
   * Update the lastAccessedAt timestamp for a memory
   * @param characterId The character ID
   * @param memoryId The memory ID
   * @returns Promise<Memory | null> The updated memory if found, null otherwise
   */
  async updateAccessTime(characterId: string, memoryId: string): Promise<Memory | null> {
    return this.safeQuery(
      async () => {
        const memory = await this.findById(memoryId);
        if (!memory) {
          logger.warn('Memory not found for access time update', { memoryId, characterId });
          return null;
        }

        if (memory.characterId !== characterId) {
          logger.warn('Memory does not belong to character', { characterId, memoryId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        return await this.update(memoryId, { lastAccessedAt: now });
      },
      'Error updating memory access time',
      { characterId, memoryId }
    );
  }

  /**
   * Bulk-update lastAccessedAt for a set of memories.
   * Used by the semantic search return path so the recent-access signal in the
   * blended protection score reflects actual usage. Character-scoped so a
   * compromised id list can only affect that character's rows.
   * Returns the number of rows updated.
   */
  async updateAccessTimeBulk(characterId: string, memoryIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) {
          return 0;
        }
        const now = this.getCurrentTimestamp();
        return await this.updateMany(
          { characterId, id: { $in: memoryIds } },
          { lastAccessedAt: now },
        );
      },
      'Error bulk-updating memory access times',
      { characterId, count: memoryIds.length },
      0,
    );
  }

  /**
   * Count the number of memories for a character
   * @param characterId The character ID
   * @returns Promise<number> Number of memories for the character
   */
  async countByCharacterId(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ characterId });
        return count;
      },
      'Error counting memories for character',
      { characterId },
      0
    );
  }

  /**
   * The whole memory corpus in two counts: every row, and the rows created at
   * or after `since` (0 when `since` is null). What the TF-IDF refit policy
   * weighs (`assessBuiltinRefit`); the refit fits on these same rows.
   */
  async countCorpusSince(since: string | null): Promise<{ total: number; createdSince: number }> {
    return this.safeQuery(
      async () => {
        const total = await this.count({} as TypedQueryFilter<Memory>);
        const createdSince = since
          ? await this.count({ createdAt: { $gte: since } } as TypedQueryFilter<Memory>)
          : 0;
        return { total, createdSince };
      },
      'Error counting the memory corpus',
      { since },
      { total: 0, createdSince: 0 }
    );
  }

  // ==========================================================================
  // Tiers and consolidation (memory-consolidation-and-tiers.md, workstream B)
  // ==========================================================================

  /**
   * How a character's memories split against the housekeeping cap (bug 210,
   * locked decision 3): the cap counts **demotable** rows only — hot AUTO
   * rows. MANUAL rows and CONSOLIDATED digests are hot but never demoted by
   * policy, so they are reported as `protected` and never measured against it.
   */
  async countCapBreakdown(
    characterId: string,
  ): Promise<{ hotTotal: number; demotable: number; protected: number; cold: number }> {
    return this.safeQuery(
      async () => {
        const rows = await rawQuery<
          Array<{ hot: number | bigint | null; demotable: number | bigint | null; cold: number | bigint | null }>
        >(
          `SELECT
             SUM(CASE WHEN ${HOT_TIER_SQL} THEN 1 ELSE 0 END) AS hot,
             SUM(CASE WHEN ${HOT_TIER_SQL} AND source = 'AUTO' THEN 1 ELSE 0 END) AS demotable,
             SUM(CASE WHEN ${HOT_TIER_SQL} THEN 0 ELSE 1 END) AS cold
           FROM memories WHERE characterId = ?`,
          [characterId],
        );
        const hotTotal = Number(rows[0]?.hot ?? 0);
        const demotable = Number(rows[0]?.demotable ?? 0);
        return { hotTotal, demotable, protected: hotTotal - demotable, cold: Number(rows[0]?.cold ?? 0) };
      },
      'Error counting memories against the housekeeping cap',
      { characterId },
      { hotTotal: 0, demotable: 0, protected: 0, cold: 0 },
    );
  }

  /**
   * Count a character's hot, non-digest memories the consolidator has never
   * considered (`consolidatedAt IS NULL`). Drives the watermark trigger.
   */
  async countUnconsideredHot(characterId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const rows = await rawQuery<Array<{ n: number | bigint }>>(
          `SELECT COUNT(*) AS n FROM memories
            WHERE characterId = ?
              AND ${HOT_TIER_SQL}
              AND consolidatedAt IS NULL
              AND source != 'CONSOLIDATED'`,
          [characterId],
        );
        return Number(rows[0]?.n ?? 0);
      },
      'Error counting unconsidered hot memories',
      { characterId },
      0,
    );
  }

  /**
   * Every embedded memory of a character as the index holds it: id, vector and
   * tier, in one query. `memories.embedding` and `memories.tier` are the only
   * copy (the `vector_entries` mirror was retired in Phase B of the memory
   * refactor); the in-process store is a cache of this read. A row whose blob
   * cannot be decoded is skipped with a warning rather than costing the index.
   */
  async findIndexRowsByCharacterId(
    characterId: string,
  ): Promise<Array<{ id: string; embedding: Float32Array; tier: MemoryTier }>> {
    return this.safeQuery(
      async () => {
        const rows = await rawQuery<Array<{ id: string; embedding: unknown; tier: string | null }>>(
          `SELECT id, embedding, tier FROM memories WHERE characterId = ? AND embedding IS NOT NULL`,
          [characterId],
        );
        const out: Array<{ id: string; embedding: Float32Array; tier: MemoryTier }> = [];
        let undecodable = 0;
        for (const row of rows) {
          const embedding = decodeStoredEmbedding(row.embedding);
          if (!embedding || embedding.length === 0) {
            undecodable++;
            continue;
          }
          out.push({ id: row.id, embedding, tier: row.tier === 'cold' ? 'cold' : 'hot' });
        }
        if (undecodable > 0) {
          logger.warn('Skipped memory embeddings that could not be decoded', { characterId, undecodable });
        }
        logger.debug('Read memory index rows', { characterId, rows: out.length });
        return out;
      },
      'Error reading memory index rows',
      { characterId },
      [],
    );
  }

  /**
   * A character's hot digests (`source = 'CONSOLIDATED'`), best first by
   * `reinforcedImportance` then recency then id.
   *
   * `subject` selects the bucket: a character id → digests about that
   * character; `'self'` → digests about the holder (`aboutCharacterId =
   * characterId`); `'any'` → every hot digest. `limit <= 0` returns [].
   */
  async findHotDigests(
    characterId: string,
    subject: string | 'self' | 'any',
    limit: number,
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (limit <= 0) return [];
        const params: unknown[] = [characterId];
        let subjectSql = '';
        if (subject === 'self') {
          subjectSql = 'AND aboutCharacterId = ?';
          params.push(characterId);
        } else if (subject !== 'any') {
          subjectSql = 'AND aboutCharacterId = ?';
          params.push(subject);
        }
        params.push(limit);
        const rows = await rawQuery<Record<string, unknown>[]>(
          `SELECT * FROM memories
            WHERE characterId = ?
              AND source = 'CONSOLIDATED'
              AND ${HOT_TIER_SQL}
              ${subjectSql}
            ORDER BY reinforcedImportance DESC,
                     COALESCE(lastReinforcedAt, createdAt) DESC,
                     id ASC
            LIMIT ?`,
          params,
        );
        return this.hydrateRawRows(rows, 'hot digest fetch');
      },
      'Error finding hot digests',
      { characterId, subject, limit },
      [],
    );
  }

  /**
   * A holder's hot keystones about one or more subjects, or about themself
   * (`'self'`: rows about the holder, or about no one). Ordered by creation,
   * then id — never by score — so the frozen archive's keystone lines keep
   * their order however the rows are reinforced (inner-circle-recall.md C3).
   */
  async findKeystones(characterId: string, subjects: readonly string[] | 'self'): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const params: unknown[] = [characterId];
        let subjectSql: string;
        if (subjects === 'self') {
          subjectSql = '(aboutCharacterId = ? OR aboutCharacterId IS NULL)';
          params.push(characterId);
        } else {
          const ids = [...new Set(subjects.filter((id) => id && id !== characterId))];
          if (ids.length === 0) return [];
          subjectSql = `aboutCharacterId IN (${ids.map(() => '?').join(', ')})`;
          params.push(...ids);
        }
        const rows = await rawQuery<Record<string, unknown>[]>(
          `SELECT * FROM memories
            WHERE characterId = ?
              AND keystone = 1
              AND ${HOT_TIER_SQL}
              AND ${subjectSql}
            ORDER BY createdAt ASC, id ASC`,
          params,
        );
        return this.hydrateRawRows(rows, 'keystone fetch');
      },
      'Error finding keystones',
      { characterId, subjects: subjects === 'self' ? 'self' : subjects.length },
      [],
    );
  }

  /**
   * How many hot keystones a holder keeps about one subject (`null` or the
   * holder's own id: about themself), leaving `excludeId` out — the row being
   * edited. The write paths hold this under `KEYSTONES_PER_SUBJECT_MAX`.
   */
  async countKeystones(characterId: string, aboutCharacterId: string | null, excludeId?: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const self = !aboutCharacterId || aboutCharacterId === characterId;
        const params: unknown[] = [characterId];
        const subjectSql = self ? '(aboutCharacterId = ? OR aboutCharacterId IS NULL)' : 'aboutCharacterId = ?';
        params.push(self ? characterId : aboutCharacterId);
        let excludeSql = '';
        if (excludeId) {
          excludeSql = 'AND id <> ?';
          params.push(excludeId);
        }
        const rows = await rawQuery<Array<{ n: number | bigint }>>(
          `SELECT COUNT(*) AS n FROM memories
            WHERE characterId = ? AND keystone = 1 AND ${HOT_TIER_SQL} AND ${subjectSql} ${excludeSql}`,
          params,
        );
        return Number(rows[0]?.n ?? 0);
      },
      'Error counting keystones',
      { characterId, aboutCharacterId },
      0,
    );
  }

  /**
   * Move a set of a character's memories to `tier`. `extra` rides along on the
   * same write — `supersededById` / `consolidatedAt` when the consolidator
   * sends members cold, `supersededById: null` when a demoted row is promoted
   * back. Scoped by `characterId` so a stray id can never touch another
   * character's store. Returns the number of rows changed (0 in the job
   * child, where the write is buffered).
   *
   * Called only by `memoryIndex.setTier` (`lib/memory/index-store/`), which
   * keeps the in-process index in step; a test greps for any other caller.
   */
  async updateTierBulk(
    characterId: string,
    memoryIds: string[],
    tier: MemoryTier,
    extra: Partial<Pick<Memory, 'supersededById' | 'consolidatedAt'>> = {},
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) return 0;
        const now = new Date().toISOString();
        // `supersededAt` moves with `supersededById` and only with it: stamped
        // when a digest supersedes the rows, cleared when that link is cut. A
        // tier move that says nothing about the digest leaves it alone. Cold
        // retention ages by it, not by `updatedAt` (bug 225).
        const supersession: Partial<Memory> = {};
        if (extra.supersededById !== undefined) {
          supersession.supersededAt = extra.supersededById ? now : null;
        }
        let changed = 0;
        for (const chunk of chunkArray(memoryIds, SQLITE_VARIABLE_CHUNK_SIZE)) {
          const result = await this.updateMany(
            { characterId, id: { $in: chunk } } as TypedQueryFilter<Memory>,
            { tier, ...extra, ...supersession, updatedAt: now } as Partial<Memory>,
          );
          changed += typeof result === 'number' ? result : 0;
        }
        logger.debug('Moved memories between tiers', {
          characterId,
          tier,
          requested: memoryIds.length,
          changed,
          supersededById: extra.supersededById ?? undefined,
        });
        return changed;
      },
      'Error moving memories between tiers',
      { characterId, tier, count: memoryIds.length },
      0,
    );
  }

  /**
   * Stamp `consolidatedAt` on rows the consolidator looked at but did not
   * fold (cluster too small), so they are not re-scanned every run.
   */
  async markConsidered(characterId: string, memoryIds: string[], when: string): Promise<number> {
    return this.safeQuery(
      async () => {
        if (memoryIds.length === 0) return 0;
        let changed = 0;
        for (const chunk of chunkArray(memoryIds, SQLITE_VARIABLE_CHUNK_SIZE)) {
          const result = await this.updateMany(
            { characterId, id: { $in: chunk } } as TypedQueryFilter<Memory>,
            { consolidatedAt: when } as Partial<Memory>,
          );
          changed += typeof result === 'number' ? result : 0;
        }
        return changed;
      },
      'Error marking memories considered',
      { characterId, count: memoryIds.length },
      0,
    );
  }

  /**
   * Find the cold rows a given digest superseded.
   */
  async findSupersededBy(digestId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => this.findByFilter({ supersededById: digestId } as TypedQueryFilter<Memory>),
      'Error finding memories superseded by digest',
      { digestId },
      [],
    );
  }

  /**
   * The given holders' digests whose `consolidatedFrom` names any of
   * `memberIds` — the delete chokepoint's digest scan. Scoped by holder (a
   * digest and its members share one) and pre-filtered with a quoted-id LIKE
   * per member, the same shape as the `relatedMemoryIds` neighbour scan, so it
   * never walks every digest in the instance. The JSON is parsed here; callers
   * still check membership exactly. Rows carry `id`, `characterId` and
   * `consolidatedFrom` only.
   */
  async findDigestsContainingMembers(
    characterIds: readonly string[],
    memberIds: readonly string[],
  ): Promise<Array<{ id: string; characterId: string; consolidatedFrom: string[] }>> {
    return this.safeQuery(
      async () => {
        const holders = Array.from(new Set(characterIds));
        const members = Array.from(new Set(memberIds));
        if (holders.length === 0 || members.length === 0) return [];
        const found = new Map<string, { id: string; characterId: string; consolidatedFrom: string[] }>();
        // Members chunked small: each contributes one LIKE term and one bind.
        const MEMBER_CHUNK = 50;
        for (const holderChunk of chunkArray(holders, SQLITE_VARIABLE_CHUNK_SIZE - MEMBER_CHUNK)) {
          for (const memberChunk of chunkArray(members, MEMBER_CHUNK)) {
            const rows = await rawQuery<Array<{ id: string; characterId: string; consolidatedFrom: string | null }>>(
              `SELECT id, characterId, consolidatedFrom FROM memories
                WHERE characterId IN (${holderChunk.map(() => '?').join(',')})
                  AND (${memberChunk.map(() => 'consolidatedFrom LIKE ?').join(' OR ')})`,
              [...holderChunk, ...memberChunk.map((id) => `%"${id}"%`)],
            );
            for (const row of rows) {
              if (found.has(row.id)) continue;
              let parsed: unknown = [];
              try {
                parsed = row.consolidatedFrom ? JSON.parse(row.consolidatedFrom) : [];
              } catch {
                parsed = [];
              }
              found.set(row.id, {
                id: row.id,
                characterId: row.characterId,
                consolidatedFrom: Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
              });
            }
          }
        }
        logger.debug('Found digests naming doomed members', {
          holders: holders.length,
          members: members.length,
          digests: found.size,
        });
        return Array.from(found.values());
      },
      'Error finding digests containing members',
      { characters: characterIds.length, members: memberIds.length },
      [],
    );
  }

  /**
   * Links that name a memory row which no longer exists — the graph repair's
   * scan (`lib/memory/repair.ts`, `quilltap memories validate --repair`). One
   * pass per link column, each a `NOT EXISTS` against the whole table, since a
   * link may legitimately cross holders. Optionally scoped to the given
   * holders' rows. Read-only.
   */
  async findDanglingLinks(characterIds?: readonly string[]): Promise<DanglingMemoryLinks> {
    return this.safeQuery(
      async () => {
        const scoped = characterIds ? Array.from(new Set(characterIds)) : null;
        const out: DanglingMemoryLinks = { related: [], consolidatedFrom: [], supersededBy: [] };
        if (scoped && scoped.length === 0) return out;
        const chunks = scoped ? chunkArray(scoped, SQLITE_VARIABLE_CHUNK_SIZE) : [null];
        for (const chunk of chunks) {
          const holder = chunk ? `AND m.characterId IN (${chunk.map(() => '?').join(',')})` : '';
          const params = chunk ?? [];
          for (const column of ['relatedMemoryIds', 'consolidatedFrom'] as const) {
            const rows = await rawQuery<Array<{ id: string; characterId: string; target: string; listLength: number }>>(
              `SELECT m.id AS id, m.characterId AS characterId, j.value AS target,
                      json_array_length(m.${column}) AS listLength
                 FROM memories m, json_each(m.${column}) j
                WHERE m.${column} IS NOT NULL
                  AND m.${column} <> '[]'
                  AND json_valid(m.${column})
                  ${holder}
                  AND NOT EXISTS (SELECT 1 FROM memories t WHERE t.id = j.value)`,
              params,
            );
            if (column === 'relatedMemoryIds') {
              out.related.push(...rows.map(({ id, characterId, target }) => ({ id, characterId, target })));
            } else {
              out.consolidatedFrom.push(...rows.map(({ id, characterId, target, listLength }) => ({ id, characterId, target, memberCount: listLength })));
            }
          }
          const superseded = await rawQuery<Array<{ id: string; characterId: string; target: string; tier: string | null }>>(
            `SELECT m.id AS id, m.characterId AS characterId, m.supersededById AS target, m.tier AS tier
               FROM memories m
              WHERE m.supersededById IS NOT NULL
                ${holder}
                AND NOT EXISTS (SELECT 1 FROM memories t WHERE t.id = m.supersededById)`,
            params,
          );
          out.supersededBy.push(
            ...superseded.map((r) => ({ ...r, tier: (r.tier === 'cold' ? 'cold' : 'hot') as MemoryTier })),
          );
        }
        logger.debug('Scanned for dangling memory links', {
          holders: scoped ? scoped.length : 'all',
          related: out.related.length,
          consolidatedFrom: out.consolidatedFrom.length,
          supersededBy: out.supersededBy.length,
        });
        return out;
      },
      // No fallback: a scan that failed must not read as a clean graph.
      'Error scanning for dangling memory links',
      { characters: characterIds?.length ?? 'all' },
    );
  }

  /**
   * Ids (with holder) of the given holders' rows whose `supersededById` names
   * one of `digestIds` — the members a deleted digest leaves behind. Backed by
   * `idx_memories_supersededById`.
   */
  async findIdsSupersededByAny(
    characterIds: readonly string[],
    digestIds: readonly string[],
  ): Promise<Array<{ id: string; characterId: string }>> {
    return this.safeQuery(
      async () => {
        const holders = Array.from(new Set(characterIds));
        if (holders.length === 0 || digestIds.length === 0) return [];
        const out: Array<{ id: string; characterId: string }> = [];
        const half = Math.floor(SQLITE_VARIABLE_CHUNK_SIZE / 2);
        for (const holderChunk of chunkArray(holders, half)) {
          for (const digestChunk of chunkArray(Array.from(digestIds), half)) {
            const rows = await rawQuery<Array<{ id: string; characterId: string }>>(
              `SELECT id, characterId FROM memories
                WHERE supersededById IN (${digestChunk.map(() => '?').join(',')})
                  AND characterId IN (${holderChunk.map(() => '?').join(',')})`,
              [...digestChunk, ...holderChunk],
            );
            out.push(...rows);
          }
        }
        return out;
      },
      'Error finding members superseded by digests',
      { characters: characterIds.length, digests: digestIds.length },
      [],
    );
  }

  /**
   * Remove `memberIds` from one digest's `consolidatedFrom`, in SQL against
   * the row as it stands at write time. A delta, not a whole-array write: in
   * the job child two deletes from one digest each buffer only their own
   * removal, and the parent's replay applies both — a whole-array write built
   * from the child's snapshot would let the second resurrect the first's
   * member (review of bug 225). Returns rows changed (0 in the job child, where
   * the write is buffered).
   */
  async removeConsolidatedMembers(
    characterId: string,
    digestId: string,
    memberIds: readonly string[],
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        const members = Array.from(new Set(memberIds));
        if (members.length === 0) return 0;
        const db = getRawDatabase();
        if (!db) {
          throw new Error('Digest member removal: the main database is not initialized');
        }
        const now = this.getCurrentTimestamp();
        let changed = 0;
        for (const chunk of chunkArray(members, SQLITE_VARIABLE_CHUNK_SIZE - 3)) {
          const result = db
            .prepare(
              `UPDATE memories
                  SET consolidatedFrom = (
                        SELECT COALESCE(json_group_array(value), '[]')
                          FROM json_each(memories.consolidatedFrom)
                         WHERE value NOT IN (${chunk.map(() => '?').join(',')})
                      ),
                      updatedAt = ?
                WHERE id = ? AND characterId = ?
                  AND json_valid(consolidatedFrom)`,
            )
            .run(...chunk, now, digestId, characterId);
          changed = Math.max(changed, result.changes);
        }
        logger.debug('Removed members from digest', { characterId, digestId, members: members.length, changed });
        return changed;
      },
      'Error removing members from digest',
      { characterId, digestId, count: memberIds.length },
      0,
    );
  }

  /**
   * Holder and subject of every digest (`source = 'CONSOLIDATED'`) among
   * `ids`. Read before such rows are deleted, so the Commonplace mirror of
   * their buckets can be refreshed once the delete has committed.
   */
  async findDigestSubjectsByIds(
    ids: readonly string[],
  ): Promise<Array<{ id: string; characterId: string; aboutCharacterId: string | null }>> {
    return this.safeQuery(
      async () => {
        const out: Array<{ id: string; characterId: string; aboutCharacterId: string | null }> = [];
        for (const chunk of chunkArray(Array.from(new Set(ids)), SQLITE_VARIABLE_CHUNK_SIZE)) {
          const rows = await rawQuery<Array<{ id: string; characterId: string; aboutCharacterId: string | null }>>(
            `SELECT id, characterId, aboutCharacterId FROM memories
              WHERE source = 'CONSOLIDATED' AND id IN (${chunk.map(() => '?').join(',')})`,
            chunk,
          );
          out.push(...rows);
        }
        return out;
      },
      'Error finding digest subjects',
      { count: ids.length },
      [],
    );
  }

  /**
   * Count memories created for a character at or after the given ISO timestamp.
   * Used by the extraction rate-limiter.
   * @param characterId The character ID
   * @param since ISO-8601 timestamp; memories with createdAt >= since are counted
   * @returns Promise<number> Number of matching memories
   */
  async countCreatedSince(characterId: string, since: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({
          characterId,
          createdAt: { $gte: since },
        } as TypedQueryFilter<Memory>);
        return count;
      },
      'Error counting memories created since timestamp',
      { characterId, since },
      0
    );
  }

  /**
   * Count memories that are missing an embedding, optionally filtered by character.
   * A memory is "missing" if its embedding column is null (the BLOB either
   * never landed because the pre-PR-2 keyword-fallback gate wrote the row
   * without one, or a subsequent re-embed failed).
   */
  async countWithoutEmbedding(characterId?: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const filter: TypedQueryFilter<Memory> = characterId
          ? { characterId, embedding: null } as TypedQueryFilter<Memory>
          : { embedding: null } as TypedQueryFilter<Memory>;
        return await this.count(filter);
      },
      'Error counting memories without embedding',
      { characterId },
      0
    );
  }

  /**
   * Find memory IDs that are missing an embedding, optionally filtered by
   * character. Returns at most `limit` IDs per call so the caller can batch
   * the backfill through the background-job queue without overwhelming it.
   */
  async findIdsWithoutEmbedding(options: { characterId?: string; limit?: number } = {}): Promise<Array<{ id: string; characterId: string }>> {
    return this.safeQuery(
      async () => {
        // Two columns only: a backfill batch is up to a few thousand rows, and
        // hydrating each whole row to read its id was most of the cost.
        const params: unknown[] = [];
        let where = 'embedding IS NULL';
        if (options.characterId) {
          where += ' AND characterId = ?';
          params.push(options.characterId);
        }
        params.push(options.limit ?? 500);
        return await rawQuery<Array<{ id: string; characterId: string }>>(
          `SELECT id, characterId FROM memories WHERE ${where} ORDER BY createdAt DESC LIMIT ?`,
          params,
        );
      },
      'Error finding memories without embedding',
      { characterId: options.characterId, limit: options.limit },
      []
    );
  }


  /**
   * Find memories that a character has about another character
   * @param characterId The character who owns the memory
   * @param aboutCharacterId The character the memory is about
   * @returns Promise<Memory[]> Array of memories about the other character
   */
  async findByCharacterAboutCharacter(
    characterId: string,
    aboutCharacterId: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter(
          { characterId, aboutCharacterId },
          {
            // reinforcedImportance, the value every importance filter reads.
            sort: { reinforcedImportance: -1, createdAt: -1 },
          }
        );
        return memories;
      },
      'Error finding memories about character',
      { characterId, aboutCharacterId },
      []
    );
  }

  /**
   * Find memories a character has about any of the specified characters,
   * capped per about-character via a window function so SQLite ranks and
   * truncates each partition before returning rows.
   *
   * Sort key approximates salience (`lib/memory/scoring`): reinforced
   * importance dominates, with `lastReinforcedAt` (falling back to
   * `createdAt`) breaking ties so a recently-reinforced memory beats a stale
   * one of equal score.
   *
   * The caller (context-manager) sizes `limitPerCharacter` from the
   * inter-character whisper budget plus a buffer; any further re-ranking by
   * salience happens in JS over this much smaller set.
   */
  async findByCharacterAboutCharacters(
    characterId: string,
    aboutCharacterIds: string[],
    limitPerCharacter: number
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (aboutCharacterIds.length === 0 || limitPerCharacter <= 0) {
          return [];
        }

        const placeholders = aboutCharacterIds.map(() => '?').join(', ');
        const sql = `
          WITH ranked AS (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY aboutCharacterId
                ORDER BY COALESCE(reinforcedImportance, importance) DESC,
                         COALESCE(lastReinforcedAt, createdAt) DESC
              ) AS rn
            FROM memories
            WHERE characterId = ?
              AND aboutCharacterId IN (${placeholders})
              AND ${HOT_TIER_SQL}
          )
          SELECT * FROM ranked WHERE rn <= ?
        `;
        const params: unknown[] = [characterId, ...aboutCharacterIds, limitPerCharacter];

        const rows = await rawQuery<Record<string, unknown>[]>(sql, params);

        // rn is a synthetic column; strip it before validation
        for (const row of rows) delete row.rn;
        return this.hydrateRawRows(rows, 'partition fetch');
      },
      'Error finding memories about characters',
      { characterId, aboutCharacterCount: aboutCharacterIds.length, limitPerCharacter },
      []
    );
  }

  /**
   * Find all memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<Memory[]> Array of memories associated with the chat
   */
  async findByChatId(chatId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ chatId });
        return memories;
      },
      'Error finding memories by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find all memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<Memory[]> Array of memories created from the message
   */
  async findBySourceMessageId(sourceMessageId: string): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({ sourceMessageId });
        return memories;
      },
      'Error finding memories by source message ID',
      { sourceMessageId },
      []
    );
  }

  /**
   * Find a character's memories whose sourceMessageId is any of the given
   * message IDs. Used by the fold-time episode pass to link a consolidated
   * episode to the per-turn fragment memories from the same window.
   */
  async findByCharacterAndSourceMessageIds(
    characterId: string,
    sourceMessageIds: string[],
  ): Promise<Memory[]> {
    if (sourceMessageIds.length === 0) return [];
    return this.safeQuery(
      async () => {
        const memories = await this.findByFilter({
          characterId,
          sourceMessageId: { $in: sourceMessageIds },
        } as TypedQueryFilter<Memory>);
        return memories;
      },
      'Error finding memories by character and source message IDs',
      { characterId, count: sourceMessageIds.length },
      []
    );
  }

  /**
   * Count memories associated with a specific source message
   * @param sourceMessageId The source message ID
   * @returns Promise<number> Number of memories for the message
   */
  async countBySourceMessageId(sourceMessageId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ sourceMessageId });
        return count;
      },
      'Error counting memories for source message',
      { sourceMessageId },
      0
    );
  }

  /**
   * Count memories associated with multiple source messages (for swipe groups)
   * @param sourceMessageIds Array of source message IDs
   * @returns Promise<number> Total number of memories
   */
  async countBySourceMessageIds(sourceMessageIds: string[]): Promise<number> {
    return this.safeQuery(
      async () => {
        if (sourceMessageIds.length === 0) {
          return 0;
        }

        const count = await this.count({
          sourceMessageId: { $in: sourceMessageIds },
        });
        return count;
      },
      'Error counting memories for source messages',
      { count: sourceMessageIds.length },
      0
    );
  }

  /**
   * Count memories associated with a specific chat
   * @param chatId The chat ID
   * @returns Promise<number> Number of memories for the chat
   */
  async countByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const count = await this.count({ chatId });
        return count;
      },
      'Error counting memories for chat',
      { chatId },
      0
    );
  }

  /**
   * Count memories per chat in bulk for a set of chat IDs. Single GROUP BY
   * query — used by chat-list enrichment to avoid N+1 `countByChatId` calls.
   * Chats with zero memories are absent from the returned map.
   */
  async countByChatIds(chatIds: string[]): Promise<Map<string, number>> {
    return this.safeQuery(
      async () => {
        if (chatIds.length === 0) return new Map<string, number>();
        const placeholders = chatIds.map(() => '?').join(', ');
        const sql = `
          SELECT chatId, COUNT(*) AS count
          FROM memories
          WHERE chatId IN (${placeholders})
          GROUP BY chatId
        `;
        const rows = await rawQuery<Array<{ chatId: string; count: number | bigint }>>(sql, chatIds);
        return new Map(rows.map((r) => [r.chatId, Number(r.count)]));
      },
      'Error counting memories for chats',
      { chatIdCount: chatIds.length },
      new Map<string, number>()
    );
  }

  /**
   * Find every distinct, non-null chatId currently referenced by any memory.
   *
   * Used by the regenerate-all fan-out to spot orphan memories whose chat
   * has been deleted — much cheaper than walking each character's memories
   * individually on instances with tens of thousands of rows.
   */
  async findDistinctChatIds(): Promise<string[]> {
    return this.safeQuery(
      async () => {
        const rows = (await rawQuery<Array<{ chatId: string | null }>>(
          'SELECT DISTINCT chatId FROM memories WHERE chatId IS NOT NULL'
        )) ?? [];
        return rows
          .map((r) => r.chatId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      },
      'Error listing distinct memory chatIds',
      {},
      []
    );
  }

  /**
   * Find every distinct characterId that owns at least one memory.
   *
   * Used by the reindex-all fan-out instead of the characters repository:
   * `characters.findAll`/`findByUserId` silently DROP characters whose vault
   * is unavailable, which would leave those characters' memories permanently
   * un-re-embedded after a profile switch. Memories are the ground truth for
   * "who needs re-embedding".
   */
  async findDistinctCharacterIds(): Promise<string[]> {
    return this.safeQuery(
      async () => {
        const rows = (await rawQuery<Array<{ characterId: string | null }>>(
          'SELECT DISTINCT characterId FROM memories WHERE characterId IS NOT NULL'
        )) ?? [];
        return rows
          .map((r) => r.characterId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      },
      'Error listing distinct memory characterIds',
      {},
      []
    );
  }

  // ============================================================================
  // SEARCH AND REPLACE OPERATIONS
  // ============================================================================

  /**
   * Count memories containing specific text
   * Searches in content, summary, and keywords fields
   * @param characterId Optional character ID filter
   * @param chatId Optional chat ID filter
   * @param searchText Text to search for
   * @returns Number of memories containing the text
   */
  async countMemoriesWithText(
    characterId: string | null,
    chatId: string | null,
    searchText: string
  ): Promise<number> {
    return this.safeQuery(
      async () => {
        if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search text exceeds maximum length', {
            characterId,
            queryLength: searchText.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return 0;
        }
        const regex = new RegExp(this.escapeRegex(searchText), 'i');

        // Build the query filter - search in content, summary, and keywords
        const filter: TypedQueryFilter<Memory> = {
          $or: [
            { content: { $regex: regex } },
            { summary: { $regex: regex } },
            { keywords: { $regex: regex } },
          ],
        };

        if (characterId) filter.characterId = characterId;
        if (chatId) filter.chatId = chatId;

        const count = await this.count(filter);
        return count;
      },
      'Error counting memories with text',
      { characterId, chatId },
      0
    );
  }

  /**
   * Find memories containing specific text
   * Searches in content, summary, and keywords fields
   * @param characterId Optional character ID filter
   * @param chatId Optional chat ID filter
   * @param searchText Text to search for
   * @returns Array of memories containing the text
   */
  async findMemoriesWithText(
    characterId: string | null,
    chatId: string | null,
    searchText: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        if (searchText.length > MAX_SEARCH_QUERY_LENGTH) {
          logger.warn('Search text exceeds maximum length', {
            characterId,
            queryLength: searchText.length,
            maxLength: MAX_SEARCH_QUERY_LENGTH,
          });
          return [];
        }
        const regex = new RegExp(this.escapeRegex(searchText), 'i');

        // Build the query filter - search in content, summary, and keywords
        const filter: TypedQueryFilter<Memory> = {
          $or: [
            { content: { $regex: regex } },
            { summary: { $regex: regex } },
            { keywords: { $regex: regex } },
          ],
        };

        if (characterId) filter.characterId = characterId;
        if (chatId) filter.chatId = chatId;

        const memories = await this.findByFilter(filter);
        return memories;
      },
      'Error finding memories with text',
      { characterId, chatId },
      []
    );
  }

  /**
   * Text search in memory content and summary for memories about a specific character
   * @param characterId The character who owns the memories
   * @param aboutCharacterId The character the memories are about
   * @param query Search query string
   * @returns Promise<Memory[]> Array of memories matching the search query
   */
  async searchByContentAboutCharacter(
    characterId: string,
    aboutCharacterId: string,
    query: string
  ): Promise<Memory[]> {
    return this.safeQuery(
      async () => {
        // Escape special regex characters to treat query as literal text
        const escapedQuery = this.escapeRegex(query);
        const regex = new RegExp(escapedQuery, 'i');

        const memories = await this.findByFilter({
          characterId,
          aboutCharacterId,
          $or: [{ content: { $regex: regex } }, { summary: { $regex: regex } }],
        });
        return memories;
      },
      'Error searching memories about character by content',
      { characterId, aboutCharacterId, queryLength: query.length },
      []
    );
  }
}
