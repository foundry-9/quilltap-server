'use strict';

/**
 * `quilltap anchor-probe <characterId>` — measure whether the episodic anchor
 * line embedded with each memory suppresses Memory Gate reinforcement.
 *
 * Thin wrapper over POST /api/v1/memories?action=anchor-gate-probe.
 * Read-only; nothing is persisted server-side, but it costs embedding calls.
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function printAnchorProbeHelp() {
  console.log(`
Quilltap anchor-probe Tool

Usage: quilltap anchor-probe <characterId> [options]

Measures whether the episodic anchor line embedded with each memory suppresses
Memory Gate reinforcement. Re-embeds the character's most recent memories with
and without the anchor line, compares each against older rows, and reports how
many would cross the reinforce (0.85) and near-duplicate (0.90) thresholds
each way.

Read-only, but it costs embedding calls (roughly up to 7 per sampled row).

Options:
      --limit <number>       Recent memories to sample (default: 50, max: 200)
      --port <number>        Server port for API calls (default: 3000)
      --json                 Print the raw JSON result instead of tables
  -h, --help                 Show this help

Examples:
  quilltap anchor-probe <characterId>
  quilltap anchor-probe <characterId> --limit 20
  quilltap anchor-probe <characterId> --json > probe.json
`);
}

function parseFlags(args) {
  const flags = { limit: undefined, port: 3000, json: false, help: false };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '--limit': {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 1 || n > 200) {
          console.error('Error: --limit must be between 1 and 200');
          process.exit(1);
        }
        flags.limit = n;
        break;
      }
      case '--port': {
        const p = parseInt(args[++i], 10);
        if (isNaN(p) || p < 1 || p > 65535) {
          console.error('Error: --port must be between 1 and 65535');
          process.exit(1);
        }
        flags.port = p;
        break;
      }
      case '--json':
        flags.json = true;
        break;
      case '-h':
      case '--help':
        flags.help = true;
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`Unknown option: ${a}`);
          process.exit(1);
        }
        positional.push(a);
    }
    i++;
  }
  return { flags, positional };
}

function fmt(n, digits = 3) {
  if (n === null || n === undefined) return DIM + '—' + RESET;
  return n.toFixed(digits);
}

// Pad a possibly colour-wrapped string to a visible width.
function pad(s, width) {
  const visible = String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
  return String(s) + ' '.repeat(Math.max(0, width - visible));
}

function printRows(rows, thresholds) {
  console.log(`\n${BOLD}Rows${RESET} (${rows.length})`);
  if (rows.length === 0) {
    console.log(`  ${DIM}(none)${RESET}`);
    return;
  }
  console.log(
    `  ${DIM}${'anchored'.padEnd(10)}${'free'.padEnd(10)}${'delta'.padEnd(9)}${'anchor'.padEnd(8)}summary${RESET}`
  );
  const reinforce = thresholds?.reinforce ?? 0.85;
  for (const row of rows) {
    const a = row.anchoredBest;
    const f = row.anchorFreeBest;
    const delta = typeof a === 'number' && typeof f === 'number' ? f - a : null;
    const onlyFree = typeof f === 'number' && f >= reinforce && !(typeof a === 'number' && a >= reinforce);
    const deltaStr = delta === null ? DIM + '—' + RESET : (delta >= 0 ? '+' : '') + delta.toFixed(3);
    const anchorStr = row.hasAnchorLine ? 'yes' : `${DIM}no${RESET}`;
    const summary = (row.summary || '').replace(/\s+/g, ' ').slice(0, 60);
    const line = `${pad(fmt(a), 10)}${pad(fmt(f), 10)}${pad(deltaStr, 9)}${pad(anchorStr, 8)}${summary}`;
    console.log(onlyFree ? `${YELLOW}▸ ${RESET}${line}` : `  ${line}`);
  }
  console.log(`\n  ${YELLOW}▸${RESET} ${DIM}= crosses ${reinforce} only without the anchor line${RESET}`);
}

async function anchorProbeCommand(args) {
  const { flags, positional } = parseFlags(args);

  if (flags.help || positional.length === 0) {
    printAnchorProbeHelp();
    process.exit(flags.help ? 0 : 1);
  }
  if (positional.length > 1) {
    console.error('Error: only one characterId may be specified');
    process.exit(1);
  }
  const characterId = positional[0];

  const url = `http://localhost:${flags.port}/api/v1/memories?action=anchor-gate-probe`;
  const body = { characterId };
  if (flags.limit !== undefined) body.limit = flags.limit;

  process.stderr.write(`${BOLD}Probing anchor gate${RESET} for character ${DIM}${characterId}${RESET} via ${DIM}${url}${RESET}\n`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`${RED}Could not reach Quilltap server at http://localhost:${flags.port}: ${err.message}${RESET}`);
    console.error('Start the server (npm run dev) or pass --port to match a non-default port.');
    process.exit(1);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    console.error(`${RED}Server returned a non-JSON response (status ${res.status})${RESET}`);
    process.exit(1);
  }
  if (!res.ok || payload?.success === false) {
    console.error(`${RED}Probe failed (status ${res.status}): ${payload?.error || payload?.message || 'unknown error'}${RESET}`);
    process.exit(1);
  }

  const result = payload.data ?? payload;
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const t = result.thresholds || {};
  const anchored = result.anchored || {};
  const free = result.anchorFree || {};
  console.log(`\n${BOLD}Character${RESET}  ${result.characterId}`);
  console.log(`${BOLD}Sampled${RESET}    ${result.sampled} rows, ${result.anchoredRows} with an anchor line`);
  console.log(`${BOLD}Embeddings${RESET} ${result.embeddingsGenerated} generated`);
  console.log(`\n${DIM}${''.padEnd(22)}${'anchored'.padEnd(11)}anchor-free${RESET}`);
  console.log(`${BOLD}${('reinforce ≥ ' + fmt(t.reinforce, 2)).padEnd(22)}${RESET}${String(anchored.reinforce).padEnd(11)}${CYAN}${free.reinforce}${RESET}`);
  console.log(`${BOLD}${('near-dup ≥ ' + fmt(t.nearDuplicate, 2)).padEnd(22)}${RESET}${String(anchored.nearDuplicate).padEnd(11)}${CYAN}${free.nearDuplicate}${RESET}`);
  const only = result.crossedOnlyWithoutAnchors;
  console.log(`${BOLD}Crossed only without anchors${RESET}  ${only > 0 ? YELLOW : GREEN}${only}${RESET}`);

  printRows(result.rows || [], t);
  console.log('');
}

module.exports = { anchorProbeCommand, printAnchorProbeHelp };
