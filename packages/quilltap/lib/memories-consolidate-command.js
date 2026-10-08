'use strict';

/**
 * `quilltap memories consolidate` — fold clusters of hot memories into
 * digests. The CLI's database access is read-only and cannot call a model, so
 * this resolves the character locally and then asks the running server
 * (POST /api/v1/memories?action=consolidate). A dry run is rehearsed in the
 * server process and prints the proposed digests; a real run is queued as a
 * background job.
 */

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

function bucketLabel(bucket) {
  if (bucket.kind === 'self') return 'about self';
  if (bucket.kind === 'other') return `about ${bucket.subjectName}`;
  return 'about no one';
}

/** Pretty-print a ConsolidationReport as cluster → members → digests. */
function renderReport(report, write = (s) => process.stdout.write(s)) {
  const stats = report.stats || {};
  write(`${BOLD}Consolidation ${report.dryRun ? 'dry run' : 'report'}${RESET}` +
    `${report.characterName ? ` for ${report.characterName}` : ''}\n`);
  if (report.skippedReason) {
    write(`${YELLOW}Skipped: ${report.skippedReason}${RESET}\n`);
    return;
  }
  const clusters = report.clusters || [];
  clusters.forEach((cluster, idx) => {
    write(`\n${BOLD}Cluster ${idx + 1}${RESET} ${DIM}(${bucketLabel(cluster.bucket)}, ${cluster.clusterKind}, ${cluster.status})${RESET}\n`);
    if (cluster.error) write(`  ${YELLOW}${cluster.error}${RESET}\n`);
    const standalone = new Set(cluster.keepStandalone || []);
    (cluster.memberIds || []).forEach((id, i) => {
      const tag = standalone.has(id) ? ` ${DIM}[kept standalone]${RESET}` : '';
      write(`  ${DIM}-${RESET} ${DIM}${String(id).slice(0, 8)}${RESET} ${clip(cluster.memberContents[i], 160)}${tag}\n`);
    });
    for (const d of cluster.digests || []) {
      write(`  ${GREEN}=>${RESET} ${CYAN}${d.action === 'update' ? 'update digest' : 'new digest'}${RESET} ` +
        `${DIM}(imp ${Number(d.importance).toFixed(2)}, from ${(d.memberIds || []).length})${RESET}\n`);
      write(`     ${clip(d.content, 400)}\n`);
    }
    for (const c of cluster.contradictions || []) {
      write(`  ${YELLOW}contradiction${RESET}: ${clip(c.note, 200)} ${DIM}(${String(c.olderId).slice(0, 8)} -> ${String(c.newerId).slice(0, 8)})${RESET}\n`);
    }
  });
  if (clusters.length === 0) write('\n(no clusters worth folding)\n');
  write(`\n${DIM}candidates ${stats.candidates ?? 0}, clusters found ${stats.clustersFound ?? 0}, ` +
    `attempted ${stats.clustersAttempted ?? 0}, deferred ${stats.clustersDeferred ?? 0}, ` +
    `${((stats.durationMs ?? 0) / 1000).toFixed(1)}s${stats.budgetExhausted ? ', time budget exhausted' : ''}${RESET}\n`);
}

/** Build the request body for the consolidate action from parsed CLI flags. */
function buildConsolidateBody(characterId, flags) {
  const body = { characterId, dryRun: flags.dryRun === true };
  if (flags.max > 0) body.maxClustersPerRun = flags.max;
  if (flags.threshold >= 0) body.clusterThreshold = flags.threshold;
  return body;
}

/**
 * @param {object} flags parsed memories flags
 * @param {(flags: object) => Promise<string>} resolveCharacterId resolves --character to a UUID
 */
async function cmdConsolidate(flags, resolveCharacterId) {
  if (!flags.character || flags.character === 'all') {
    console.error('Error: memories consolidate requires --character <name|id>.');
    process.exit(1);
  }
  const characterId = await resolveCharacterId(flags);
  if (!/^[0-9a-fA-F-]{36}$/.test(characterId)) {
    console.error(`Error: could not resolve --character to a UUID (got "${characterId}").`);
    process.exit(1);
  }

  const port = flags.port || 3000;
  const url = `http://localhost:${port}/api/v1/memories?action=consolidate`;
  const body = buildConsolidateBody(characterId, flags);

  if (!flags.json) {
    process.stderr.write(`${BOLD}${body.dryRun ? 'Rehearsing' : 'Queuing'} consolidation${RESET} via ${DIM}${url}${RESET}\n`);
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`Could not reach Quilltap server at http://localhost:${port}: ${err.message}`);
    console.error('Consolidation requires the running server (the model and embeddings live there).');
    console.error('Start it with: npm run dev');
    process.exit(1);
  }

  let payload = null;
  try {
    const text = await res.text();
    payload = text ? JSON.parse(text) : null;
  } catch { /* leave payload null */ }

  if (!res.ok) {
    console.error(`Error: ${(payload && payload.error) || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  if (body.dryRun) {
    renderReport(payload.report);
  } else {
    console.log(`Consolidation queued as job ${payload.jobId}. It runs in the background; watch logs/combined.log.`);
  }
}

module.exports = { cmdConsolidate, renderReport, buildConsolidateBody };
