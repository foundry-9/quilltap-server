'use strict';

/**
 * `quilltap memory-diff <chatId>` — dump existing memories for a chat and
 * stream a dry-run re-extraction from the running server, writing both to
 * JSON files for diffing.
 *
 * Read-only against the encrypted SQLite (memories table). The dry-run
 * extraction is performed by the running server via
 * POST /api/v1/chats/<chatId>?action=extract-memories-dry-run, which streams
 * NDJSON progress events. Nothing is persisted server-side.
 */

const path = require('path');
const fs = require('fs');
const { resolveDataDir, loadDbKey } = require('./db-helpers');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function printMemoryDiffHelp() {
  console.log(`
Quilltap memory-diff Tool

Usage: quilltap memory-diff <chatId> [options]

Reads existing memories for a chat from the encrypted SQLite database and
runs a dry-run re-extraction against the running Quilltap server. Writes:
  <out>/<chatId>-existing.json   — current memories from the database
  <out>/<chatId>-extracted.json  — what the extraction pipeline would write

Nothing is persisted; the server runs the extraction passes in dry-run mode
so the comparison is non-destructive.

Options:
  -d, --data-dir <path>      Override data directory (instance root)
      --passphrase <pass>    Decrypt .dbkey if peppered
      --port <number>        Server port for API calls (default: 3000)
      --out <dir>            Output directory (default: cwd)
      --concurrency <number> Parallel turns to process (default: 4, max: 32).
                             Cloud cheap-LLMs can handle 8–16; keep this low
                             for local Ollama to avoid saturating the model.
  -h, --help                 Show this help

Examples:
  quilltap memory-diff <chatId>
  quilltap memory-diff <chatId> --data-dir ~/iCloud/Quilltap/Friday
  quilltap memory-diff <chatId> --out /tmp/extract-diff
  quilltap memory-diff <chatId> --concurrency 8     # cloud cheap-LLM
`);
}

function parseFlags(args) {
  const flags = {
    dataDir: '',
    passphrase: '',
    port: 3000,
    out: process.cwd(),
    concurrency: 4,
    help: false,
  };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-d':
      case '--data-dir':
        flags.dataDir = args[++i];
        break;
      case '--passphrase':
        flags.passphrase = args[++i];
        break;
      case '--port': {
        const p = parseInt(args[++i], 10);
        if (isNaN(p) || p < 1 || p > 65535) {
          console.error('Error: --port must be between 1 and 65535');
          process.exit(1);
        }
        flags.port = p;
        break;
      }
      case '--concurrency': {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 1 || n > 32) {
          console.error('Error: --concurrency must be between 1 and 32');
          process.exit(1);
        }
        flags.concurrency = n;
        break;
      }
      case '--out':
        flags.out = args[++i];
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

function tryParseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Open quilltap.db read-only and return all memories for a chat. JSON
 * columns are parsed; the binary `embedding` column is dropped from output.
 */
async function readExistingMemories(flags, chatId) {
  const dataDir = resolveDataDir(flags.dataDir);
  const dbPath = path.join(dataDir, 'quilltap.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  let pepper;
  try {
    pepper = await loadDbKey(dataDir, flags.passphrase);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  let Database;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
  } catch {
    Database = require('better-sqlite3');
  }
  const db = new Database(dbPath, { readonly: true });

  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }

  try {
    db.prepare('SELECT 1').get();
  } catch (err) {
    db.close();
    console.error(`Cannot open database: ${err.message}`);
    console.error('The database may be encrypted with a different key, or the .dbkey file may be missing.');
    process.exit(1);
  }

  let rows;
  try {
    rows = db.prepare(`
      SELECT id, characterId, aboutCharacterId, chatId, source, sourceMessageId,
             content, summary, keywords, tags, importance, reinforcementCount,
             lastReinforcedAt, relatedMemoryIds, reinforcedImportance,
             createdAt, updatedAt
      FROM memories
      WHERE chatId = ?
      ORDER BY createdAt
    `).all(chatId);
  } finally {
    db.close();
  }

  return rows.map(row => ({
    ...row,
    keywords: tryParseJsonColumn(row.keywords, []),
    tags: tryParseJsonColumn(row.tags, []),
    relatedMemoryIds: tryParseJsonColumn(row.relatedMemoryIds, []),
  }));
}

/**
 * Read NDJSON from a Response body, calling `onEvent` for every parsed line.
 * Tolerates split lines across chunks.
 */
async function streamNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (err) {
        process.stderr.write(`${YELLOW}[warn] could not parse server line: ${line.slice(0, 200)}${RESET}\n`);
        continue;
      }
      onEvent(event);
    }
  }
  // Flush any trailing partial line
  const tail = buffer.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail));
    } catch {
      /* swallow */
    }
  }
}

async function memoryDiffCommand(args) {
  const { flags, positional } = parseFlags(args);

  if (flags.help || positional.length === 0) {
    printMemoryDiffHelp();
    process.exit(flags.help ? 0 : 1);
  }
  if (positional.length > 1) {
    console.error('Error: only one chatId may be specified');
    process.exit(1);
  }

  const chatId = positional[0];

  if (!fs.existsSync(flags.out)) {
    try {
      fs.mkdirSync(flags.out, { recursive: true });
    } catch (err) {
      console.error(`Cannot create output directory ${flags.out}: ${err.message}`);
      process.exit(1);
    }
  }

  const existingPath = path.join(flags.out, `${chatId}-existing.json`);
  const extractedPath = path.join(flags.out, `${chatId}-extracted.json`);

  // -------- 1. Read existing memories from the encrypted DB ----------------
  process.stderr.write(`${BOLD}Reading existing memories${RESET} for chat ${DIM}${chatId}${RESET}...\n`);
  const existing = await readExistingMemories(flags, chatId);
  fs.writeFileSync(existingPath, JSON.stringify(existing, null, 2) + '\n');
  process.stderr.write(`  wrote ${GREEN}${existing.length}${RESET} memories to ${existingPath}\n`);

  // -------- 2. Stream dry-run re-extraction from the server ----------------
  const url =
    `http://localhost:${flags.port}/api/v1/chats/${encodeURIComponent(chatId)}` +
    `?action=extract-memories-dry-run&concurrency=${flags.concurrency}`;
  process.stderr.write(
    `${BOLD}Streaming re-extraction${RESET} (concurrency ${CYAN}${flags.concurrency}${RESET}) from ${DIM}${url}${RESET}\n`
  );

  let res;
  try {
    res = await fetch(url, { method: 'POST' });
  } catch (err) {
    console.error(`${RED}Could not reach Quilltap server at http://localhost:${flags.port}: ${err.message}${RESET}`);
    console.error('Start the server (npm run dev) or pass --port to match a non-default port.');
    process.exit(1);
  }

  if (!res.ok) {
    let body;
    try {
      body = await res.text();
    } catch {
      body = '';
    }
    console.error(`${RED}Server returned ${res.status}: ${body.slice(0, 500)}${RESET}`);
    process.exit(1);
  }

  if (!res.body) {
    console.error(`${RED}Server response had no body${RESET}`);
    process.exit(1);
  }

  const candidates = [];
  let turnCount = 0;
  let totalCandidates = null;
  let fatal = null;

  await streamNdjson(res, (event) => {
    switch (event.type) {
      case 'start':
        turnCount = event.turnCount;
        process.stderr.write(`  re-extracting ${CYAN}${turnCount}${RESET} turns...\n`);
        break;
      case 'candidate':
        candidates.push(event);
        break;
      case 'turn':
        process.stderr.write(
          `  [${String(event.index + 1).padStart(String(turnCount).length)}/${turnCount}] ` +
          `turn ${DIM}${event.sourceMessageId ?? '?'}${RESET}: ` +
          `${GREEN}${event.candidatesAdded}${RESET} candidate(s)\n`
        );
        break;
      case 'turn-error':
        process.stderr.write(
          `  ${RED}[${event.index + 1}/${turnCount}] FAILED${RESET}: ${event.error}\n`
        );
        break;
      case 'ping':
        // Server-side heartbeat keeping the connection warm during long
        // first-turn LLM passes; nothing to display.
        break;
      case 'done':
        totalCandidates = event.totalCandidates;
        break;
      case 'fatal':
        fatal = event.error;
        break;
      default:
        process.stderr.write(`  ${YELLOW}[unknown event] ${JSON.stringify(event)}${RESET}\n`);
    }
  });

  if (fatal) {
    console.error(`${RED}Server reported fatal error: ${fatal}${RESET}`);
    // Still write what we collected so the user can inspect partial output.
  }

  fs.writeFileSync(extractedPath, JSON.stringify(candidates, null, 2) + '\n');
  process.stderr.write(`  wrote ${GREEN}${candidates.length}${RESET} candidates to ${extractedPath}\n`);

  if (totalCandidates !== null && totalCandidates !== candidates.length) {
    process.stderr.write(
      `  ${YELLOW}note: server reported ${totalCandidates} total candidates but stream delivered ${candidates.length}${RESET}\n`
    );
  }

  // -------- 3. Summary on stdout ------------------------------------------
  console.log(`${existing.length} existing → ${candidates.length} re-extracted`);

  if (fatal) process.exit(2);
}

module.exports = { memoryDiffCommand };
