'use strict';

/**
 * `quilltap file-verify` — force-download an instance's cloud-evicted data files.
 *
 * An instance can live in a cloud-synced folder (iCloud Drive on macOS today;
 * OneDrive / Google Drive File Stream on Windows later). Those providers EVICT
 * idle files to dataless placeholders. If a database file is still dataless when
 * SQLite/SQLCipher opens it, the read fails with "file is not a database" or
 * returns partially-materialized garbage — which has wedged whole startups.
 *
 * The server does this automatically at boot (Phase -1, before the .dbkey is
 * read). This command is the manual/diagnostic twin for the CLI, which opens the
 * encrypted databases directly and benefits from the same guarantee. It needs no
 * passphrase and never decrypts anything — it just reads the bytes to nowhere,
 * which is what faults a dataless file in.
 *
 * Logic MIRRORS the TypeScript source of truth at
 * `lib/startup/materialize-cloud-files.ts`. Keep them in sync.
 */

const fs = require('fs');
const path = require('path');
const { resolveDataDirAndPassphrase, printDefaultInstanceHint } = require('./db-helpers');

const DEFAULT_STALL_MS = 30_000;
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

// ---------- detection (platform seam) ----------

// macOS dataless heuristic: a real file (size > 0) with no allocated blocks has
// not been materialized locally (mirrors the SF_DATALESS flag). Zero-byte files
// are never flagged. Other platforms fall through as a no-op for now.
function isDatalessStat(stat) {
  return stat.size > 0 && stat.blocks === 0;
}

function listTopLevelFiles(dataDir) {
  let entries;
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // skip directories (backups/) and symlinks
    const full = path.join(dataDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    out.push({ name: entry.name, full, size: stat.size, dataless: isDatalessStat(stat) });
  }
  return out;
}

// ---------- streaming materialize with per-chunk stall guard ----------

function streamMaterialize(filePath, stallMs) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: READ_CHUNK_BYTES });
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stream.destroy(new Error(`stalled — no data for ${Math.round(stallMs / 1000)}s`));
      }, stallMs);
    };
    arm();
    stream.on('data', () => arm()); // discard chunk; the read faults the bytes in
    stream.on('end', () => {
      clearTimeout(timer);
      resolve();
    });
    stream.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------- argument parsing ----------

function parseFlags(args) {
  const flags = {
    dataDir: '',
    instance: '',
    all: false,
    json: false,
    help: false,
    stallMs: DEFAULT_STALL_MS,
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-d': case '--data-dir': flags.dataDir = args[++i]; break;
      case '-i': case '--instance': flags.instance = args[++i]; break;
      case '--all': flags.all = true; break;
      case '--json': flags.json = true; break;
      case '--stall-ms': flags.stallMs = Number(args[++i]) || DEFAULT_STALL_MS; break;
      case '-h': case '--help': flags.help = true; break;
      default:
        if (a.startsWith('-')) console.error(`unknown flag: ${a}`);
        break;
    }
    i++;
  }
  return flags;
}

function printHelp() {
  console.log(`Usage: quilltap file-verify [options]

Force-download the instance's cloud-evicted (dataless) data files so the
databases are fully local before anything opens them. Reads each placeholder to
nowhere, which faults it in through the cloud provider (iCloud Drive, etc.).
Safe to run repeatedly; a no-op when nothing is evicted. macOS only for now.

Only the TOP-LEVEL files of the data directory are considered (the backups/
subdirectory is left alone).

Options:
  -d, --data-dir <path>     Use a specific data directory (instance root)
  -i, --instance <name>     Use a named instance
  --all                     Read every top-level file, not just dataless ones
  --stall-ms <ms>           Treat a download as stalled after this many ms with
                            no bytes (per-chunk, not per-file; default ${DEFAULT_STALL_MS})
  --json                    Output as JSON
  -h, --help                Show this help message

Examples:
  quilltap file-verify --instance Ignite
  quilltap file-verify --instance Friday --json
  quilltap file-verify -d ~/iCloud/Quilltap/Ignite
`);
}

// ---------- main entry point ----------

async function fileVerifyCommand(args) {
  const flags = parseFlags(args);
  if (flags.help) {
    printHelp();
    return;
  }

  let resolved;
  try {
    resolved = resolveDataDirAndPassphrase({ dataDir: flags.dataDir, instance: flags.instance });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  printDefaultInstanceHint(resolved);
  // resolved.dataDir already points at the instance's data/ directory.
  const targetDir = resolved.dataDir;

  const files = listTopLevelFiles(targetDir);
  const targets = flags.all ? files : files.filter((f) => f.dataless);

  const summary = {
    dataDir: targetDir,
    checked: files.length,
    targeted: targets.length,
    downloaded: 0,
    failed: 0,
    failedNames: [],
  };

  if (targets.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `Nothing to fetch — all ${files.length} top-level file(s) in ${targetDir} are already ashore.`,
      );
    }
    return;
  }

  if (!flags.json) {
    console.log(
      `Fetching ${targets.length} file(s) down from the cloud (of ${files.length} top-level):`,
    );
  }

  for (let i = 0; i < targets.length; i++) {
    const file = targets[i];
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    if (!flags.json) {
      process.stdout.write(`  Coaxing «${file.name}» (${mb} MB) down — ${i + 1}/${targets.length}… `);
    }
    try {
      await streamMaterialize(file.full, flags.stallMs);
      summary.downloaded++;
      if (!flags.json) console.log('secured.');
    } catch (err) {
      summary.failed++;
      summary.failedNames.push(file.name);
      if (!flags.json) console.log(`failed (${err.message}).`);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `Done — ${summary.downloaded} secured, ${summary.failed} failed.` +
        (summary.failed ? ` Failed: ${summary.failedNames.join(', ')}` : ''),
    );
  }

  if (summary.failed > 0) process.exit(1);
}

module.exports = {
  fileVerifyCommand,
};
