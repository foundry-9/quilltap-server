'use strict';

/**
 * `quilltap memories maintain` — run the memory maintenance job by hand:
 * fold near-duplicates → consolidate → demote → retire → mirror, any subset.
 *
 * The CLI's database access is read-only and cannot call a model, so this
 * resolves the character locally and asks the running server
 * (POST /api/v1/memories?action=maintain). A dry run is rehearsed in the
 * server process and prints what each phase would do; a real run is queued
 * as one MEMORY_MAINTENANCE background job per character.
 */

const { postMemoriesAction } = require('./memories-server');

// The phase names, the cap's bounds and maxClustersPerRun's bounds are the
// server's (lib/memory/maintenance/types.ts, lib/schemas/settings.types.ts).
// The CLI keeps no copy of them: the request goes as typed, and the server's
// 400 — whose details postMemoriesAction prints — says what it refused.

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function clip(text, n) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

function short(id) {
  return String(id || '').slice(0, 8);
}

function bucketLabel(bucket) {
  if (!bucket) return 'about no one';
  if (bucket.kind === 'self') return 'about self';
  if (bucket.kind === 'other') return `about ${bucket.subjectName}`;
  return 'about no one';
}

/**
 * Parse `--phases a,b,…` into a list (trimmed, duplicates dropped). Empty or
 * absent means "every phase" and returns null. The server checks the names
 * and always runs them in its own order.
 */
function parsePhases(value) {
  if (value == null || value === '') return null;
  const asked = [...new Set(String(value).split(',').map((p) => p.trim()).filter(Boolean))];
  return asked.length === 0 ? null : asked;
}

/**
 * Build the `?action=maintain` request body from parsed CLI flags.
 * `characterId` null means every character the user owns.
 */
function buildMaintainBody(characterId, flags) {
  const body = {};
  if (characterId) body.characterId = characterId;
  body.dryRun = flags.dryRun === true;
  const phases = parsePhases(flags.phases);
  if (phases) body.phases = phases;

  const settings = {};
  if (flags.max > 0) settings.maxClustersPerRun = flags.max;
  if (flags.threshold >= 0) settings.consolidation = { clusterThreshold: flags.threshold };
  if (flags.cap != null) settings.cap = flags.cap;
  if (Object.keys(settings).length > 0) body.settings = settings;
  return body;
}

// ---------- rendering ----------

/** Pretty-print a ConsolidationReport as cluster → members → digests. */
function renderConsolidation(report, write) {
  const stats = report.stats || {};
  if (report.skippedReason) {
    write(`  ${YELLOW}Skipped: ${report.skippedReason}${RESET}\n`);
    return;
  }
  const clusters = report.clusters || [];
  clusters.forEach((cluster, idx) => {
    write(`\n  ${BOLD}Cluster ${idx + 1}${RESET} ${DIM}(${bucketLabel(cluster.bucket)}, ${cluster.clusterKind}, ${cluster.status})${RESET}\n`);
    if (cluster.error) write(`    ${YELLOW}${cluster.error}${RESET}\n`);
    const standalone = new Set(cluster.keepStandalone || []);
    (cluster.memberIds || []).forEach((id, i) => {
      const tag = standalone.has(id) ? ` ${DIM}[kept standalone]${RESET}` : '';
      const content = (cluster.memberContents || [])[i];
      write(`    ${DIM}-${RESET} ${DIM}${short(id)}${RESET} ${clip(content, 160)}${tag}\n`);
    });
    for (const d of cluster.digests || []) {
      write(`    ${GREEN}=>${RESET} ${CYAN}${d.action === 'update' ? 'update digest' : 'new digest'}${RESET} ` +
        `${DIM}(imp ${Number(d.importance).toFixed(2)}, from ${(d.memberIds || []).length})${RESET}\n`);
      write(`       ${clip(d.content, 400)}\n`);
    }
    for (const c of cluster.contradictions || []) {
      write(`    ${YELLOW}contradiction${RESET}: ${clip(c.note, 200)} ${DIM}(${short(c.olderId)} -> ${short(c.newerId)})${RESET}\n`);
    }
  });
  if (clusters.length === 0) write('  (no clusters worth folding)\n');
  write(`  ${DIM}candidates ${stats.candidates ?? 0}, clusters found ${stats.clustersFound ?? 0}, ` +
    `attempted ${stats.clustersAttempted ?? 0}, deferred ${stats.clustersDeferred ?? 0}, ` +
    `${((stats.durationMs ?? 0) / 1000).toFixed(1)}s${stats.budgetExhausted ? ', time budget exhausted' : ''}${RESET}\n`);
}

function renderFold(fold, write) {
  write(`  eligible ${fold.eligible ?? 0}, groups ${(fold.groups || []).length}, folded ${fold.folded ?? 0}` +
    `${fold.deferred ? `, ${fold.deferred} rows deferred` : ''}` +
    `${fold.groupsDeferred ? `, ${fold.groupsDeferred} groups deferred` : ''}` +
    `${fold.groupsFailed ? `, ${YELLOW}${fold.groupsFailed} groups failed${RESET}` : ''}\n`);
  for (const g of fold.groups || []) {
    const absorbed = (g.absorbedIds || []).map(short).join(', ');
    write(`    ${short(g.survivorId)} ${GREEN}<=${RESET} ${absorbed} ${DIM}(min cosine ${Number(g.minCosine).toFixed(3)})${RESET}\n`);
  }
}

function renderDemote(d, write) {
  write(`  cap ${d.cap}, hot ${d.hotTotal} (demotable ${d.demotable}, exempt ${d.protected}), ` +
    `excess ${d.excess}, demoted ${d.demoted}` +
    `${d.highestScoreDemoted != null ? ` ${DIM}(highest score demoted ${Number(d.highestScoreDemoted).toFixed(3)})${RESET}` : ''}\n`);
}

function renderRetire(r, write) {
  write(`  retention ${r.retentionDays} days, retired ${r.retired}\n`);
}

function renderMirror(m, write) {
  const subjects = m.subjects || [];
  write(`  ${subjects.length} subject${subjects.length === 1 ? '' : 's'}${subjects.length ? `: ${subjects.join(', ')}` : ''}` +
    `, files written ${m.filesWritten ?? 0}${m.deferredToCommit ? ' (deferred to the parent commit)' : ''}\n`);
}

/** Pretty-print one character's MaintenanceReport: phase lines, then per-phase detail. */
function renderMaintenanceReport(report, write = (s) => process.stdout.write(s)) {
  const who = report.characterName || short(report.characterId);
  write(`${BOLD}Maintenance ${report.dryRun ? 'dry run' : 'report'}${RESET}${who ? ` for ${who}` : ''}\n`);
  if (report.skippedReason) {
    write(`${YELLOW}Skipped: ${report.skippedReason}${RESET}\n`);
    return;
  }
  for (const p of report.phases || []) {
    const status = p.status === 'ran' ? `${GREEN}ran${RESET}    ` : `${DIM}skipped${RESET}`;
    const why = p.skippedBecause ? ` ${DIM}(${p.skippedBecause})${RESET}` : '';
    write(`  ${p.phase.padEnd(22)} ${status}${why} ${DIM}${p.durationMs ?? 0}ms${RESET}\n`);
  }
  if (report.fold) { write(`\n${BOLD}Fold near-duplicates${RESET}\n`); renderFold(report.fold, write); }
  if (report.consolidation) { write(`\n${BOLD}Consolidate${RESET}\n`); renderConsolidation(report.consolidation, write); }
  if (report.demote) { write(`\n${BOLD}Demote${RESET}\n`); renderDemote(report.demote, write); }
  if (report.retire) { write(`\n${BOLD}Retire${RESET}\n`); renderRetire(report.retire, write); }
  if (report.mirror) { write(`\n${BOLD}Mirror${RESET}\n`); renderMirror(report.mirror, write); }
  if (report.durationMs != null) write(`\n${DIM}${(report.durationMs / 1000).toFixed(1)}s${RESET}\n`);
}

/** One table row per character for a user-wide dry run. */
function renderReportsTable(reports, write = (s) => process.stdout.write(s)) {
  const dash = '-';
  const rows = (reports || []).map((r) => {
    if (r.skippedReason) {
      return [r.characterName || short(r.characterId), `skipped: ${r.skippedReason}`, '', '', '', ''];
    }
    const ran = (r.phases || []).filter((p) => p.status === 'ran').map((p) => p.phase).join(',') || 'none';
    return [
      r.characterName || short(r.characterId),
      ran,
      r.fold ? `${(r.fold.groups || []).length}/${r.fold.folded ?? 0}` : dash,
      r.demote ? `${r.demote.demotable}/${r.demote.cap} -${r.demote.demoted}` : dash,
      r.retire ? String(r.retire.retired) : dash,
      r.mirror ? String((r.mirror.subjects || []).length) : dash,
    ];
  });
  const header = ['character', 'phases ran', 'fold grp/folded', 'demote demotable/cap -n', 'retire', 'mirror subj'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd() + '\n';
  write(`${BOLD}Maintenance dry run across ${rows.length} character${rows.length === 1 ? '' : 's'}${RESET}\n`);
  write(line(header));
  write(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) write(line(row));
  if (rows.length === 0) write('(no characters)\n');
}

// ---------- command ----------

/**
 * @param {object} flags parsed memories flags
 * @param {(flags: object) => Promise<string>} resolveCharacterId resolves --character to a UUID
 */
async function cmdMaintain(flags, resolveCharacterId) {
  if (!flags.character) {
    throw new Error("memories maintain requires --character <name|id|all> ('all' for every character).");
  }
  let characterId = null;
  if (flags.character !== 'all') {
    characterId = await resolveCharacterId(flags);
    if (!/^[0-9a-fA-F-]{36}$/.test(characterId)) {
      throw new Error(`could not resolve --character to a UUID (got "${characterId}").`);
    }
  }
  const body = buildMaintainBody(characterId, flags);

  const payload = await postMemoriesAction(flags, 'maintain', body, {
    why: 'Maintenance runs inside the server (the model, the embeddings and the only database writer live there).',
    announce: flags.json ? undefined : (url) => process.stderr.write(
      `${BOLD}${body.dryRun ? 'Rehearsing' : 'Queuing'} maintenance${RESET}` +
      `${body.phases ? ` [${body.phases.join(',')}]` : ''} via ${DIM}${url}${RESET}\n`
    ),
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  if (body.dryRun) {
    if (payload && payload.report) renderMaintenanceReport(payload.report);
    else renderReportsTable(payload && payload.reports);
    return;
  }

  const jobIds = (payload && payload.jobIds) || (payload && payload.jobId ? [payload.jobId] : []);
  if (jobIds.length === 0) {
    console.log('No maintenance jobs were queued (no characters to maintain).');
    return;
  }
  console.log(`Maintenance queued as ${jobIds.length} job${jobIds.length === 1 ? '' : 's'}:`);
  for (const id of jobIds) console.log(`  ${id}`);
  console.log("They run in the background; watch logs/combined.log or 'quilltap memories status'.");
}

module.exports = {
  cmdMaintain,
  parsePhases,
  buildMaintainBody,
  renderMaintenanceReport,
  renderReportsTable,
  renderConsolidation,
};
