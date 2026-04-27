'use strict';

const path = require('path');
const fs = require('fs');
const { resolveDataDir, loadDbKey, openMountIndexDb } = require('./db-helpers');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const TEXT_FILE_TYPES = new Set(['markdown', 'txt', 'json', 'jsonl']);
const BINARY_FILE_TYPES = new Set(['pdf', 'docx', 'blob']);

function printDocsHelp() {
  console.log(`
Quilltap Document Store Tool

Usage: quilltap docs <subcommand> [options]

Subcommands:
  list                                   List all mount points
  show <id>                              Details for one mount point
  files <id> [--folder <path>]           List files in a mount
  read <id> <relativePath>               Print file contents to stdout
  read --rendered <id> <relativePath>    Print extracted plaintext to stdout
  export <id> <outputDir>                Export an entire mount to a directory
  scan <id>                              Trigger a rescan via the running server

Options:
  -d, --data-dir <path>     Override data directory
  --passphrase <pass>       Decrypt .dbkey if peppered
  --port <number>           Server port for API calls (default: 3000)
  --json                    Machine-readable output (list/show/files/scan)
  --rendered                For 'read': output extracted plaintext
  --folder <path>           For 'files': narrow to a folder prefix
  --force                   For 'read': dump binary to TTY anyway
  -h, --help                Show this help

Read-only operations (list, show, files, read, export) open the mount-index
database directly. Write operations (scan) require the Quilltap server to be
running on the chosen --port.

Examples:
  quilltap docs list
  quilltap docs list --json
  quilltap docs show <mount-id>
  quilltap docs files <mount-id> --folder notes/2026
  quilltap docs read <mount-id> notes/today.md
  quilltap docs read --rendered <mount-id> papers/foo.pdf
  quilltap docs read <mount-id> images/avatar.webp > /tmp/avatar.webp
  quilltap docs export <mount-id> /tmp/quilltap-mount-backup
  quilltap docs scan <mount-id>
`);
}

function parseFlags(args) {
  const flags = {
    dataDir: '',
    passphrase: '',
    port: 3000,
    json: false,
    rendered: false,
    folder: '',
    force: false,
    help: false,
  };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-d': case '--data-dir': flags.dataDir = args[++i]; break;
      case '--passphrase': flags.passphrase = args[++i]; break;
      case '--port': {
        const p = parseInt(args[++i], 10);
        if (isNaN(p) || p < 1 || p > 65535) {
          console.error('Error: --port must be between 1 and 65535');
          process.exit(1);
        }
        flags.port = p;
        break;
      }
      case '--json': flags.json = true; break;
      case '--rendered': flags.rendered = true; break;
      case '--folder': flags.folder = args[++i]; break;
      case '--force': flags.force = true; break;
      case '-h': case '--help': flags.help = true; break;
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

async function openDb(flags) {
  const dataDir = resolveDataDir(flags.dataDir);
  const pepper = await loadDbKey(dataDir, flags.passphrase);
  const db = openMountIndexDb(dataDir, pepper, { readonly: true });
  return { db, dataDir };
}

function requireMount(db, id) {
  const row = db.prepare('SELECT * FROM doc_mount_points WHERE id = ?').get(id);
  if (!row) {
    console.error(`No mount point found with id ${id}`);
    process.exit(1);
  }
  return row;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ----------------------------------------------------------------------------
// list
// ----------------------------------------------------------------------------

async function handleList(flags) {
  const { db } = await openDb(flags);
  try {
    const rows = db.prepare(`
      SELECT id, name, mountType, storeType, basePath, enabled,
             fileCount, chunkCount, totalSizeBytes, scanStatus
      FROM doc_mount_points
      ORDER BY name COLLATE NOCASE
    `).all();
    if (flags.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }
    if (rows.length === 0) {
      console.log('(no mount points)');
      return;
    }
    const display = rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.mountType,
      store: r.storeType,
      enabled: r.enabled ? 'yes' : 'no',
      files: r.fileCount,
      chunks: r.chunkCount,
      size: formatBytes(r.totalSizeBytes || 0),
      status: r.scanStatus,
    }));
    console.table(display);
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// show
// ----------------------------------------------------------------------------

async function handleShow(flags, id) {
  if (!id) {
    console.error('Usage: quilltap docs show <mount-id>');
    process.exit(1);
  }
  const { db } = await openDb(flags);
  try {
    const mount = requireMount(db, id);
    const fileCount = db.prepare('SELECT COUNT(*) AS n FROM doc_mount_files WHERE mountPointId = ?').get(id).n;
    const chunkCount = db.prepare('SELECT COUNT(*) AS n FROM doc_mount_chunks WHERE mountPointId = ?').get(id).n;
    const blobCount = db.prepare('SELECT COUNT(*) AS n FROM doc_mount_blobs WHERE mountPointId = ?').get(id).n;
    const docCount = db.prepare('SELECT COUNT(*) AS n FROM doc_mount_documents WHERE mountPointId = ?').get(id).n;

    const liveCounts = {
      filesActual: fileCount,
      chunksActual: chunkCount,
      blobsActual: blobCount,
      documentsActual: docCount,
    };

    if (flags.json) {
      process.stdout.write(JSON.stringify({ ...mount, ...liveCounts }, null, 2) + '\n');
      return;
    }

    console.log(`${BOLD}${mount.name}${RESET}  ${DIM}${mount.id}${RESET}`);
    console.log(`  Type:           ${mount.mountType} / ${mount.storeType}`);
    console.log(`  Base path:      ${mount.basePath || DIM + '(database-backed)' + RESET}`);
    console.log(`  Enabled:        ${mount.enabled ? GREEN + 'yes' + RESET : RED + 'no' + RESET}`);
    console.log(`  Scan status:    ${mount.scanStatus}${mount.lastScanError ? '  ' + RED + mount.lastScanError + RESET : ''}`);
    console.log(`  Conversion:     ${mount.conversionStatus}${mount.conversionError ? '  ' + RED + mount.conversionError + RESET : ''}`);
    console.log(`  Last scanned:   ${mount.lastScannedAt || DIM + 'never' + RESET}`);
    console.log(`  Cached counts:  ${mount.fileCount} files, ${mount.chunkCount} chunks, ${formatBytes(mount.totalSizeBytes || 0)}`);
    console.log(`  Live counts:    ${fileCount} files, ${chunkCount} chunks, ${blobCount} blobs, ${docCount} db-docs`);
    if (fileCount !== mount.fileCount || chunkCount !== mount.chunkCount) {
      console.log(`  ${YELLOW}Note: cached counts disagree with live counts; consider 'docs scan'${RESET}`);
    }
    console.log(`  Created:        ${mount.createdAt}`);
    console.log(`  Updated:        ${mount.updatedAt}`);
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// files
// ----------------------------------------------------------------------------

async function handleFiles(flags, id) {
  if (!id) {
    console.error('Usage: quilltap docs files <mount-id> [--folder <path>]');
    process.exit(1);
  }
  const { db } = await openDb(flags);
  try {
    requireMount(db, id);
    let rows;
    if (flags.folder) {
      const prefix = flags.folder.replace(/\/+$/, '') + '/';
      rows = db.prepare(`
        SELECT relativePath, fileType, source, fileSizeBytes, chunkCount, conversionStatus
        FROM doc_mount_files
        WHERE mountPointId = ? AND relativePath LIKE ?
        ORDER BY relativePath
      `).all(id, prefix + '%');
    } else {
      rows = db.prepare(`
        SELECT relativePath, fileType, source, fileSizeBytes, chunkCount, conversionStatus
        FROM doc_mount_files
        WHERE mountPointId = ?
        ORDER BY relativePath
      `).all(id);
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }
    if (rows.length === 0) {
      console.log('(no files)');
      return;
    }
    const display = rows.map(r => ({
      relativePath: r.relativePath,
      type: r.fileType,
      source: r.source,
      size: formatBytes(r.fileSizeBytes || 0),
      chunks: r.chunkCount,
      status: r.conversionStatus,
    }));
    console.table(display);
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// read
// ----------------------------------------------------------------------------

function isBinaryFileType(fileType) {
  return BINARY_FILE_TYPES.has(fileType);
}

function ttyGuard(fileType, flags, label) {
  if (!process.stdout.isTTY) return;
  if (!isBinaryFileType(fileType)) return;
  if (flags.force) return;
  console.error(`${label} is binary (${fileType}); redirect to a file (e.g. > out.${fileType}) or pass --force.`);
  process.exit(1);
}

async function handleRead(flags, id, relativePath) {
  if (!id || !relativePath) {
    console.error('Usage: quilltap docs read [--rendered] <mount-id> <relativePath>');
    process.exit(1);
  }

  const { db } = await openDb(flags);
  try {
    const mount = requireMount(db, id);

    if (flags.rendered) {
      return readRendered(db, mount, relativePath);
    }
    return readRaw(db, mount, relativePath, flags);
  } finally {
    db.close();
  }
}

function readRaw(db, mount, relativePath, flags) {
  const file = db.prepare(`
    SELECT id, source, fileType
    FROM doc_mount_files
    WHERE mountPointId = ? AND relativePath = ?
  `).get(mount.id, relativePath);

  if (file) {
    ttyGuard(file.fileType, flags, relativePath);

    if (file.source === 'filesystem') {
      const fullPath = path.join(mount.basePath, relativePath);
      if (!fs.existsSync(fullPath)) {
        console.error(`File missing on disk: ${fullPath}`);
        process.exit(1);
      }
      // Stream so we don't load huge files into memory.
      const stream = fs.createReadStream(fullPath);
      stream.pipe(process.stdout);
      return new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
    }

    if (file.source === 'database') {
      if (TEXT_FILE_TYPES.has(file.fileType)) {
        const doc = db.prepare(`
          SELECT content FROM doc_mount_documents
          WHERE mountPointId = ? AND relativePath = ?
        `).get(mount.id, relativePath);
        if (!doc) {
          console.error(`File row exists but no document content for ${relativePath}`);
          process.exit(1);
        }
        process.stdout.write(doc.content);
        return;
      }
      // Binary stored in doc_mount_blobs
      const blob = db.prepare(`
        SELECT data FROM doc_mount_blobs
        WHERE mountPointId = ? AND relativePath = ?
      `).get(mount.id, relativePath);
      if (!blob) {
        console.error(`File row exists but no blob bytes for ${relativePath}`);
        process.exit(1);
      }
      process.stdout.write(blob.data);
      return;
    }

    console.error(`Unknown file source: ${file.source}`);
    process.exit(1);
  }

  // No row in doc_mount_files — try blobs directly (some binaries may not be mirrored).
  const blob = db.prepare(`
    SELECT data, originalMimeType FROM doc_mount_blobs
    WHERE mountPointId = ? AND relativePath = ?
  `).get(mount.id, relativePath);
  if (blob) {
    ttyGuard('blob', flags, relativePath);
    process.stdout.write(blob.data);
    return;
  }

  console.error(`No file at ${relativePath} in mount ${mount.name}`);
  process.exit(1);
}

function readRendered(db, mount, relativePath) {
  // 1. Blob with extractedText wins.
  const blob = db.prepare(`
    SELECT extractedText FROM doc_mount_blobs
    WHERE mountPointId = ? AND relativePath = ?
  `).get(mount.id, relativePath);
  if (blob && blob.extractedText) {
    process.stdout.write(blob.extractedText);
    return;
  }

  // 2. Look up the file row.
  const file = db.prepare(`
    SELECT id, source, fileType
    FROM doc_mount_files
    WHERE mountPointId = ? AND relativePath = ?
  `).get(mount.id, relativePath);

  if (!file) {
    console.error(`No file at ${relativePath} in mount ${mount.name}`);
    process.exit(1);
  }

  // 3. Database-backed text doc — content IS the rendered form.
  if (file.source === 'database' && TEXT_FILE_TYPES.has(file.fileType)) {
    const doc = db.prepare(`
      SELECT content FROM doc_mount_documents
      WHERE mountPointId = ? AND relativePath = ?
    `).get(mount.id, relativePath);
    if (doc) {
      process.stdout.write(doc.content);
      return;
    }
  }

  // 4. Plain-text filesystem files render to themselves.
  if (file.source === 'filesystem' && TEXT_FILE_TYPES.has(file.fileType)) {
    const fullPath = path.join(mount.basePath, relativePath);
    if (fs.existsSync(fullPath)) {
      process.stdout.write(fs.readFileSync(fullPath, 'utf8'));
      return;
    }
  }

  // 5. Fall back to concatenated chunks.
  const chunks = db.prepare(`
    SELECT content FROM doc_mount_chunks
    WHERE fileId = ?
    ORDER BY chunkIndex
  `).all(file.id);
  if (chunks.length === 0) {
    console.error(`No rendered text available for ${relativePath}. Run 'quilltap docs scan ${mount.id}' to extract and embed.`);
    process.exit(1);
  }
  process.stdout.write(chunks.map(c => c.content).join('\n\n'));
}

// ----------------------------------------------------------------------------
// export
// ----------------------------------------------------------------------------

async function handleExport(flags, id, outputDir) {
  if (!id || !outputDir) {
    console.error('Usage: quilltap docs export <mount-id> <outputDir>');
    process.exit(1);
  }

  const resolvedOut = outputDir.startsWith('~')
    ? path.join(require('os').homedir(), outputDir.slice(1))
    : path.resolve(outputDir);

  if (!fs.existsSync(resolvedOut)) {
    fs.mkdirSync(resolvedOut, { recursive: true });
  } else {
    const stat = fs.statSync(resolvedOut);
    if (!stat.isDirectory()) {
      console.error(`Output path exists and is not a directory: ${resolvedOut}`);
      process.exit(1);
    }
  }

  const { db } = await openDb(flags);
  let writtenFiles = 0;
  let writtenBytes = 0;
  const writtenPaths = new Set();
  try {
    const mount = requireMount(db, id);

    const files = db.prepare(`
      SELECT id, relativePath, source, fileType
      FROM doc_mount_files
      WHERE mountPointId = ?
      ORDER BY relativePath
    `).all(id);

    for (const file of files) {
      const dest = path.join(resolvedOut, file.relativePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      if (file.source === 'filesystem') {
        const src = path.join(mount.basePath, file.relativePath);
        if (!fs.existsSync(src)) {
          console.error(`${YELLOW}skip${RESET} ${file.relativePath} (missing on disk: ${src})`);
          continue;
        }
        fs.copyFileSync(src, dest);
        writtenBytes += fs.statSync(dest).size;
      } else if (file.source === 'database') {
        if (TEXT_FILE_TYPES.has(file.fileType)) {
          const doc = db.prepare(`
            SELECT content FROM doc_mount_documents
            WHERE mountPointId = ? AND relativePath = ?
          `).get(id, file.relativePath);
          if (!doc) {
            console.error(`${YELLOW}skip${RESET} ${file.relativePath} (no document content)`);
            continue;
          }
          fs.writeFileSync(dest, doc.content, 'utf8');
          writtenBytes += Buffer.byteLength(doc.content, 'utf8');
        } else {
          const blob = db.prepare(`
            SELECT data FROM doc_mount_blobs
            WHERE mountPointId = ? AND relativePath = ?
          `).get(id, file.relativePath);
          if (!blob) {
            console.error(`${YELLOW}skip${RESET} ${file.relativePath} (no blob bytes)`);
            continue;
          }
          fs.writeFileSync(dest, blob.data);
          writtenBytes += blob.data.length;
        }
      } else {
        console.error(`${YELLOW}skip${RESET} ${file.relativePath} (unknown source: ${file.source})`);
        continue;
      }
      writtenFiles += 1;
      writtenPaths.add(file.relativePath);
    }

    // Catch any blobs not mirrored into doc_mount_files (defensive).
    const blobs = db.prepare(`
      SELECT relativePath, data
      FROM doc_mount_blobs
      WHERE mountPointId = ?
    `).all(id);
    for (const blob of blobs) {
      if (writtenPaths.has(blob.relativePath)) continue;
      const dest = path.join(resolvedOut, blob.relativePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, blob.data);
      writtenBytes += blob.data.length;
      writtenFiles += 1;
    }

    console.log(`${GREEN}Exported${RESET} ${writtenFiles} file(s), ${formatBytes(writtenBytes)} → ${resolvedOut}`);
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// scan
// ----------------------------------------------------------------------------

async function handleScan(flags, id) {
  if (!id) {
    console.error('Usage: quilltap docs scan <mount-id>');
    process.exit(1);
  }
  const url = `http://localhost:${flags.port}/api/v1/mount-points/${encodeURIComponent(id)}?action=scan`;
  let res;
  try {
    res = await fetch(url, { method: 'POST' });
  } catch (err) {
    console.error(`Could not reach Quilltap server at http://localhost:${flags.port}: ${err.message}`);
    console.error('Start the server with `quilltap` (or pass --port to match a non-default port).');
    process.exit(1);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    console.error(`Server returned status ${res.status} with no JSON body`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Scan failed (${res.status}): ${body && body.error ? body.error : JSON.stringify(body)}`);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(body, null, 2) + '\n');
    return;
  }

  const data = body.data || body;
  const r = data.scanResult || {};
  console.log(`${GREEN}Scan complete${RESET}`);
  console.log(`  Files scanned:    ${r.filesScanned ?? '?'}`);
  console.log(`  New:              ${r.filesNew ?? '?'}`);
  console.log(`  Modified:         ${r.filesModified ?? '?'}`);
  console.log(`  Deleted:          ${r.filesDeleted ?? '?'}`);
  console.log(`  Chunks created:   ${r.chunksCreated ?? '?'}`);
  console.log(`  Errors:           ${(r.errors && r.errors.length) || 0}`);
  console.log(`  Embed jobs:       ${data.embeddingJobsEnqueued ?? '?'}`);
}

// ----------------------------------------------------------------------------
// dispatch
// ----------------------------------------------------------------------------

async function docsCommand(args) {
  if (args.length === 0) {
    printDocsHelp();
    process.exit(1);
  }
  if (args[0] === '-h' || args[0] === '--help') {
    printDocsHelp();
    process.exit(0);
  }

  const verb = args[0];
  const { flags, positional } = parseFlags(args.slice(1));

  if (flags.help) {
    printDocsHelp();
    process.exit(0);
  }

  try {
    switch (verb) {
      case 'list':
        await handleList(flags);
        break;
      case 'show':
        await handleShow(flags, positional[0]);
        break;
      case 'files':
        await handleFiles(flags, positional[0]);
        break;
      case 'read':
        await handleRead(flags, positional[0], positional[1]);
        break;
      case 'export':
        await handleExport(flags, positional[0], positional[1]);
        break;
      case 'scan':
        await handleScan(flags, positional[0]);
        break;
      default:
        console.error(`Unknown docs subcommand: ${verb}`);
        printDocsHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { docsCommand };
