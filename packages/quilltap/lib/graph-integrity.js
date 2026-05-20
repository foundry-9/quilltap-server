'use strict';

// Shared graph-integrity scanner used by `memories status` (per-holder
// rollup) and `memories validate` (read-only dangling-edge check).
//
// "Dangling edges" are UUIDs in `memories.relatedMemoryIds` that no longer
// resolve to a row in the `memories` table. Cross-character links are
// legitimate — a memory's links may point at memories owned by other holders
// — so the universe of valid IDs is *every* row, not just the holder's.

/**
 * Scan dangling edges across the memories table.
 *
 * @param {import('better-sqlite3').Database} db  Open readonly DB handle.
 * @param {object} [opts]
 * @param {string} [opts.characterId]  Restrict the scan to one holder.
 *                                     When omitted, scans every memory.
 * @param {boolean} [opts.includePairs] Return the per-source list of
 *                                      dangling target IDs (for --list).
 * @returns {{
 *   nodes: number,
 *   withLinks: number,
 *   isolated: number,
 *   totalEdges: number,
 *   avgDegree: number,
 *   maxDegree: number,
 *   danglingEdges: number,
 *   danglingPairs?: Array<{ sourceId: string, characterId: string, targetIds: string[] }>
 * }}
 */
function scanDanglingEdges(db, opts = {}) {
  const { characterId, includePairs = false } = opts;

  // The valid set is *every* memory ID in the table. Computed once even
  // when restricted to a single holder, because cross-character links are
  // legitimate and we don't want them counted as dangling.
  const allIds = new Set();
  for (const row of db.prepare('SELECT id FROM memories').all()) {
    allIds.add(row.id);
  }

  const scanRows = characterId
    ? db.prepare('SELECT id, characterId, relatedMemoryIds FROM memories WHERE characterId = ?').all(characterId)
    : db.prepare('SELECT id, characterId, relatedMemoryIds FROM memories').all();

  let withLinks = 0;
  let isolated = 0;
  let totalEdges = 0;
  let maxDegree = 0;
  let danglingEdges = 0;
  const danglingPairs = includePairs ? [] : undefined;

  for (const row of scanRows) {
    let arr;
    try {
      arr = JSON.parse(row.relatedMemoryIds || '[]');
    } catch {
      arr = [];
    }
    if (!Array.isArray(arr)) arr = [];

    if (arr.length === 0) {
      isolated++;
      continue;
    }

    withLinks++;
    totalEdges += arr.length;
    if (arr.length > maxDegree) maxDegree = arr.length;

    const danglingTargets = includePairs ? [] : null;
    for (const linkedId of arr) {
      if (!allIds.has(linkedId)) {
        danglingEdges++;
        if (danglingTargets) danglingTargets.push(linkedId);
      }
    }
    if (includePairs && danglingTargets && danglingTargets.length > 0) {
      danglingPairs.push({
        sourceId: row.id,
        characterId: row.characterId,
        targetIds: danglingTargets,
      });
    }
  }

  const nodes = scanRows.length;
  const avgDegree = withLinks > 0 ? totalEdges / withLinks : 0;

  const result = {
    nodes,
    withLinks,
    isolated,
    totalEdges,
    avgDegree: Number(avgDegree.toFixed(2)),
    maxDegree,
    danglingEdges,
  };
  if (includePairs) {
    result.danglingPairs = danglingPairs;
  }
  return result;
}

module.exports = { scanDanglingEdges };
