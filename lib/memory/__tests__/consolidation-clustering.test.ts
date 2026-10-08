/**
 * Consolidation clustering (memory-consolidation-and-tiers.md §C3) — pure.
 */

import {
  clusterBucket,
  clusterHasNewMaterial,
  effectiveMinClusterSize,
  selectClusters,
  type Cluster,
  type ClusterItem,
} from '../consolidation-clustering'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-08T12:00:00.000Z')

/** Unit vector at `deg` degrees in the plane (cosine between two = cos of the angle). */
function at(deg: number): Float32Array {
  const r = (deg * Math.PI) / 180
  return new Float32Array([Math.cos(r), Math.sin(r), 0])
}

function item(id: string, embedding: Float32Array, overrides: Partial<ClusterItem> = {}): ClusterItem {
  return {
    id,
    embedding,
    kind: 'semantic',
    isDigest: false,
    eventTimeMs: NOW - 10 * DAY,
    createdAtMs: NOW - 10 * DAY,
    consideredAtMs: null,
    weight: 0.5,
    ...overrides,
  }
}

function sortedMembers(clusters: Cluster[]): string[][] {
  return clusters.map((c) => [...c.memberIds].sort()).sort((a, b) => a[0].localeCompare(b[0]))
}

describe('clusterBucket', () => {
  it('clusters rows at or above the threshold and leaves distant rows alone', () => {
    const clusters = clusterBucket(
      [item('a', at(0)), item('b', at(10)), item('c', at(90))],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    expect(sortedMembers(clusters)).toEqual([['a', 'b'], ['c']])
  })

  it('uses average linkage, not single linkage, to decide a merge', () => {
    // a–b and b–c are each cos 20° ≈ 0.94; a–c is cos 40° ≈ 0.77. Single
    // linkage would chain all three; the average of 0.94 and 0.77 is below 0.9.
    const clusters = clusterBucket(
      [item('a', at(0)), item('b', at(20)), item('c', at(40))],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    expect(clusters).toHaveLength(2)
    expect(clusters.map((c) => c.memberIds.length).sort()).toEqual([1, 2])
  })

  it('never grows a cluster past maxClusterSize', () => {
    const clusters = clusterBucket(
      ['a', 'b', 'c', 'd', 'e'].map((id) => item(id, at(0))),
      { threshold: 0.9, maxClusterSize: 2 },
    )
    expect(clusters.every((c) => c.memberIds.length <= 2)).toBe(true)
    expect(clusters.reduce((n, c) => n + c.memberIds.length, 0)).toBe(5)
  })

  it('lets a row whose best neighbour is an existing digest join that digest', () => {
    const clusters = clusterBucket(
      [
        item('digest', at(0), { isDigest: true, weight: 0.9 }),
        item('near-digest', at(3)), // best neighbour: the digest (cos 3°)
        item('x', at(60)),
        item('y', at(63)), // x and y pair with each other
      ],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    const digestCluster = clusters.find((c) => c.digestId === 'digest')
    expect(digestCluster?.memberIds).toEqual(['near-digest'])
    expect(digestCluster?.score).toBeCloseTo(1.4)
    expect(sortedMembers(clusters.filter((c) => !c.digestId))).toEqual([['x', 'y']])
  })

  it('leaves a row whose best neighbour is another row out of the digest cluster', () => {
    const clusters = clusterBucket(
      [
        item('digest', at(0), { isDigest: true }),
        item('r1', at(14)), // cos 14° to the digest ≈ 0.970
        item('r2', at(16)), // r1–r2 cos 2° ≈ 0.999 beats the digest
      ],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    expect(clusters.find((c) => c.digestId === 'digest')).toBeUndefined()
    expect(sortedMembers(clusters)).toEqual([['r1', 'r2']])
  })

  it('never merges two digests and caps digest clusters at maxClusterSize (digest counts as one)', () => {
    const clusters = clusterBucket(
      [
        item('d1', at(0), { isDigest: true }),
        item('d2', at(1), { isDigest: true }),
        item('r1', at(0.04)), // best neighbour d1
        item('r3', at(-0.05)), // best neighbour d1 too, but d1 is full at size 2
        item('r2', at(1.05)), // best neighbour d2
      ],
      { threshold: 0.9, maxClusterSize: 2 },
    )
    const byDigest = new Map(clusters.filter((c) => c.digestId).map((c) => [c.digestId, c.memberIds]))
    expect(byDigest.get('d1')).toEqual(['r1'])
    expect(byDigest.get('d2')).toEqual(['r2'])
    expect(clusters.find((c) => !c.digestId)?.memberIds).toEqual(['r3'])
    expect(clusters.some((c) => c.memberIds.includes('d1') || c.memberIds.includes('d2'))).toBe(false)
  })

  it('never mixes semantic and episodic rows', () => {
    const clusters = clusterBucket(
      [item('s', at(0)), item('e', at(0), { kind: 'episodic' })],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    expect(clusters).toHaveLength(2)
    expect(clusters.map((c) => c.kind).sort()).toEqual(['episodic', 'semantic'])
  })

  it('clusters episodic rows only within a one-day window', () => {
    const base = NOW - 20 * DAY
    const clusters = clusterBucket(
      [
        item('e1', at(0), { kind: 'episodic', eventTimeMs: base }),
        item('e2', at(1), { kind: 'episodic', eventTimeMs: base + 12 * 3_600_000 }),
        item('e3', at(2), { kind: 'episodic', eventTimeMs: base + 3 * DAY }),
      ],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    expect(sortedMembers(clusters)).toEqual([['e1', 'e2'], ['e3']])
  })

  it('keeps a whole episodic cluster inside one day, not just adjacent pairs', () => {
    const base = NOW - 20 * DAY
    const clusters = clusterBucket(
      [
        item('e1', at(0), { kind: 'episodic', eventTimeMs: base }),
        item('e2', at(0), { kind: 'episodic', eventTimeMs: base + 0.8 * DAY }),
        item('e3', at(0), { kind: 'episodic', eventTimeMs: base + 1.6 * DAY }),
      ],
      { threshold: 0.9, maxClusterSize: 30 },
    )
    expect(clusters.every((c) => c.memberIds.length <= 2)).toBe(true)
  })

  it('treats vectors of a different dimension as unrelated', () => {
    const clusters = clusterBucket(
      [item('a', at(0)), item('b', new Float32Array([1, 0]))],
      { threshold: 0.5, maxClusterSize: 30 },
    )
    expect(clusters).toHaveLength(2)
  })
})

describe('effectiveMinClusterSize', () => {
  const opts = { minClusterSize: 3, matureAfterDays: 7, nowMs: NOW }
  it('uses minClusterSize for members inside two maturity windows', () => {
    expect(effectiveMinClusterSize([NOW - 10 * DAY, NOW - 12 * DAY], opts)).toBe(3)
  })
  it('drops to 2 once any member is older than 2 × matureAfterDays', () => {
    expect(effectiveMinClusterSize([NOW - 10 * DAY, NOW - 15 * DAY], opts)).toBe(2)
  })
})

describe('clusterHasNewMaterial', () => {
  it('is true when any member was never considered', () => {
    expect(clusterHasNewMaterial([item('a', at(0), { consideredAtMs: NOW }), item('b', at(0))])).toBe(true)
  })
  it('is true when a member was written after another was last considered', () => {
    expect(
      clusterHasNewMaterial([
        item('a', at(0), { consideredAtMs: NOW - 5 * DAY, createdAtMs: NOW - 30 * DAY }),
        item('b', at(0), { consideredAtMs: NOW - DAY, createdAtMs: NOW - 3 * DAY }),
      ]),
    ).toBe(true)
  })
  it('is false when every member was considered after all of them existed', () => {
    expect(
      clusterHasNewMaterial([
        item('a', at(0), { consideredAtMs: NOW - DAY, createdAtMs: NOW - 30 * DAY }),
        item('b', at(0), { consideredAtMs: NOW - DAY, createdAtMs: NOW - 20 * DAY }),
      ]),
    ).toBe(false)
  })
})

describe('selectClusters', () => {
  const young = NOW - 9 * DAY
  const items = new Map<string, ClusterItem>(
    [
      item('a1', at(0), { createdAtMs: young, weight: 0.9 }),
      item('a2', at(0), { createdAtMs: young, weight: 0.9 }),
      item('a3', at(0), { createdAtMs: young, weight: 0.9 }),
      item('b1', at(0), { createdAtMs: young, weight: 0.4 }),
      item('b2', at(0), { createdAtMs: young, weight: 0.4 }),
      item('b3', at(0), { createdAtMs: young, weight: 0.4 }),
      item('p1', at(0), { createdAtMs: young }),
      item('p2', at(0), { createdAtMs: young }),
      item('o1', at(0), { createdAtMs: NOW - 40 * DAY }),
      item('o2', at(0), { createdAtMs: young }),
      item('s1', at(0), { consideredAtMs: NOW - DAY, createdAtMs: NOW - 40 * DAY }),
      item('s2', at(0), { consideredAtMs: NOW - DAY, createdAtMs: NOW - 40 * DAY }),
    ].map((i) => [i.id, i]),
  )
  const cluster = (ids: string[], score: number): Cluster => ({ kind: 'semantic', digestId: null, memberIds: ids, score })
  const clusters = [
    cluster(['b1', 'b2', 'b3'], 1.2),
    cluster(['a1', 'a2', 'a3'], 2.7),
    cluster(['p1', 'p2'], 1.0), // young pair: below the floor of 3
    cluster(['o1', 'o2'], 1.0), // an old member: the floor drops to 2
    cluster(['s1', 's2'], 1.0), // nothing new
  ]

  it('applies the floor, skips stale clusters, and orders by score within the budget', () => {
    const result = selectClusters(clusters, items, {
      minClusterSize: 3,
      matureAfterDays: 7,
      maxClusters: 2,
      nowMs: NOW,
    })
    expect(result.selected.map((c) => c.memberIds[0])).toEqual(['a1', 'b1'])
    expect(result.deferred.map((c) => c.memberIds[0])).toEqual(['o1'])
    expect(result.belowMin.map((c) => c.memberIds[0])).toEqual(['p1'])
    expect(result.stale.map((c) => c.memberIds[0])).toEqual(['s1'])
  })

  it('counts an existing digest toward the size floor', () => {
    const withDigest: Cluster = { kind: 'semantic', digestId: 'd', memberIds: ['p1', 'p2'], score: 1 }
    const result = selectClusters([withDigest], items, {
      minClusterSize: 3,
      matureAfterDays: 7,
      maxClusters: 5,
      nowMs: NOW,
    })
    expect(result.selected).toHaveLength(1)
  })
})
