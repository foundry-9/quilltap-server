'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  openMainDb,
  loadDbKey,
} = require('./db-helpers');

// ---------- argument parsing ----------

function parseFlags(args) {
  const flags = {
    dataDir: '',
    instance: '',
    passphrase: '',
    json: false,
    help: false,
    dryRun: false,
  };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-d': case '--data-dir': flags.dataDir = args[++i]; break;
      case '--instance': flags.instance = args[++i]; break;
      case '--passphrase': flags.passphrase = args[++i]; break;
      case '--json': flags.json = true; break;
      case '-h': case '--help': flags.help = true; break;
      case '--dry-run': flags.dryRun = true; break;
      default:
        if (!a.startsWith('-')) positional.push(a);
        else console.error(`unknown flag: ${a}`);
        break;
    }
    i++;
  }
  return { flags, positional };
}

// ---------- migration list parsing ----------

// Reads the registered migration list from migrations/scripts/index.ts and resolves each
// entry's real `id:` value by reading the imported source file. Heuristic camelCase→kebab
// conversion is unreliable (some migrations omit `-v1`, others use `-v2`), so we always
// trust the file.
function extractMigrationsFromSource() {
  const scriptsDir = path.join(__dirname, '../../..', 'migrations/scripts');
  const indexPath = path.join(scriptsDir, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    return [];
  }
  const indexContent = fs.readFileSync(indexPath, 'utf-8');

  // Pass 1: build name → { filePath, comment } from imports and preceding comments.
  const lines = indexContent.split('\n');
  const importInfo = {};
  let lastComment = '';
  for (const line of lines) {
    if (line.match(/^\s*\/\/\s+/)) {
      lastComment = line.replace(/^\s*\/\/\s+/, '').trim();
      continue;
    }
    const importMatch = line.match(/import\s+\{\s*(\w+)\s*\}\s+from\s+['"]\.\/([^'"]+)['"]/);
    if (importMatch) {
      const [, name, filePath] = importMatch;
      importInfo[name] = { filePath, comment: lastComment || '' };
      lastComment = '';
    } else if (line.trim() && !line.match(/^\s*\/\//) && !line.includes('import type')) {
      // Reset comment if we hit a non-comment non-import line
      if (!line.match(/^\s*$/)) lastComment = '';
    }
  }

  // Pass 2: find the active migrations array section and collect names in order.
  const arrayStart = indexContent.indexOf('export const migrations: Migration[] = [');
  if (arrayStart === -1) return [];
  const arrayEnd = indexContent.indexOf('];', arrayStart);
  if (arrayEnd === -1) return [];
  const arrayContent = indexContent.substring(arrayStart, arrayEnd);

  const activeNames = arrayContent.match(/\b([a-zA-Z]\w*Migration)\b/g) || [];
  const seen = new Set();

  // Pass 3: for each active name, read the corresponding file and extract the real `id:`.
  const migrations = [];
  for (const name of activeNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const info = importInfo[name];
    if (!info) continue;
    const filePath = path.join(scriptsDir, info.filePath + '.ts');
    if (!fs.existsSync(filePath)) continue;
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const idMatch = fileContent.match(/^\s*id:\s*['"]([^'"]+)['"]/m);
    if (!idMatch) continue;
    migrations.push({
      id: idMatch[1],
      description: info.comment || idMatch[1],
    });
  }

  return migrations;
}

// ---------- help text ----------

function printHelp() {
  console.log(`Usage: quilltap migrations <command> [options]

Commands:
  status                    Show applied and pending migrations
  pending                   List pending migrations
  run --dry-run             Simulate what would run on next startup

Options:
  -d, --data-dir <path>     Use a specific data directory
  --instance <name>         Use a named instance
  --passphrase <pass>       Provide passphrase (prompts if needed)
  --json                    Output as JSON
  -h, --help                Show this help message

Examples:
  quilltap migrations status
  quilltap migrations pending --instance Friday
  quilltap migrations run --dry-run --json
`);
}

// ---------- database access ----------

function getAppliedMigrations(db) {
  try {
    const rows = db.prepare(`
      SELECT id, completedAt, quilltapVersion, itemsAffected, message
      FROM migrations_state
      ORDER BY completedAt ASC
    `).all();
    return rows || [];
  } catch (err) {
    // Table may not exist in brand-new instances
    return [];
  }
}

// ---------- command handlers ----------

async function openResolvedMainDb(flags) {
  const resolved = resolveDataDirAndPassphrase(flags);
  printDefaultInstanceHint(resolved);
  const pepper = await loadDbKey(resolved.dataDir, resolved.passphrase);
  return openMainDb(resolved.dataDir, pepper, { readonly: true });
}

async function handleStatus(flags) {
  let db;
  try {
    db = await openResolvedMainDb(flags);
  } catch (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }

  const applied = getAppliedMigrations(db);
  const source = extractMigrationsFromSource();

  const appliedIds = new Set(applied.map(m => m.id));
  const sourceIds = new Set(source.map(m => m.id));
  const pending = source.filter(m => !appliedIds.has(m.id));
  const retired = applied.filter(m => !sourceIds.has(m.id));

  if (flags.json) {
    console.log(JSON.stringify({
      sourceTotal: source.length,
      recordedApplied: applied.length,
      pending: pending.length,
      retired: retired.length,
      pendingList: pending,
      retiredList: retired.map(m => ({ id: m.id, completedAt: m.completedAt })),
      mostRecent: applied.length > 0 ? applied[applied.length - 1] : null,
    }, null, 2));
  } else {
    console.log(`Migrations in source:     ${source.length}`);
    console.log(`Recorded as applied:      ${applied.length}` +
      (retired.length > 0 ? ` (${retired.length} retired from active list)` : ''));
    console.log(`Not yet recorded:         ${pending.length}` +
      (pending.length > 0 ? '  (may include migrations whose shouldRun() returns false on this instance)' : ''));
    if (applied.length > 0) {
      const latest = applied[applied.length - 1];
      console.log(`Most recent applied:      ${latest.id} at ${latest.completedAt}`);
    }
    if (pending.length > 0) {
      console.log('');
      console.log('Not yet recorded as applied:');
      pending.forEach(m => {
        console.log(`  ${m.id.padEnd(50)} ${m.description}`);
      });
    }
  }

  db.close();
}

async function handlePending(flags) {
  let db;
  try {
    db = await openResolvedMainDb(flags);
  } catch (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }

  const applied = getAppliedMigrations(db);
  const source = extractMigrationsFromSource();

  const appliedIds = new Set(applied.map(m => m.id));
  const pending = source.filter(m => !appliedIds.has(m.id));

  if (flags.json) {
    console.log(JSON.stringify(pending, null, 2));
  } else {
    if (pending.length === 0) {
      console.log('No pending migrations.');
    } else {
      pending.forEach(m => {
        console.log(`${m.id.padEnd(50)} ${m.description}`);
      });
    }
  }

  db.close();
}

async function handleRun(flags) {
  if (!flags.dryRun) {
    console.error('Error: migrations run requires --dry-run flag.');
    console.error('Actual migration execution happens at server startup, where the loading screen');
    console.error('and progress reporting are available. To see what would run on the next startup,');
    console.error('use: quilltap migrations run --dry-run');
    process.exit(1);
  }

  let db;
  try {
    db = await openResolvedMainDb(flags);
  } catch (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }

  const applied = getAppliedMigrations(db);
  const source = extractMigrationsFromSource();

  const appliedIds = new Set(applied.map(m => m.id));
  const pending = source.filter(m => !appliedIds.has(m.id));

  if (flags.json) {
    console.log(JSON.stringify({
      pending: pending.length,
      migrations: pending.map(m => ({
        id: m.id,
        description: m.description,
        note: 'shouldRun() predicate is evaluated at startup; inspect migration source for details',
      })),
    }, null, 2));
  } else {
    console.log(`Dry run: ${pending.length} migrations would run on next startup`);
    if (pending.length > 0) {
      console.log('');
      pending.forEach(m => {
        console.log(`  ${m.id.padEnd(50)} ${m.description}`);
      });
      console.log('');
      console.log('Note: shouldRun() predicate is evaluated at startup.');
      console.log('Inspect the migration source in migrations/scripts/ for conditional logic.');
    } else {
      console.log('');
      console.log('All migrations have been applied.');
    }
  }

  db.close();
}

// ---------- main entry point ----------

async function migrationsCommand(args) {
  const { flags, positional } = parseFlags(args);

  if (flags.help || positional.length === 0) {
    printHelp();
    return;
  }

  const verb = positional[0];

  try {
    switch (verb) {
      case 'status':
        await handleStatus(flags);
        break;
      case 'pending':
        await handlePending(flags);
        break;
      case 'run':
        await handleRun(flags);
        break;
      default:
        console.error(`unknown migrations command: ${verb}`);
        console.error('Use "quilltap migrations --help" for usage.');
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  migrationsCommand,
};
