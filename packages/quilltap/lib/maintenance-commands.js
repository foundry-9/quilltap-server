'use strict';

/**
 * `quilltap maintenance` — manual trigger for the retention & cleanup sweeps
 * that otherwise run on the server's daily maintenance tick
 * (`lib/background-jobs/scheduled-maintenance.ts`).
 *
 * The CLI is plain Node — it cannot import the TypeScript `runScheduledMaintenance()`
 * and it speaks raw SQL to the encrypted databases. `maintenance run` is a DB
 * writer and is lock-gated: it claims `<dataDir>/quilltap.lock` and REFUSES
 * while a running server (or another writer) holds it, so it only ever touches
 * the database when the server is down. Because it can't reach the server, it
 * performs only the sweeps expressible as faithful direct SQL/fs:
 *   - finished background jobs (COMPLETED short window, DEAD longer window),
 *   - closed terminal sessions + their transcript files,
 *   - the orphaned-mount-index-file sweep.
 *
 * The stale-chat ASSET COLLAPSE is intentionally NOT performed here: it needs
 * the app's file-storage manager / `deleteWithGC` machinery (mount-blob →
 * link → byte GC), which lives in the server process. That sweep runs only on
 * the server's daily tick. `maintenance status` reports a stale-chat count so
 * you can see the backlog, but it does not estimate the per-asset reap.
 *
 * Retention windows below MIRROR the TypeScript source of truth at
 * `lib/background-jobs/maintenance/retention-constants.ts`. Keep them in sync.
 */

const fs = require('fs');
const path = require('path');
const {
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  openMainDb,
  openMountIndexDb,
  loadDbKey,
} = require('./db-helpers');
const { acquireWriteLock, releaseWriteLock } = require('./lock-helpers');

// Mirror of lib/background-jobs/maintenance/retention-constants.ts
const COMPLETED_JOB_RETENTION_DAYS = 7;
const DEAD_JOB_RETENTION_DAYS = 30;
const STALE_CHAT_RETENTION_DAYS = 30;
const CLOSED_TERMINAL_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const LAST_SWEEP_KEY = 'lastMaintenanceSweepAt';

function cutoffIso(days, now = Date.now()) {
  return new Date(now - days * DAY_MS).toISOString();
}

// ---------- argument parsing ----------

function parseFlags(args) {
  const flags = {
    dataDir: '',
    instance: '',
    passphrase: '',
    json: false,
    help: false,
  };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-d': case '--data-dir': flags.dataDir = args[++i]; break;
      case '-i': case '--instance': flags.instance = args[++i]; break;
      case '--passphrase': flags.passphrase = args[++i]; break;
      case '--json': flags.json = true; break;
      case '-h': case '--help': flags.help = true; break;
      default:
        if (!a.startsWith('-')) positional.push(a);
        else console.error(`unknown flag: ${a}`);
        break;
    }
    i++;
  }
  return { flags, positional };
}

function printHelp() {
  console.log(`Usage: quilltap maintenance <command> [options]

Commands:
  run                       Run the cleanup sweeps once (lock-gated; refuses
                            while the server holds the lock). Reaps finished
                            background jobs, closed terminal sessions + their
                            transcripts, and orphaned mount-index files.
  status                    Read-only: show the last sweep time and a dry-run
                            count of what would be reaped.

Note: the stale-chat asset collapse (superseded story-backgrounds & avatars)
runs only on the server's daily tick, not from this CLI.

Options:
  -d, --data-dir <path>     Use a specific data directory (instance root)
  -i, --instance <name>     Use a named instance
  --passphrase <pass>       Provide passphrase (prompts if needed)
  --json                    Output as JSON
  -h, --help                Show this help message

Examples:
  quilltap maintenance status
  quilltap maintenance status --instance Friday --json
  quilltap maintenance run --instance Friday
`);
}

// ---------- shared plumbing ----------

async function resolveAndKey(flags) {
  const resolved = resolveDataDirAndPassphrase(flags);
  printDefaultInstanceHint(resolved);
  const pepper = await loadDbKey(resolved.dataDir, resolved.passphrase);
  return { resolved, pepper };
}

function readLastSweep(mainDb) {
  try {
    const row = mainDb
      .prepare('SELECT "value" FROM "instance_settings" WHERE "key" = ?')
      .get(LAST_SWEEP_KEY);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

function countOrphanedFiles(dataDir, pepper) {
  try {
    const mounts = openMountIndexDb(dataDir, pepper, { readonly: true });
    try {
      const row = mounts
        .prepare(
          'SELECT COUNT(*) AS n FROM doc_mount_files ' +
            'WHERE id NOT IN (SELECT DISTINCT fileId FROM doc_mount_file_links)'
        )
        .get();
      return row ? row.n : 0;
    } finally {
      mounts.close();
    }
  } catch {
    // Mount-index DB absent on this instance — nothing to count.
    return null;
  }
}

// ---------- command handlers ----------

async function handleStatus(flags) {
  let resolved;
  let pepper;
  let mainDb;
  try {
    ({ resolved, pepper } = await resolveAndKey(flags));
    mainDb = openMainDb(resolved.dataDir, pepper, { readonly: true });
  } catch (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }

  const now = Date.now();
  const completedCutoff = cutoffIso(COMPLETED_JOB_RETENTION_DAYS, now);
  const deadCutoff = cutoffIso(DEAD_JOB_RETENTION_DAYS, now);
  const terminalCutoff = cutoffIso(CLOSED_TERMINAL_RETENTION_DAYS, now);
  const staleCutoff = cutoffIso(STALE_CHAT_RETENTION_DAYS, now);

  const reapableCompleted = mainDb
    .prepare(
      "SELECT COUNT(*) AS n FROM background_jobs " +
        "WHERE status = 'COMPLETED' AND completedAt IS NOT NULL AND completedAt < ?"
    )
    .get(completedCutoff).n;
  const reapableDead = mainDb
    .prepare(
      "SELECT COUNT(*) AS n FROM background_jobs " +
        "WHERE status = 'DEAD' AND completedAt IS NOT NULL AND completedAt < ?"
    )
    .get(deadCutoff).n;
  const closedTerminals = mainDb
    .prepare(
      'SELECT COUNT(*) AS n FROM terminal_sessions ' +
        'WHERE exitedAt IS NOT NULL AND exitedAt < ?'
    )
    .get(terminalCutoff).n;
  const staleChats = mainDb
    .prepare(
      'SELECT COUNT(*) AS n FROM chats WHERE COALESCE(lastMessageAt, updatedAt) < ?'
    )
    .get(staleCutoff).n;

  const lastSweep = readLastSweep(mainDb);
  mainDb.close();

  const orphanedFiles = countOrphanedFiles(resolved.dataDir, pepper);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          lastMaintenanceSweepAt: lastSweep,
          reapableJobs: { completed: reapableCompleted, dead: reapableDead },
          closedTerminalSessions: closedTerminals,
          orphanedMountIndexFiles: orphanedFiles,
          staleChats,
          note:
            'Stale-chat asset collapse runs on the server tick, not the CLI. ' +
            'staleChats is informational.',
        },
        null,
        2
      )
    );
  } else {
    console.log(`Last maintenance sweep:        ${lastSweep || '(never)'}`);
    console.log(`Reapable COMPLETED jobs:       ${reapableCompleted}  (older than ${COMPLETED_JOB_RETENTION_DAYS}d)`);
    console.log(`Reapable DEAD jobs:            ${reapableDead}  (older than ${DEAD_JOB_RETENTION_DAYS}d)`);
    console.log(`Closed terminal sessions:      ${closedTerminals}  (older than ${CLOSED_TERMINAL_RETENTION_DAYS}d)`);
    console.log(
      `Orphaned mount-index files:    ${orphanedFiles === null ? '(no mount-index db)' : orphanedFiles}`
    );
    console.log(`Stale chats:                   ${staleChats}  (no activity for ${STALE_CHAT_RETENTION_DAYS}d)`);
    console.log('');
    console.log('Note: the stale-chat asset collapse runs on the server\'s daily tick,');
    console.log('not from this CLI. `maintenance run` reaps jobs, terminals, and orphans.');
  }
}

async function handleRun(flags) {
  let resolved;
  let pepper;
  try {
    ({ resolved, pepper } = await resolveAndKey(flags));
  } catch (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }

  // Lock-gated: refuse while a running server (or another writer) holds it.
  try {
    acquireWriteLock(resolved.dataDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const summary = {
    completedJobs: 0,
    deadJobs: 0,
    terminalRows: 0,
    terminalTranscripts: 0,
    orphanedFiles: 0,
  };

  let mainDb;
  let mountsDb;
  try {
    mainDb = openMainDb(resolved.dataDir, pepper, { readonly: false });

    const now = Date.now();
    const completedCutoff = cutoffIso(COMPLETED_JOB_RETENTION_DAYS, now);
    const deadCutoff = cutoffIso(DEAD_JOB_RETENTION_DAYS, now);
    const terminalCutoff = cutoffIso(CLOSED_TERMINAL_RETENTION_DAYS, now);

    // 1. Finished background jobs.
    const jobTx = mainDb.transaction(() => {
      const completed = mainDb
        .prepare(
          "DELETE FROM background_jobs " +
            "WHERE status = 'COMPLETED' AND completedAt IS NOT NULL AND completedAt < ?"
        )
        .run(completedCutoff).changes;
      const dead = mainDb
        .prepare(
          "DELETE FROM background_jobs " +
            "WHERE status = 'DEAD' AND completedAt IS NOT NULL AND completedAt < ?"
        )
        .run(deadCutoff).changes;
      return { completed, dead };
    });
    const jobRes = jobTx();
    summary.completedJobs = jobRes.completed;
    summary.deadJobs = jobRes.dead;

    // 2. Closed terminal sessions + transcript files. Never select a session
    //    still running (exitedAt IS NULL). Transcripts live under
    //    <instanceRoot>/logs/terminals/<id>.log (data dir's sibling).
    const logsTerminalsDir = path.join(resolved.dataDir, '..', 'logs', 'terminals');
    const closed = mainDb
      .prepare(
        'SELECT id, transcriptPath FROM terminal_sessions ' +
          'WHERE exitedAt IS NOT NULL AND exitedAt < ?'
      )
      .all(terminalCutoff);
    const delTerminal = mainDb.prepare('DELETE FROM terminal_sessions WHERE id = ?');
    const terminalTx = mainDb.transaction((rows) => {
      let n = 0;
      for (const r of rows) {
        delTerminal.run(r.id);
        n++;
      }
      return n;
    });
    summary.terminalRows = terminalTx(closed);
    for (const r of closed) {
      const transcriptPath =
        r.transcriptPath || path.join(logsTerminalsDir, `${r.id}.log`);
      try {
        fs.unlinkSync(transcriptPath);
        summary.terminalTranscripts++;
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.error(`  warning: could not unlink transcript ${transcriptPath}: ${e.message}`);
        }
      }
    }

    // 3. Orphaned mount-index files (belt-and-suspenders). Mount-index DB may
    //    be absent on older instances — skip gracefully.
    try {
      mountsDb = openMountIndexDb(resolved.dataDir, pepper, { readonly: false });
      summary.orphanedFiles = mountsDb
        .prepare(
          'DELETE FROM doc_mount_files ' +
            'WHERE id NOT IN (SELECT DISTINCT fileId FROM doc_mount_file_links)'
        )
        .run().changes;
    } catch {
      summary.orphanedFiles = 0;
    }

    // Record the sweep time so the server's startup short-circuit honors it.
    mainDb
      .prepare(
        'INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?) ' +
          'ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"'
      )
      .run(LAST_SWEEP_KEY, new Date().toISOString());
  } catch (err) {
    console.error(`Error during maintenance run: ${err.message}`);
    if (mountsDb) try { mountsDb.close(); } catch {}
    if (mainDb) try { mainDb.close(); } catch {}
    releaseWriteLock(resolved.dataDir);
    process.exit(1);
  }

  if (mountsDb) try { mountsDb.close(); } catch {}
  if (mainDb) try { mainDb.close(); } catch {}
  releaseWriteLock(resolved.dataDir);

  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('Maintenance run complete:');
    console.log(`  Reaped COMPLETED jobs:       ${summary.completedJobs}`);
    console.log(`  Reaped DEAD jobs:            ${summary.deadJobs}`);
    console.log(`  Reaped terminal sessions:    ${summary.terminalRows}`);
    console.log(`  Removed transcript files:    ${summary.terminalTranscripts}`);
    console.log(`  Swept orphaned mount files:  ${summary.orphanedFiles}`);
    console.log('');
    console.log('(Stale-chat asset collapse runs on the server tick, not here.)');
  }
}

// ---------- main entry point ----------

async function maintenanceCommand(args) {
  const { flags, positional } = parseFlags(args);

  if (flags.help || positional.length === 0) {
    printHelp();
    return;
  }

  const verb = positional[0];
  switch (verb) {
    case 'status':
      await handleStatus(flags);
      break;
    case 'run':
      await handleRun(flags);
      break;
    default:
      console.error(`unknown maintenance command: ${verb}`);
      console.error('Use "quilltap maintenance --help" for usage.');
      process.exit(1);
  }
}

module.exports = {
  maintenanceCommand,
};
