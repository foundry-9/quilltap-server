'use strict';

// Shared graph-integrity scanner used by `memories status` (per-holder
// rollup) and `memories validate` (read-only dangling-edge check).
//
// `scanDanglingEdges` covers `relatedMemoryIds`; `scanDigestIntegrity`
// covers the consolidation links (`consolidatedFrom`, `supersededById`) and
// rows with no embedding — the same four things the server's graph repair
// (`POST /api/v1/memories?action=repair`) finds and fixes.
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
  const allIds = opts.allIds || loadMemoryIds(db);

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

/** Every memory id in the table — the universe a link may legitimately name. */
function loadMemoryIds(db) {
  const allIds = new Set();
  for (const row of db.prepare('SELECT id FROM memories').all()) {
    allIds.add(row.id);
  }
  return allIds;
}

/** The memories table's column names (old instances lack the tier-era columns). */
function memoryColumns(db) {
  try {
    return new Set(db.prepare("PRAGMA table_info('memories')").all().map((c) => c.name));
  } catch {
    return new Set();
  }
}

/**
 * Scan the consolidation links and embeddings for one holder (or every row).
 *
 * - dangling `consolidatedFrom`: member ids a digest names that no longer exist
 * - dangling `supersededById`: members pointing at a digest that is gone
 * - missing embeddings: rows with `embedding IS NULL` (not recallable by
 *   meaning until re-embedded; a warning, not graph damage)
 *
 * Columns absent on very old instances read as nothing to scan.
 *
 * @param {import('better-sqlite3').Database} db  Open readonly DB handle.
 * @param {object} [opts]
 * @param {string} [opts.characterId]  Restrict the scan to one holder.
 * @param {boolean} [opts.includePairs] Return the offending rows (for --list).
 * @param {Set<string>} [opts.allIds]  Reuse a precomputed id universe.
 * @returns {{
 *   consolidatedFrom: { links: number, digests: number },
 *   supersededBy: number,
 *   missingEmbeddings: number,
 *   consolidatedFromPairs?: Array<{ digestId: string, characterId: string, memberIds: string[] }>,
 *   supersededByPairs?: Array<{ memberId: string, characterId: string, digestId: string }>
 * }}
 */
function scanDigestIntegrity(db, opts = {}) {
  const { characterId, includePairs = false } = opts;
  const cols = opts.columns || memoryColumns(db);
  const allIds = opts.allIds || loadMemoryIds(db);
  const where = characterId ? ' AND characterId = ?' : '';
  const params = characterId ? [characterId] : [];

  const result = {
    consolidatedFrom: { links: 0, digests: 0 },
    supersededBy: 0,
    missingEmbeddings: 0,
  };
  if (includePairs) {
    result.consolidatedFromPairs = [];
    result.supersededByPairs = [];
  }

  if (cols.has('consolidatedFrom')) {
    const rows = db.prepare(
      `SELECT id, characterId, consolidatedFrom FROM memories
       WHERE consolidatedFrom IS NOT NULL AND consolidatedFrom != '[]'${where}`
    ).all(...params);
    for (const row of rows) {
      let arr;
      try { arr = JSON.parse(row.consolidatedFrom || '[]'); } catch { arr = []; }
      if (!Array.isArray(arr)) continue;
      const missing = arr.filter((id) => !allIds.has(id));
      if (missing.length === 0) continue;
      result.consolidatedFrom.links += missing.length;
      result.consolidatedFrom.digests++;
      if (includePairs) {
        result.consolidatedFromPairs.push({ digestId: row.id, characterId: row.characterId, memberIds: missing });
      }
    }
  }

  if (cols.has('supersededById')) {
    const rows = db.prepare(
      `SELECT id, characterId, supersededById FROM memories
       WHERE supersededById IS NOT NULL${where}`
    ).all(...params);
    for (const row of rows) {
      if (allIds.has(row.supersededById)) continue;
      result.supersededBy++;
      if (includePairs) {
        result.supersededByPairs.push({ memberId: row.id, characterId: row.characterId, digestId: row.supersededById });
      }
    }
  }

  if (cols.has('embedding')) {
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM memories WHERE embedding IS NULL${where}`
    ).get(...params);
    result.missingEmbeddings = row ? row.n || 0 : 0;
  }

  return result;
}

module.exports = { scanDanglingEdges, scanDigestIntegrity, loadMemoryIds, memoryColumns };
