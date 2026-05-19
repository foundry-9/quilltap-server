'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { resolveDataDirAndPassphrase, loadDbKey, openMountIndexDb } = require('./db-helpers');

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

Read subcommands:
  list                                   List all mount points
  show <mount>                           Details for one mount point
  files <mount> [--folder <path>]        List files in a mount
  read <mount> <relativePath>            Print file contents to stdout
  read --rendered <mount> <relativePath> Print extracted plaintext to stdout
  export <mount> <outputDir>             Export an entire mount to a directory
  scan <mount>                           Trigger a rescan via the running server

Write subcommands (server required for database-backed mounts):
  write [--force] <mount> <path> [file]  Write a file from <file> or stdin
  delete <mount> <path>                  Idempotent file delete
  mkdir <mount> <path>                   Idempotent folder create
  move <srcMount> <srcPath> <dstMount> <dstPath>           Move file (hard-link when possible)
  copy [--force] <srcMount> <srcPath> <dstMount> <dstPath> Copy file (hard-link unless --force)

<mount> may be a mount name or UUID. Names are case-insensitive; ambiguous
names print candidates and exit non-zero.

Options:
  -d, --data-dir <path>     Override data directory
  -i, --instance <name>     Use a registered instance (see 'quilltap instances')
  --passphrase <pass>       Decrypt .dbkey if peppered
  --port <number>           Server port for API calls (default: 3000)
  --json                    Machine-readable output
  --rendered                For 'read': output extracted plaintext
  --folder <path>           For 'files': narrow to a folder prefix
  --force                   For 'read': dump binary to TTY anyway
                            For 'write': overwrite existing destination
                            For 'copy':  overwrite + force a real byte copy
                                         (skips the default hard-link path)
  -h, --help                Show this help

Read-only operations (list, show, files, read, export) open the mount-index
database directly. Write operations talk to the running Quilltap server when
available (so reindex/embed kicks off automatically); they fall back to
filesystem-only writes when the server is down, and report what the index
will see after the next 'docs scan'.

Verification: every write computes a SHA-256 on both ends and compares them
before reporting success. Hard-linked files match trivially.

Examples:
  quilltap docs write notes today.md < draft.md
  quilltap docs write --force notes today.md draft.md
  quilltap docs delete notes today.md
  quilltap docs mkdir notes 2026/may
  quilltap docs move drafts foo.md notes 2026/foo.md
  quilltap docs copy notes today.md archive 2026-05/today.md
  quilltap docs copy --force notes today.md archive copy.md
`);
}

function parseFlags(args) {
  const flags = {
    dataDir: '',
    instance: '',
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
      case '-i': case '--instance': flags.instance = args[++i]; break;
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
  const { dataDir, passphrase } = resolveDataDirAndPassphrase({
    dataDir: flags.dataDir,
    instance: flags.instance,
    passphrase: flags.passphrase,
  });
  const pepper = await loadDbKey(dataDir, passphrase);
  const db = openMountIndexDb(dataDir, pepper, { readonly: true });
  return { db, dataDir };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireMount(db, spec) {
  if (!spec) {
    console.error('Error: mount name or id is required');
    process.exit(1);
  }
  if (UUID_RE.test(spec)) {
    const row = db.prepare('SELECT * FROM doc_mount_points WHERE id = ?').get(spec);
    if (!row) {
      console.error(`No mount point found with id ${spec}`);
      process.exit(1);
    }
    return row;
  }
  const rows = db.prepare(
    `SELECT * FROM doc_mount_points
     WHERE LOWER(name) = LOWER(?)
     ORDER BY name COLLATE NOCASE`
  ).all(spec);
  if (rows.length === 0) {
    console.error(`No mount point found with name "${spec}"`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`Ambiguous mount name "${spec}" matches multiple mounts:`);
    for (const r of rows) {
      console.error(`  ${r.id}  ${r.name}  (${r.mountType})`);
    }
    console.error('Pass the UUID instead.');
    process.exit(1);
  }
  return rows[0];
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
    const fileCount = db.prepare(
      'SELECT COUNT(*) AS n FROM doc_mount_file_links WHERE mountPointId = ?'
    ).get(mount.id).n;
    const chunkCount = db.prepare(
      'SELECT COUNT(*) AS n FROM doc_mount_chunks WHERE mountPointId = ?'
    ).get(mount.id).n;
    const blobCount = db.prepare(`
      SELECT COUNT(*) AS n FROM doc_mount_file_links l
      JOIN doc_mount_blobs b ON b.fileId = l.fileId
      WHERE l.mountPointId = ?
    `).get(mount.id).n;
    const docCount = db.prepare(`
      SELECT COUNT(*) AS n FROM doc_mount_file_links l
      JOIN doc_mount_documents d ON d.fileId = l.fileId
      WHERE l.mountPointId = ?
    `).get(mount.id).n;

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
    const mount = requireMount(db, id);
    let rows;
    if (flags.folder) {
      const prefix = flags.folder.replace(/\/+$/, '') + '/';
      rows = db.prepare(`
        SELECT l.relativePath, f.fileType, f.source, f.fileSizeBytes,
               l.chunkCount, l.conversionStatus
        FROM doc_mount_file_links l
        JOIN doc_mount_files f ON f.id = l.fileId
        WHERE l.mountPointId = ? AND l.relativePath LIKE ?
        ORDER BY l.relativePath
      `).all(mount.id, prefix + '%');
    } else {
      rows = db.prepare(`
        SELECT l.relativePath, f.fileType, f.source, f.fileSizeBytes,
               l.chunkCount, l.conversionStatus
        FROM doc_mount_file_links l
        JOIN doc_mount_files f ON f.id = l.fileId
        WHERE l.mountPointId = ?
        ORDER BY l.relativePath
      `).all(mount.id);
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
    SELECT l.fileId, f.source, f.fileType
    FROM doc_mount_file_links l
    JOIN doc_mount_files f ON f.id = l.fileId
    WHERE l.mountPointId = ? AND l.relativePath = ?
  `).get(mount.id, relativePath);

  if (!file) {
    console.error(`No file at ${relativePath} in mount ${mount.name}`);
    process.exit(1);
  }

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
      const doc = db.prepare(
        `SELECT content FROM doc_mount_documents WHERE fileId = ?`
      ).get(file.fileId);
      if (!doc) {
        console.error(`File row exists but no document content for ${relativePath}`);
        process.exit(1);
      }
      process.stdout.write(doc.content);
      return;
    }
    // Binary stored in doc_mount_blobs
    const blob = db.prepare(
      `SELECT data FROM doc_mount_blobs WHERE fileId = ?`
    ).get(file.fileId);
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

function readRendered(db, mount, relativePath) {
  // 1. Look up the link row (it carries extractedText now).
  const file = db.prepare(`
    SELECT l.id AS linkId, l.fileId, l.extractedText,
           f.source, f.fileType
    FROM doc_mount_file_links l
    JOIN doc_mount_files f ON f.id = l.fileId
    WHERE l.mountPointId = ? AND l.relativePath = ?
  `).get(mount.id, relativePath);

  if (!file) {
    console.error(`No file at ${relativePath} in mount ${mount.name}`);
    process.exit(1);
  }

  // 2. Extracted text on the link wins.
  if (file.extractedText) {
    process.stdout.write(file.extractedText);
    return;
  }

  // 3. Database-backed text doc — content IS the rendered form.
  if (file.source === 'database' && TEXT_FILE_TYPES.has(file.fileType)) {
    const doc = db.prepare(
      `SELECT content FROM doc_mount_documents WHERE fileId = ?`
    ).get(file.fileId);
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

  // 5. Fall back to concatenated chunks (now keyed by linkId).
  const chunks = db.prepare(`
    SELECT content FROM doc_mount_chunks
    WHERE linkId = ?
    ORDER BY chunkIndex
  `).all(file.linkId);
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
  try {
    const mount = requireMount(db, id);

    const files = db.prepare(`
      SELECT l.fileId, l.relativePath, f.source, f.fileType
      FROM doc_mount_file_links l
      JOIN doc_mount_files f ON f.id = l.fileId
      WHERE l.mountPointId = ?
      ORDER BY l.relativePath
    `).all(mount.id);

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
          const doc = db.prepare(
            `SELECT content FROM doc_mount_documents WHERE fileId = ?`
          ).get(file.fileId);
          if (!doc) {
            console.error(`${YELLOW}skip${RESET} ${file.relativePath} (no document content)`);
            continue;
          }
          fs.writeFileSync(dest, doc.content, 'utf8');
          writtenBytes += Buffer.byteLength(doc.content, 'utf8');
        } else {
          const blob = db.prepare(
            `SELECT data FROM doc_mount_blobs WHERE fileId = ?`
          ).get(file.fileId);
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
// Helpers shared by write/delete/mkdir/move/copy
// ----------------------------------------------------------------------------

function sha256OfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isConnectionRefused(err) {
  if (!err) return false;
  const code = err.cause && err.cause.code ? err.cause.code : err.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET'
  );
}

async function tryFetch(url, init) {
  try {
    return { ok: true, res: await fetch(url, init) };
  } catch (err) {
    if (isConnectionRefused(err)) {
      return { ok: false, err };
    }
    throw err;
  }
}

async function readBodyJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function actionUrl(port, mountId, action) {
  return `http://localhost:${port}/api/v1/mount-points/${encodeURIComponent(mountId)}?action=${action}`;
}

function unwrap(body) {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

// ----------------------------------------------------------------------------
// Direct (offline) helpers — filesystem-only fallback used when the server is
// unreachable. Database-mount writes always require the server because the
// index updates need the server's reindex / embed pipeline.
// ----------------------------------------------------------------------------

function requireServerForDb(mount, action) {
  if (mount.mountType === 'database') {
    console.error(
      `Cannot ${action} on database-backed mount "${mount.name}" without the Quilltap server.`
    );
    console.error('Start the server (`quilltap`) or pass --port to match a non-default port.');
    process.exit(1);
  }
}

function loadMountBasePath(db, mountId) {
  const row = db.prepare(
    'SELECT basePath FROM doc_mount_points WHERE id = ?'
  ).get(mountId);
  if (!row || !row.basePath) {
    throw new Error(`Mount ${mountId} has no basePath`);
  }
  return row.basePath;
}

function fsAbsolute(basePath, relativePath) {
  const abs = path.resolve(basePath, relativePath);
  const base = path.resolve(basePath);
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (abs !== base && !abs.startsWith(withSep)) {
    throw new Error(`Path escapes mount boundary: ${relativePath}`);
  }
  return abs;
}

// ----------------------------------------------------------------------------
// write
// ----------------------------------------------------------------------------

async function readWriteSource(filename) {
  if (filename) {
    const resolved = filename.startsWith('~')
      ? path.join(require('os').homedir(), filename.slice(1))
      : path.resolve(filename);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Source file not found: ${resolved}`);
    }
    return fs.readFileSync(resolved);
  }
  if (process.stdin.isTTY) {
    throw new Error('No source file given and stdin is a TTY. Pipe content or pass a filename.');
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    throw new Error('Empty stdin payload');
  }
  return Buffer.concat(chunks);
}

async function writeViaHttp(port, mountId, relativePath, data, force) {
  const form = new FormData();
  const blob = new Blob([data]);
  form.append('file', blob, path.posix.basename(relativePath));
  form.append('path', relativePath);
  form.append('force', force ? 'true' : 'false');
  const attempt = await tryFetch(actionUrl(port, mountId, 'write-file'), {
    method: 'POST',
    body: form,
  });
  if (!attempt.ok) return { reachable: false };
  const body = await readBodyJson(attempt.res);
  if (!attempt.res.ok) {
    const msg = body && body.error ? body.error : `HTTP ${attempt.res.status}`;
    const code = body && body.code ? body.code : null;
    return { reachable: true, ok: false, status: attempt.res.status, error: msg, code };
  }
  return { reachable: true, ok: true, result: unwrap(body) };
}

async function handleWrite(flags, positional) {
  const force = flags.force;
  const [mountSpec, relativePath, filename] = positional;
  if (!mountSpec || !relativePath) {
    console.error('Usage: quilltap docs write [--force] <mount> <path> [filename]');
    process.exit(1);
  }

  const data = await readWriteSource(filename);
  const sourceSha = sha256OfBuffer(data);

  const { db } = await openDb(flags);
  let mount;
  try {
    mount = requireMount(db, mountSpec);
  } finally {
    db.close();
  }

  const http = await writeViaHttp(flags.port, mount.id, relativePath, data, force);
  if (http.reachable) {
    if (!http.ok) {
      console.error(`Write failed: ${http.error}`);
      process.exit(http.code === 'DEST_EXISTS' ? 2 : 1);
    }
    const r = http.result;
    if (r.sha256 !== sourceSha) {
      console.error(`Checksum mismatch: source ${sourceSha} != dest ${r.sha256}`);
      process.exit(1);
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ...r, sourceSha256: sourceSha }, null, 2) + '\n');
      return;
    }
    console.log(`${GREEN}Wrote${RESET} ${mount.name}:${r.destPath} (${formatBytes(r.sizeBytes)}, sha=${r.sha256.slice(0, 12)}…)`);
    return;
  }

  // Direct fallback — filesystem mounts only.
  requireServerForDb(mount, 'write');

  const { db: db2 } = await openDb(flags);
  let basePath;
  try {
    basePath = loadMountBasePath(db2, mount.id);
  } finally {
    db2.close();
  }
  const abs = fsAbsolute(basePath, relativePath);
  if (fs.existsSync(abs) && !force) {
    console.error(`Destination already exists: ${relativePath}. Use --force to overwrite.`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  const destSha = sha256OfBuffer(fs.readFileSync(abs));
  if (destSha !== sourceSha) {
    console.error(`Checksum mismatch after write: source ${sourceSha} != dest ${destSha}`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({
      sha256: destSha,
      sourceSha256: sourceSha,
      sizeBytes: data.length,
      destPath: relativePath,
      mountPointId: mount.id,
      mode: 'direct',
    }, null, 2) + '\n');
    return;
  }
  console.log(`${GREEN}Wrote${RESET} ${mount.name}:${relativePath} (${formatBytes(data.length)}, sha=${destSha.slice(0, 12)}…) ${DIM}[direct mode — run 'quilltap docs scan' once the server is back]${RESET}`);
}

// ----------------------------------------------------------------------------
// delete
// ----------------------------------------------------------------------------

async function deleteViaHttp(port, mountId, relativePath) {
  const attempt = await tryFetch(actionUrl(port, mountId, 'delete-file'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relativePath }),
  });
  if (!attempt.ok) return { reachable: false };
  const body = await readBodyJson(attempt.res);
  if (!attempt.res.ok) {
    const msg = body && body.error ? body.error : `HTTP ${attempt.res.status}`;
    return { reachable: true, ok: false, status: attempt.res.status, error: msg };
  }
  return { reachable: true, ok: true, result: unwrap(body) };
}

async function handleDelete(flags, positional) {
  const [mountSpec, relativePath] = positional;
  if (!mountSpec || !relativePath) {
    console.error('Usage: quilltap docs delete <mount> <path>');
    process.exit(1);
  }

  const { db } = await openDb(flags);
  let mount;
  try {
    mount = requireMount(db, mountSpec);
  } finally {
    db.close();
  }

  const http = await deleteViaHttp(flags.port, mount.id, relativePath);
  if (http.reachable) {
    if (!http.ok) {
      console.error(`Delete failed: ${http.error}`);
      process.exit(1);
    }
    const r = http.result;
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    if (r.deleted) {
      console.log(`${GREEN}Deleted${RESET} ${mount.name}:${r.path}`);
    } else {
      console.log(`${DIM}No-op${RESET} ${mount.name}:${r.path} (did not exist)`);
    }
    return;
  }

  requireServerForDb(mount, 'delete');

  const { db: db2 } = await openDb(flags);
  let basePath;
  try {
    basePath = loadMountBasePath(db2, mount.id);
  } finally {
    db2.close();
  }
  const abs = fsAbsolute(basePath, relativePath);
  let existed = false;
  try {
    fs.unlinkSync(abs);
    existed = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (fs.existsSync(abs)) {
    console.error(`Delete verification failed: path still present at ${abs}`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({
      deleted: existed,
      path: relativePath,
      mountPointId: mount.id,
      mode: 'direct',
    }, null, 2) + '\n');
    return;
  }
  if (existed) {
    console.log(`${GREEN}Deleted${RESET} ${mount.name}:${relativePath} ${DIM}[direct mode]${RESET}`);
  } else {
    console.log(`${DIM}No-op${RESET} ${mount.name}:${relativePath} (did not exist) ${DIM}[direct mode]${RESET}`);
  }
}

// ----------------------------------------------------------------------------
// mkdir
// ----------------------------------------------------------------------------

async function mkdirViaHttp(port, mountId, relativePath) {
  const url = `http://localhost:${port}/api/v1/mount-points/${encodeURIComponent(mountId)}/folders`;
  const attempt = await tryFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relativePath }),
  });
  if (!attempt.ok) return { reachable: false };
  const body = await readBodyJson(attempt.res);
  if (!attempt.res.ok) {
    const msg = body && body.error ? body.error : `HTTP ${attempt.res.status}`;
    return { reachable: true, ok: false, status: attempt.res.status, error: msg };
  }
  return { reachable: true, ok: true, result: unwrap(body) };
}

async function handleMkdir(flags, positional) {
  const [mountSpec, relativePath] = positional;
  if (!mountSpec || !relativePath) {
    console.error('Usage: quilltap docs mkdir <mount> <path>');
    process.exit(1);
  }

  const { db } = await openDb(flags);
  let mount;
  try {
    mount = requireMount(db, mountSpec);
  } finally {
    db.close();
  }

  const http = await mkdirViaHttp(flags.port, mount.id, relativePath);
  if (http.reachable) {
    if (!http.ok) {
      console.error(`mkdir failed: ${http.error}`);
      process.exit(1);
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify(http.result, null, 2) + '\n');
      return;
    }
    console.log(`${GREEN}Folder ready${RESET} ${mount.name}:${http.result.path ?? relativePath}`);
    return;
  }

  requireServerForDb(mount, 'mkdir');

  const { db: db2 } = await openDb(flags);
  let basePath;
  try {
    basePath = loadMountBasePath(db2, mount.id);
  } finally {
    db2.close();
  }
  const abs = fsAbsolute(basePath, relativePath);
  fs.mkdirSync(abs, { recursive: true });
  if (!fs.existsSync(abs)) {
    console.error(`mkdir verification failed: ${abs} does not exist after creation`);
    process.exit(1);
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({
      path: relativePath,
      mountPointId: mount.id,
      mode: 'direct',
    }, null, 2) + '\n');
    return;
  }
  console.log(`${GREEN}Folder ready${RESET} ${mount.name}:${relativePath} ${DIM}[direct mode]${RESET}`);
}

// ----------------------------------------------------------------------------
// move / copy
// ----------------------------------------------------------------------------

async function fileOpViaHttp(port, action, sourceMountId, body) {
  const attempt = await tryFetch(actionUrl(port, sourceMountId, action), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!attempt.ok) return { reachable: false };
  const resBody = await readBodyJson(attempt.res);
  if (!attempt.res.ok) {
    const msg = resBody && resBody.error ? resBody.error : `HTTP ${attempt.res.status}`;
    const code = resBody && resBody.code ? resBody.code : null;
    return { reachable: true, ok: false, status: attempt.res.status, error: msg, code };
  }
  return { reachable: true, ok: true, result: unwrap(resBody) };
}

async function directFsFileOp({ flags, sourceMount, srcPath, destMount, dstPath, action, force }) {
  if (sourceMount.mountType === 'database' || destMount.mountType === 'database') {
    console.error(
      `Cannot ${action} between/with database-backed mounts without the Quilltap server.`
    );
    console.error('Start the server (`quilltap`) or pass --port to match a non-default port.');
    process.exit(1);
  }

  const { db } = await openDb(flags);
  let srcBase, dstBase;
  try {
    srcBase = loadMountBasePath(db, sourceMount.id);
    dstBase = loadMountBasePath(db, destMount.id);
  } finally {
    db.close();
  }
  const srcAbs = fsAbsolute(srcBase, srcPath);
  const dstAbs = fsAbsolute(dstBase, dstPath);

  if (!fs.existsSync(srcAbs)) {
    console.error(`Source not found: ${srcPath}`);
    process.exit(1);
  }
  if (fs.existsSync(dstAbs)) {
    if (action === 'copy' && !force) {
      console.error(`Destination already exists: ${dstPath}. Use --force to overwrite.`);
      process.exit(2);
    }
    if (action === 'move') {
      console.error(`Destination already exists: ${dstPath}. Move will not overwrite.`);
      process.exit(2);
    }
    fs.unlinkSync(dstAbs);
  }
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });

  const sourceSha = sha256OfBuffer(fs.readFileSync(srcAbs));
  let strategy;
  if (action === 'move') {
    try {
      fs.renameSync(srcAbs, dstAbs);
      strategy = 'rename';
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.copyFileSync(srcAbs, dstAbs);
      fs.unlinkSync(srcAbs);
      strategy = 'byte-copy';
    }
  } else if (force) {
    fs.copyFileSync(srcAbs, dstAbs);
    strategy = 'byte-copy';
  } else {
    try {
      fs.linkSync(srcAbs, dstAbs);
      strategy = 'fs-link';
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.copyFileSync(srcAbs, dstAbs);
      strategy = 'byte-copy';
    }
  }

  const destSha = sha256OfBuffer(fs.readFileSync(dstAbs));
  if (destSha !== sourceSha) {
    console.error(`Checksum mismatch after ${action}: ${sourceSha} != ${destSha}`);
    process.exit(1);
  }
  return {
    strategy,
    sourceSha256: sourceSha,
    destSha256: destSha,
    sizeBytes: fs.statSync(dstAbs).size,
    sourcePath: srcPath,
    destPath: dstPath,
    sourceMountPointId: sourceMount.id,
    destMountPointId: destMount.id,
    mode: 'direct',
  };
}

async function handleFileOp(flags, positional, action) {
  const [srcMountSpec, srcPath, dstMountSpec, dstPath] = positional;
  if (!srcMountSpec || !srcPath || !dstMountSpec || !dstPath) {
    const flagHint = action === 'copy' ? '[--force] ' : '';
    console.error(`Usage: quilltap docs ${action} ${flagHint}<srcMount> <srcPath> <dstMount> <dstPath>`);
    process.exit(1);
  }

  const { db } = await openDb(flags);
  let sourceMount, destMount;
  try {
    sourceMount = requireMount(db, srcMountSpec);
    destMount = requireMount(db, dstMountSpec);
  } finally {
    db.close();
  }

  const http = await fileOpViaHttp(flags.port, `${action}-file`, sourceMount.id, {
    sourcePath: srcPath,
    destMountPointId: destMount.id,
    destPath: dstPath,
    ...(action === 'copy' ? { force: !!flags.force } : {}),
  });
  if (http.reachable) {
    if (!http.ok) {
      console.error(`${action} failed: ${http.error}`);
      process.exit(http.code === 'DEST_EXISTS' ? 2 : 1);
    }
    const r = http.result;
    if (r.sourceSha256 !== r.destSha256) {
      console.error(`Checksum mismatch: source ${r.sourceSha256} != dest ${r.destSha256}`);
      process.exit(1);
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    const verb = action === 'move' ? 'Moved' : 'Copied';
    console.log(`${GREEN}${verb}${RESET} ${sourceMount.name}:${r.sourcePath} → ${destMount.name}:${r.destPath} ${DIM}(${r.strategy}, ${formatBytes(r.sizeBytes)}, sha=${r.destSha256.slice(0, 12)}…)${RESET}`);
    return;
  }

  const result = await directFsFileOp({
    flags,
    sourceMount,
    srcPath,
    destMount,
    dstPath,
    action,
    force: !!flags.force,
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  const verb = action === 'move' ? 'Moved' : 'Copied';
  console.log(`${GREEN}${verb}${RESET} ${sourceMount.name}:${result.sourcePath} → ${destMount.name}:${result.destPath} ${DIM}(${result.strategy}, ${formatBytes(result.sizeBytes)}, sha=${result.destSha256.slice(0, 12)}…) [direct mode — run 'quilltap docs scan' once the server is back]${RESET}`);
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
      case 'write':
        await handleWrite(flags, positional);
        break;
      case 'delete':
        await handleDelete(flags, positional);
        break;
      case 'mkdir':
        await handleMkdir(flags, positional);
        break;
      case 'move':
        await handleFileOp(flags, positional, 'move');
        break;
      case 'copy':
        await handleFileOp(flags, positional, 'copy');
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
