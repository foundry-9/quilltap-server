/**
 * Consolidation clustering — pure, I/O-free.
 *
 * The consolidation job (`lib/memory/consolidation.ts`) folds clusters of a
 * character's hot memories into digest rows. This module decides *which* rows
 * belong together; it never reads the database, calls a model, or logs, so it
 * is trivially unit-testable and safe in the forked job child.
 *
 * Within one subject bucket (memory-consolidation-and-tiers.md §C3):
 *
 *   1. Semantic and episodic rows never share a cluster — episodes consolidate
 *      into *episode* digests, never into standing-fact digests.
 *   2. **Digest attraction.** A row whose best neighbour (cosine ≥ threshold,
 *      across every item of its kind, digests included) is an existing hot
 *      digest joins that digest's cluster, closest first, until the cluster
 *      reaches `maxClusterSize` (the digest counts as one). Digests are seeds:
 *      two digests are never merged with each other.
 *   3. **Greedy agglomerative clustering** over the remaining rows with
 *      *average linkage*: repeatedly merge the most similar pair of clusters
 *      whose average pairwise cosine is ≥ threshold and whose merged size is
 *      ≤ `maxClusterSize`. Similarities are updated with the Lance–Williams
 *      formula, and each cluster caches its best eligible partner, so a bucket
 *      of `n` rows costs O(n²) rather than O(n³).
 *   4. **Episodic window.** An episodic cluster may only span
 *      {@link EPISODIC_WINDOW_MS} (one day) between its earliest and latest
 *      event time — i.e. every pair of members sits within a day of each other.
 *      Event time is `occurredAt`, falling back to `createdAt` (the caller
 *      supplies it). This mirrors the gate's `DATE_GUARD_DAYS` rule — distinct
 *      occasions stay distinct — at a one-day grain, and like the date guard
 *      it never blocks on a missing timestamp.
 *
 * {@link selectClusters} then applies the size floor and the run budget.
 *
 * @module memory/consolidation-clustering
 */

/** Milliseconds per day. */
const DAY_MS = 86_400_000

/** Episodic rows cluster only with episodic rows whose event times sit within this window. */
export const EPISODIC_WINDOW_MS = DAY_MS

/** One row (or existing digest) offered to the clusterer. */
export interface ClusterItem {
  id: string
  /** Unit-length embedding (cosine == dot product). */
  embedding: Float32Array
  kind: 'semantic' | 'episodic'
  /** True for an existing hot digest (`source: 'CONSOLIDATED'`). */
  isDigest: boolean
  /** Event time in ms (`occurredAt`, else `createdAt`); null when unknown. */
  eventTimeMs: number | null
  /** Write time in ms — drives the age-based size floor. */
  createdAtMs: number
  /** `consolidatedAt` in ms, or null when the consolidator has never considered the row. */
  consideredAtMs: number | null
  /** Ranking weight — the row's `reinforcedImportance`. */
  weight: number
}

export interface ClusterParams {
  /** Cosine similarity a pair (or cluster average) must reach to merge. */
  threshold: number
  /** Largest cluster, counting an existing digest as one member. */
  maxClusterSize: number
  /** Override for tests; defaults to {@link EPISODIC_WINDOW_MS}. */
  episodicWindowMs?: number
}

/** A cluster: an optional existing digest plus the rows that join it. */
export interface Cluster {
  kind: 'semantic' | 'episodic'
  /** The existing digest this cluster formed around, or null. */
  digestId: string | null
  /** Non-digest member ids. */
  memberIds: string[]
  /** Σ weight of every member, digest included. */
  score: number
}

/** Cosine of two unit vectors; -1 when their dimensions disagree (never clusters). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return -1
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

interface Span {
  min: number | null
  max: number | null
}

function mergeSpan(a: Span, b: Span): Span {
  const mins = [a.min, b.min].filter((v): v is number => v !== null)
  const maxes = [a.max, b.max].filter((v): v is number => v !== null)
  return {
    min: mins.length > 0 ? Math.min(...mins) : null,
    max: maxes.length > 0 ? Math.max(...maxes) : null,
  }
}

function spanFits(span: Span, windowMs: number): boolean {
  if (span.min === null || span.max === null) return true
  return span.max - span.min <= windowMs
}

/**
 * Cluster one subject bucket. Returns every cluster, singletons included (the
 * caller needs them to mark lone rows considered). Digest seeds that attracted
 * no rows are omitted.
 */
export function clusterBucket(items: readonly ClusterItem[], params: ClusterParams): Cluster[] {
  const out: Cluster[] = []
  for (const kind of ['semantic', 'episodic'] as const) {
    const group = items.filter((item) => item.kind === kind)
    if (group.length === 0) continue
    out.push(...clusterGroup(group, kind, params))
  }
  return out
}

function clusterGroup(
  group: readonly ClusterItem[],
  kind: 'semantic' | 'episodic',
  params: ClusterParams,
): Cluster[] {
  const n = group.length
  const { threshold } = params
  const maxSize = Math.max(1, params.maxClusterSize)
  const windowMs = params.episodicWindowMs ?? EPISODIC_WINDOW_MS
  const timed = kind === 'episodic'

  // Full pairwise similarity. Rows of a bucket are capped by the caller, so
  // n² floats stay small.
  const sim = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    sim[i * n + i] = 1
    for (let j = i + 1; j < n; j++) {
      const s = cosine(group[i].embedding, group[j].embedding)
      sim[i * n + j] = s
      sim[j * n + i] = s
    }
  }

  const pairTimeOk = (i: number, j: number): boolean => {
    if (!timed) return true
    const a = group[i].eventTimeMs
    const b = group[j].eventTimeMs
    if (a === null || b === null) return true
    return Math.abs(a - b) <= windowMs
  }

  // ── Step 1: digest attraction ────────────────────────────────────────────
  const digestIdx: number[] = []
  const rowIdx: number[] = []
  for (let i = 0; i < n; i++) (group[i].isDigest ? digestIdx : rowIdx).push(i)

  const attractions: Array<{ row: number; digest: number; s: number }> = []
  for (const i of rowIdx) {
    let best = -1
    let bestS = -Infinity
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const s = sim[i * n + j]
      if (s < threshold || !pairTimeOk(i, j)) continue
      if (s > bestS) {
        bestS = s
        best = j
      }
    }
    if (best >= 0 && group[best].isDigest) {
      attractions.push({ row: i, digest: best, s: bestS })
    }
  }
  attractions.sort((a, b) => b.s - a.s)

  const digestMembers = new Map<number, number[]>()
  const digestSpan = new Map<number, Span>()
  for (const d of digestIdx) {
    digestMembers.set(d, [])
    const t = group[d].eventTimeMs
    digestSpan.set(d, { min: t, max: t })
  }
  const attracted = new Set<number>()
  for (const { row, digest } of attractions) {
    const members = digestMembers.get(digest)!
    if (members.length + 1 >= maxSize) continue // digest + members must stay ≤ maxSize
    const t = group[row].eventTimeMs
    const merged = mergeSpan(digestSpan.get(digest)!, { min: t, max: t })
    if (timed && !spanFits(merged, windowMs)) continue
    members.push(row)
    digestSpan.set(digest, merged)
    attracted.add(row)
  }

  const result: Cluster[] = []
  for (const d of digestIdx) {
    const rows = digestMembers.get(d)!
    if (rows.length === 0) continue
    result.push({
      kind,
      digestId: group[d].id,
      memberIds: rows.map((i) => group[i].id),
      score: group[d].weight + rows.reduce((sum, i) => sum + group[i].weight, 0),
    })
  }

  // ── Step 2: average-linkage agglomeration over the rest ──────────────────
  const rest = rowIdx.filter((i) => !attracted.has(i))
  const m = rest.length
  if (m === 0) return result

  const M = new Float32Array(m * m)
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) {
      M[a * m + b] = sim[rest[a] * n + rest[b]]
    }
  }
  const active = new Array<boolean>(m).fill(true)
  const size = new Array<number>(m).fill(1)
  const members: number[][] = rest.map((i) => [i])
  const spans: Span[] = rest.map((i) => ({ min: group[i].eventTimeMs, max: group[i].eventTimeMs }))
  const best = new Int32Array(m).fill(-1)
  const bestVal = new Float64Array(m).fill(-Infinity)

  const eligible = (a: number, b: number): boolean => {
    if (a === b || !active[a] || !active[b]) return false
    if (size[a] + size[b] > maxSize) return false
    if (M[a * m + b] < threshold) return false
    if (timed && !spanFits(mergeSpan(spans[a], spans[b]), windowMs)) return false
    return true
  }

  const recompute = (a: number): void => {
    best[a] = -1
    bestVal[a] = -Infinity
    for (let b = 0; b < m; b++) {
      if (!eligible(a, b)) continue
      const v = M[a * m + b]
      if (v > bestVal[a]) {
        bestVal[a] = v
        best[a] = b
      }
    }
  }

  for (let a = 0; a < m; a++) recompute(a)

  for (;;) {
    let a = -1
    let top = -Infinity
    for (let i = 0; i < m; i++) {
      if (active[i] && best[i] >= 0 && bestVal[i] > top) {
        top = bestVal[i]
        a = i
      }
    }
    if (a < 0) break
    const b = best[a]
    if (!eligible(a, b)) {
      // Stale cache: a size or span constraint closed this pair since it was
      // cached. Constraints only tighten, so a recompute is always progress.
      recompute(a)
      continue
    }

    // Merge b into a — Lance–Williams update for average linkage.
    const sa = size[a]
    const sb = size[b]
    for (let c = 0; c < m; c++) {
      if (!active[c] || c === a || c === b) continue
      const v = (sa * M[a * m + c] + sb * M[b * m + c]) / (sa + sb)
      M[a * m + c] = v
      M[c * m + a] = v
    }
    active[b] = false
    size[a] = sa + sb
    members[a] = members[a].concat(members[b])
    members[b] = []
    spans[a] = mergeSpan(spans[a], spans[b])

    // Average linkage is reducible: a merged cluster is never closer to a third
    // cluster than the nearer of its parts was, so only rows whose cached best
    // was a or b can have changed.
    recompute(a)
    for (let c = 0; c < m; c++) {
      if (!active[c] || c === a) continue
      if (best[c] === a || best[c] === b) recompute(c)
    }
  }

  for (let a = 0; a < m; a++) {
    if (!active[a]) continue
    const ids = members[a].map((i) => group[i].id)
    const score = members[a].reduce((sum, i) => sum + group[i].weight, 0)
    result.push({ kind, digestId: null, memberIds: ids, score })
  }
  return result
}

/** What {@link selectClusters} decided for each cluster. */
export interface ClusterSelection<C extends Cluster = Cluster> {
  /** Qualified clusters within the run budget, best score first. */
  selected: C[]
  /** Qualified clusters past the budget — left for the next run, untouched. */
  deferred: C[]
  /** Clusters below the size floor; their never-considered rows get `consolidatedAt`. */
  belowMin: C[]
  /** Clusters with nothing new since every member was last considered — skipped silently. */
  stale: C[]
}

export interface SelectClustersOptions {
  minClusterSize: number
  matureAfterDays: number
  maxClusters: number
  nowMs: number
}

/**
 * The size floor for one cluster.
 *
 * The spec says `minClusterSize` drops to 2 "when any member is >
 * matureAfterDays old" — but only rows older than `matureAfterDays` are ever
 * candidates, so read literally the drop would always apply. We read it as
 * intended: a row that has sat a *further* full maturity window past
 * eligibility (older than 2 × `matureAfterDays`) without gathering a third
 * neighbour has had its chance, so a pair is enough for it.
 */
export function effectiveMinClusterSize(
  memberCreatedAtMs: readonly number[],
  opts: Pick<SelectClustersOptions, 'minClusterSize' | 'matureAfterDays' | 'nowMs'>,
): number {
  const floor = Math.max(2, Math.floor(opts.minClusterSize))
  const longAgoMs = opts.nowMs - 2 * opts.matureAfterDays * DAY_MS
  return memberCreatedAtMs.some((t) => t < longAgoMs) ? 2 : floor
}

/**
 * Whether a cluster carries anything new since its members were last
 * considered: a never-considered row, or a row written after another member
 * was last considered (a newer neighbour arrived — `consolidatedAt` compare).
 */
export function clusterHasNewMaterial(members: readonly ClusterItem[]): boolean {
  if (members.some((m) => m.consideredAtMs === null)) return true
  const considered = members.map((m) => m.consideredAtMs as number)
  const oldestConsidered = Math.min(...considered)
  return members.some((m) => m.createdAtMs > oldestConsidered)
}

/**
 * Apply the size floor, the "anything new?" check, and the per-run budget:
 * qualified clusters are ordered by total member `reinforcedImportance` and the
 * top `maxClusters` are selected.
 */
export function selectClusters<C extends Cluster>(
  clusters: readonly C[],
  itemsById: ReadonlyMap<string, ClusterItem>,
  opts: SelectClustersOptions,
): ClusterSelection<C> {
  const qualified: C[] = []
  const belowMin: C[] = []
  const stale: C[] = []

  for (const cluster of clusters) {
    const rows = cluster.memberIds
      .map((id) => itemsById.get(id))
      .filter((item): item is ClusterItem => item !== undefined)
    if (!clusterHasNewMaterial(rows)) {
      stale.push(cluster)
      continue
    }
    const size = rows.length + (cluster.digestId ? 1 : 0)
    const floor = effectiveMinClusterSize(rows.map((r) => r.createdAtMs), opts)
    if (size < floor) {
      belowMin.push(cluster)
      continue
    }
    qualified.push(cluster)
  }

  qualified.sort((a, b) => b.score - a.score)
  const budget = Math.max(0, Math.floor(opts.maxClusters))
  return {
    selected: qualified.slice(0, budget),
    deferred: qualified.slice(budget),
    belowMin,
    stale,
  }
}
