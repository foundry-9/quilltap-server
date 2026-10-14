'use strict';

/**
 * `quilltap sync <store> <path>` — keep a database-backed document store and a
 * directory on disk in step with each other.
 *
 * This file is a thin client. Every decision the sync makes — which side wins,
 * what counts as a deletion, when to refuse — is made by the engine in the
 * server (`lib/mount-index/sync/`), and every flag is validated by the route's
 * own schema, which is the single source of truth. The CLI resolves the store
 * name to a UUID (the one thing it opens the database for, read-only), posts
 * the request, and prints what came back.
 *
 * The engine lives in the server rather than here because the sync writes
 * through the store's own chokepoints — `linkDocumentContent`, the folder-row
 * helper, the hard-link fan-out, the post-write re-chunk — and those are
 * TypeScript in `lib/`, unreachable from this plain-JS package. A direct
 * SQLite writer would be a second copy of all of them, and a lock-gated one
 * could not re-chunk at all. `docs write` on a database store already requires
 * the server for exactly this reason; `deconvert` already takes a server-local
 * target path. This is that shape, not a new one.
 *
 * `<path>` is therefore resolved on the SERVER. Running under Docker, it must
 * sit inside a bind mount — `quilltap docs docker-mounts` plans those.
 *
 * @module sync-command
 */

const path = require('path');
const os = require('os');
const {
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  loadDbKey,
  openMountIndexDb,
  UUID_RE,
} = require('./db-helpers');
const { isQtapUri, parseQtapUri } = require('./qtap-uri');
const { formatActionLines, formatSummary, exitCodeFor } = require('./sync-report');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';

function printSyncHelp() {
  console.log(`
Quilltap Document Store Sync

Usage: quilltap sync <store|qtap://store/> <path> [options]

Mirrors a database-backed document store and a directory on disk in both
directions. The two sides are compared by SHA-256 first and by modification
time second: equal bytes with unequal clocks are re-stamped, not re-copied.
Whichever side changed is copied to the other; when both changed since the
last run it is reported as a conflict and left alone.

The directory is created if it is missing. A document store is never created.

Options:
  --dry-run                 Plan and print; change nothing on either side
  --direction <which>       both (default), to-disk, or to-store
  --prefer <which>          newer (default), store, or disk — resolves conflicts
  --no-delete               Never propagate a deletion to the other side
  --no-manifest             Ignore .quilltap-sync.json (first-run rules every time)
  --json                    Machine-readable plan and results on stdout
  -p, --port <number>       Server port (default: 3000)
  -d, --data-dir <path>     Override data directory
  -i, --instance <name>     Use a registered instance
  --passphrase <pass>       Decrypt .dbkey if peppered
  -h, --help                Show this help

Exit codes: 0 clean, 1 an error or a failed action, 2 an unresolved conflict.
--dry-run uses the same codes, so a script can gate on a clean plan.

Files and folders whose names begin with a dot are INVISIBLE to the sync in
both directions — never copied, never deleted, on either side. The one
exception is .quilltap-sync.json, the record the verb keeps of what the last
run left; it lives in the directory and never enters the store.

A binary's description travels beside it as <file>.description.md. Editing
that file changes the caption in the store; deleting it clears the caption.
A text document's description is not synced.

The server must be running: a database-backed store's writes go through it,
as they already do for 'quilltap docs write'. <path> is resolved on the
server — under Docker it must sit inside a bind mount (see
'quilltap docs docker-mounts').

Examples:
  quilltap sync Lore ~/Documents/lore --dry-run
  quilltap sync Lore ~/Documents/lore
  quilltap sync Lore ~/Documents/lore --prefer disk
  quilltap sync qtap://Lore/ ~/Documents/lore --direction to-disk
`);
}

function parseFlags(args) {
  const flags = {
    dataDir: '',
    instance: '',
    passphrase: '',
    port: 3000,
    json: false,
    dryRun: false,
    direction: 'both',
    prefer: 'newer',
    noDelete: false,
    noManifest: false,
    help: false,
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-d': case '--data-dir':    flags.dataDir = args[++i] || ''; break;
      case '-i': case '--instance':    flags.instance = args[++i] || ''; break;
      case '--passphrase':             flags.passphrase = args[++i] || ''; break;
      case '-p': case '--port':        flags.port = parseInt(args[++i], 10) || 3000; break;
      case '--json':                   flags.json = true; break;
      case '--dry-run':                flags.dryRun = true; break;
      case '--direction':              flags.direction = args[++i] || ''; break;
      case '--prefer':                 flags.prefer = args[++i] || ''; break;
      case '--no-delete':              flags.noDelete = true; break;
      case '--no-manifest':            flags.noManifest = true; break;
      case '-h': case '--help':        flags.help = true; break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }
  return { flags, positional };
}

/** `~/x` → an absolute path. The server sees only what we send it. */
function expandPath(input) {
  let expanded = input;
  if (expanded === '~') expanded = os.homedir();
  else if (expanded.startsWith('~/')) expanded = path.join(os.homedir(), expanded.slice(2));
  return path.resolve(expanded);
}

/**
 * A store name or UUID, or a `qtap://store/` URI with an empty path. This is
 * the only thing the verb opens the database for, and it opens it read-only.
 */
function resolveStoreSpec(spec) {
  if (!isQtapUri(spec)) return spec;
  const parsed = parseQtapUri(spec);
  if (parsed.scope !== 'document_store') {
    throw new Error(
      'sync addresses document stores only; qtap://project/… and qtap://general/… are not CLI-addressable.'
    );
  }
  if (parsed.path) {
    throw new Error(`sync takes a whole store, not a path inside one: ${spec}`);
  }
  if (!parsed.mountPoint || parsed.mountPoint.toLowerCase() === 'self') {
    throw new Error('"self" requires a character context and is not resolvable from the CLI.');
  }
  return parsed.mountPoint;
}

/** Name-first, UUID fallback — the same resolution the `docs` verbs use. */
function requireMount(db, spec) {
  if (UUID_RE.test(spec)) {
    const row = db.prepare('SELECT * FROM doc_mount_points WHERE id = ?').get(spec);
    if (!row) {
      console.error(`No document store found with id ${spec}`);
      process.exit(1);
    }
    return row;
  }
  const rows = db.prepare(
    `SELECT * FROM doc_mount_points WHERE LOWER(name) = LOWER(?) ORDER BY name COLLATE NOCASE`
  ).all(spec);
  if (rows.length === 0) {
    console.error(`No document store found with name "${spec}"`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`Ambiguous store name "${spec}" matches multiple stores:`);
    for (const r of rows) console.error(`  ${r.id}  ${r.name}  (${r.mountType})`);
    console.error('Pass the UUID instead.');
    process.exit(1);
  }
  return rows[0];
}

function isConnectionRefused(err) {
  if (!err) return false;
  const code = err.cause && err.cause.code ? err.cause.code : err.code;
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' ||
         code === 'EHOSTUNREACH' || code === 'ECONNRESET';
}

async function syncCommand(args) {
  const { flags, positional } = parseFlags(args);
  if (flags.help || positional.length === 0) {
    printSyncHelp();
    process.exit(flags.help ? 0 : 1);
  }

  const [storeSpec, targetSpec] = positional;
  if (!targetSpec) {
    console.error('Usage: quilltap sync <store> <path> [options]');
    console.error("Run 'quilltap sync --help' for the full list of options.");
    process.exit(1);
  }
  if (positional.length > 2) {
    console.error(`sync takes one store and one path; got ${positional.length} arguments.`);
    process.exit(1);
  }

  let storeName;
  try {
    storeName = resolveStoreSpec(storeSpec);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const targetPath = expandPath(targetSpec);

  // Resolve the store from the local database — read-only, and the only thing
  // the CLI opens it for.
  const resolved = resolveDataDirAndPassphrase({
    dataDir: flags.dataDir,
    instance: flags.instance,
    passphrase: flags.passphrase,
  });
  printDefaultInstanceHint(resolved);
  const pepper = await loadDbKey(resolved.dataDir, resolved.passphrase);
  const db = openMountIndexDb(resolved.dataDir, pepper, { readonly: true });
  let mount;
  try {
    mount = requireMount(db, storeName);
  } finally {
    db.close();
  }

  if (mount.mountType !== 'database') {
    console.error(
      `"${mount.name}" is a ${mount.mountType} store — it already IS a directory` +
      (mount.basePath ? ` (${mount.basePath})` : '') + '.'
    );
    console.error('sync mirrors database-backed stores only.');
    process.exit(1);
  }

  const url =
    `http://localhost:${flags.port}/api/v1/mount-points/${encodeURIComponent(mount.id)}?action=sync`;

  // The route's schema is the single source of truth for these; the CLI does
  // not re-validate, so a bad --direction is refused by the server with the
  // server's own wording.
  const body = {
    targetPath,
    dryRun: flags.dryRun,
    direction: flags.direction,
    prefer: flags.prefer,
    propagateDeletes: !flags.noDelete,
    useManifest: !flags.noManifest,
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (isConnectionRefused(err)) {
      console.error(
        `Cannot sync database-backed store "${mount.name}" without the Quilltap server.`
      );
      console.error('Start the server (`quilltap`) or pass --port to match a non-default port.');
      process.exit(1);
    }
    throw err;
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    console.error(`Error: ${message}`);
    process.exit(1);
  }

  const report = payload && payload.data !== undefined ? payload.data : payload;

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(exitCodeFor(report.summary));
  }

  const colour = Boolean(process.stdout.isTTY);
  for (const line of formatActionLines(report.actions, colour)) {
    console.log(line);
  }

  // Advisory text goes to stderr so stdout stays greppable.
  for (const warning of report.warnings || []) {
    console.error(colour ? `${YELLOW}warning:${RESET} ${warning}` : `warning: ${warning}`);
  }
  const summary = formatSummary(report.summary, report.elapsedMs, report.dryRun);
  console.error(colour ? `${DIM}${summary}${RESET}` : summary);
  if (report.summary.conflicts > 0) {
    console.error(
      colour
        ? `${DIM}Re-run with --prefer store or --prefer disk to resolve the conflicts.${RESET}`
        : 'Re-run with --prefer store or --prefer disk to resolve the conflicts.'
    );
  }

  process.exit(exitCodeFor(report.summary));
}

module.exports = { syncCommand, printSyncHelp, expandPath, resolveStoreSpec };
