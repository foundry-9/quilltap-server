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

// Single-character markers for the `ls` "text" column:
//   =   raw bytes are already textual (markdown/txt/json/jsonl)
//   T   separately-extracted plaintext is stored on the link row
//   ~   extraction queued or in progress
//   !   extraction attempted and failed
//   -   no extracted text and the file is not text-native
function textColumnMarker(fileType, extractionStatus) {
  if (TEXT_FILE_TYPES.has(fileType)) return '=';
  switch (extractionStatus) {
    case 'converted': return 'T';
    case 'pending':   return '~';
    case 'failed':    return '!';
    case 'skipped':
    case 'none':
    default:          return '-';
  }
}

// Single-character markers for the `ls` "emb" column:
//   Y   every chunk on this file has an embedding
//   ~   chunks exist but none / only some have an embedding (queued or partial)
//   -   no chunks at all
function embedColumnMarker(chunkCount, embeddedChunkCount) {
  if (!chunkCount) return '-';
  if (embeddedChunkCount === chunkCount) return 'Y';
  return '~';
}

function printDocsHelp() {
  console.log(`
Quilltap Document Store Tool

Usage: quilltap docs <subcommand> [options]

Read subcommands:
  list                                   List all mount points
  show <mount>                           Details for one mount point
  files <mount> [--folder <path>]        List files in a mount
  ls|dir <mount> [path] [--links]        ls-style listing of one folder (or file)
  read <mount> <relativePath>            Print file contents to stdout
  read --rendered <mount> <relativePath> Print extracted plaintext to stdout
  export <mount> <outputDir>             Export an entire mount to a directory
  scan <mount>                           Trigger a rescan via the running server
  find [--mount <name|id|all>] [--type file|folder] [--ext <ext>] [--limit N] <pattern>
                                         Substring search on file (or folder) names
  grep [--mount <name|id|all>] [--ignore-case] [-l] [--max N] [--context N] <pattern>
                                         Substring search inside extracted text
  status [--mount <name|id>] [--top N]   Per-mount extraction + embedding rollup

Server-required subcommands (background-job queue lives in the running server):
  reindex <mount> [path] [--force]       Re-extract text + re-chunk affected files
  embed <mount> [path] [--force] [--wait]
                                         Enqueue embedding jobs for un-embedded chunks

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
  --links                   For 'ls' / 'dir': under each file with more than
                            one hard link, list the other mount/path entries
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
  quilltap docs ls notes
  quilltap docs ls notes 2026/may --links
  quilltap docs dir notes today.md --json
  quilltap docs write notes today.md < draft.md
  quilltap docs write --force notes today.md draft.md
  quilltap docs delete notes today.md
  quilltap docs mkdir notes 2026/may
  quilltap docs move drafts foo.md notes 2026/foo.md
  quilltap docs copy notes today.md archive 2026-05/today.md
  quilltap docs copy --force notes today.md archive copy.md
  quilltap docs find Manifesto
  quilltap docs find --mount notes --ext md Knowledge
  quilltap docs grep --mount notes --ignore-case "five-point Calvinist"
  quilltap docs grep --mount notes -l "TODO"
  quilltap docs status
  quilltap docs status --mount notes --top 10
  quilltap docs reindex notes Knowledge --force
  quilltap docs embed notes --wait
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
    links: false,
    help: false,
    // find / grep / reindex / embed / status flags
    mount: '',
    type: '',
    ext: '',
    limit: 0,
    max: 0,
    context: 0,
    top: -1,
    ignoreCase: false,
    pathsOnly: false,
    wait: false,
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
      case '--links': flags.links = true; break;
      case '--mount': flags.mount = args[++i]; break;
      case '--type': flags.type = args[++i]; break;
      case '--ext': flags.ext = args[++i]; break;
      case '--limit': flags.limit = parseInt(args[++i], 10) || 0; break;
      case '--max': flags.max = parseInt(args[++i], 10) || 0; break;
      case '--context': flags.context = parseInt(args[++i], 10) || 0; break;
      case '--top': {
        const n = parseInt(args[++i], 10);
        flags.top = isNaN(n) ? -1 : n;
        break;
      }
      case '--ignore-case': flags.ignoreCase = true; break;
      case '-l': flags.pathsOnly = true; break;
      case '--wait': flags.wait = true; break;
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
// ls / dir
// ----------------------------------------------------------------------------

function normalizeLsPath(p) {
  if (!p) return '';
  // Strip leading/trailing slashes; treat '.' and '/' as root.
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  if (trimmed === '.' || trimmed === '') return '';
  return trimmed;
}

function formatLsDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LS_FILE_COLUMNS = `
  l.id AS linkId, l.fileId, l.relativePath, l.fileName, l.lastModified,
  l.extractionStatus, l.extractedTextSha256, l.chunkCount,
  f.fileType, f.fileSizeBytes, f.source, f.sha256,
  (SELECT COUNT(*) FROM doc_mount_file_links WHERE fileId = l.fileId) AS linkCount,
  (SELECT COUNT(*) FROM doc_mount_chunks
    WHERE linkId = l.id AND embedding IS NOT NULL) AS embeddedChunkCount
`;

function resolveLsTarget(db, mountId, normalizedPath) {
  if (!normalizedPath) return { kind: 'root', path: '' };

  // Exact file match wins — handles the single-file display mode.
  const file = db.prepare(`
    SELECT ${LS_FILE_COLUMNS}
    FROM doc_mount_file_links l
    JOIN doc_mount_files f ON f.id = l.fileId
    WHERE l.mountPointId = ? AND l.relativePath = ?
  `).get(mountId, normalizedPath);
  if (file) return { kind: 'file', file };

  // Explicit folder row.
  const folder = db.prepare(
    `SELECT id, name, path, parentId, createdAt, updatedAt
     FROM doc_mount_folders WHERE mountPointId = ? AND path = ?`
  ).get(mountId, normalizedPath);
  if (folder) return { kind: 'folder', folder, path: normalizedPath };

  // Implicit folder — files or subfolders live under this path even though
  // no doc_mount_folders row exists for it (or the folderId on links is
  // null due to upstream drift). Mirrors how `docs files --folder` matches.
  const hasFiles = db.prepare(`
    SELECT 1 FROM doc_mount_file_links
    WHERE mountPointId = ? AND relativePath LIKE ? LIMIT 1
  `).get(mountId, normalizedPath + '/%');
  const hasFolders = db.prepare(`
    SELECT 1 FROM doc_mount_folders
    WHERE mountPointId = ? AND path LIKE ? LIMIT 1
  `).get(mountId, normalizedPath + '/%');
  if (hasFiles || hasFolders) return { kind: 'folder', folder: null, path: normalizedPath };

  return { kind: 'none' };
}

function fetchLsRows(db, mountId, parentPath) {
  // parentPath: '' = mount root, else "Knowledge" or "foo/bar" etc.
  // We filter by path-prefix rather than folderId / parentId so we stay
  // honest about what the filesystem (or docs read/files) actually sees,
  // even when folderId on a link row drifts to NULL behind our back.
  const folders = parentPath === ''
    ? db.prepare(`
        SELECT id, name, path, createdAt, updatedAt
        FROM doc_mount_folders
        WHERE mountPointId = ?
          AND path NOT LIKE '%/%'
        ORDER BY name COLLATE NOCASE
      `).all(mountId)
    : db.prepare(`
        SELECT id, name, path, createdAt, updatedAt
        FROM doc_mount_folders
        WHERE mountPointId = ?
          AND path LIKE ?
          AND path NOT LIKE ?
        ORDER BY name COLLATE NOCASE
      `).all(mountId, parentPath + '/%', parentPath + '/%/%');

  const files = parentPath === ''
    ? db.prepare(`
        SELECT ${LS_FILE_COLUMNS}
        FROM doc_mount_file_links l
        JOIN doc_mount_files f ON f.id = l.fileId
        WHERE l.mountPointId = ?
          AND l.relativePath NOT LIKE '%/%'
        ORDER BY l.fileName COLLATE NOCASE
      `).all(mountId)
    : db.prepare(`
        SELECT ${LS_FILE_COLUMNS}
        FROM doc_mount_file_links l
        JOIN doc_mount_files f ON f.id = l.fileId
        WHERE l.mountPointId = ?
          AND l.relativePath LIKE ?
          AND l.relativePath NOT LIKE ?
        ORDER BY l.fileName COLLATE NOCASE
      `).all(mountId, parentPath + '/%', parentPath + '/%/%');

  return { folders, files };
}

function fetchLinksForFiles(db, fileIds) {
  if (fileIds.length === 0) return new Map();
  const placeholders = fileIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT l.fileId, l.relativePath, l.mountPointId, m.name AS mountName
    FROM doc_mount_file_links l
    JOIN doc_mount_points m ON m.id = l.mountPointId
    WHERE l.fileId IN (${placeholders})
    ORDER BY m.name COLLATE NOCASE, l.relativePath COLLATE NOCASE
  `).all(...fileIds);
  const byFile = new Map();
  for (const r of rows) {
    if (!byFile.has(r.fileId)) byFile.set(r.fileId, []);
    byFile.get(r.fileId).push({
      mountPointId: r.mountPointId,
      mountName: r.mountName,
      relativePath: r.relativePath,
    });
  }
  return byFile;
}

async function handleLs(flags, mountSpec, rawPath) {
  if (!mountSpec) {
    console.error('Usage: quilltap docs ls <mount> [path] [--links]');
    process.exit(1);
  }
  const { db } = await openDb(flags);
  try {
    const mount = requireMount(db, mountSpec);
    const normalizedPath = normalizeLsPath(rawPath);
    const target = resolveLsTarget(db, mount.id, normalizedPath);

    let folders = [];
    let files = [];
    let singleFile = false;

    if (target.kind === 'none') {
      console.error(`No file or folder at "${normalizedPath || '/'}" in mount ${mount.name}`);
      process.exit(1);
    } else if (target.kind === 'root') {
      ({ folders, files } = fetchLsRows(db, mount.id, ''));
    } else if (target.kind === 'folder') {
      ({ folders, files } = fetchLsRows(db, mount.id, target.path));
    } else {
      // Single-file mode: just show this one entry. linkCount / embeddedChunkCount
      // are already populated by LS_FILE_COLUMNS via resolveLsTarget.
      files = [target.file];
      singleFile = true;
    }

    // Always fetch links for JSON; for text, only when --links was passed.
    const wantLinks = flags.json || flags.links;
    const multiLinkFileIds = wantLinks
      ? files.filter((f) => f.linkCount > 1).map((f) => f.fileId)
      : [];
    const linksByFile = fetchLinksForFiles(db, multiLinkFileIds);

    if (flags.json) {
      const out = [];
      for (const folder of folders) {
        out.push({
          type: 'folder',
          name: folder.name,
          path: folder.path,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
        });
      }
      for (const file of files) {
        const others = linksByFile.get(file.fileId);
        const links = others && others.length > 0
          ? others
          : [{
              mountPointId: mount.id,
              mountName: mount.name,
              relativePath: file.relativePath,
            }];
        out.push({
          type: 'file',
          name: file.fileName,
          relativePath: file.relativePath,
          fileType: file.fileType,
          source: file.source,
          fileSizeBytes: file.fileSizeBytes,
          sha256: file.sha256,
          lastModified: file.lastModified,
          linkCount: file.linkCount,
          textRepresentation: {
            kind: TEXT_FILE_TYPES.has(file.fileType) ? 'inline' : 'extracted',
            extractionStatus: file.extractionStatus,
            hasExtractedText: !!file.extractedTextSha256,
          },
          embedding: {
            chunkCount: file.chunkCount || 0,
            embeddedChunkCount: file.embeddedChunkCount || 0,
            fullyEmbedded: (file.chunkCount || 0) > 0
              && file.chunkCount === file.embeddedChunkCount,
          },
          links,
        });
      }
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }

    if (!singleFile && folders.length === 0 && files.length === 0) {
      console.log('(empty)');
      return;
    }

    // Header line so the columns are self-describing.
    const headerRow = {
      type: 'T',
      links: 'links',
      size: 'size',
      modified: 'modified',
      text: 'text',
      emb: 'emb',
      name: 'name',
      isHeader: true,
    };
    const dataRows = [];
    for (const folder of folders) {
      dataRows.push({
        type: 'd',
        links: '-',
        size: '-',
        modified: formatLsDate(folder.updatedAt || folder.createdAt),
        text: '-',
        emb: '-',
        name: folder.name + '/',
      });
    }
    for (const file of files) {
      dataRows.push({
        type: '-',
        links: String(file.linkCount),
        size: formatBytes(file.fileSizeBytes || 0),
        modified: formatLsDate(file.lastModified),
        text: textColumnMarker(file.fileType, file.extractionStatus),
        emb: embedColumnMarker(file.chunkCount, file.embeddedChunkCount),
        name: singleFile ? file.relativePath : file.fileName,
        fileId: file.fileId,
        relativePath: file.relativePath,
      });
    }

    const widths = {
      type: 1,
      links: Math.max(headerRow.links.length, ...dataRows.map((r) => r.links.length)),
      size: Math.max(headerRow.size.length, ...dataRows.map((r) => r.size.length)),
      modified: Math.max(headerRow.modified.length, ...dataRows.map((r) => r.modified.length)),
      text: Math.max(headerRow.text.length, ...dataRows.map((r) => r.text.length)),
      emb: Math.max(headerRow.emb.length, ...dataRows.map((r) => r.emb.length)),
    };

    const renderLine = (r, dim) => {
      const cells = [
        r.type,
        r.links.padStart(widths.links),
        r.size.padStart(widths.size),
        r.modified.padEnd(widths.modified),
        r.text.padStart(widths.text),
        r.emb.padStart(widths.emb),
        r.name,
      ];
      const line = cells.join('  ');
      return dim ? `${DIM}${line}${RESET}` : line;
    };

    console.log(renderLine(headerRow, true));
    for (const r of dataRows) {
      console.log(renderLine(r, false));
      if (flags.links && r.type === '-') {
        const others = (linksByFile.get(r.fileId) || []).filter(
          (l) => !(l.mountPointId === mount.id && l.relativePath === r.relativePath)
        );
        if (others.length > 0) {
          // Indent past type+links+size+modified+text+emb columns
          // (6 cells, 5 separators of 2 spaces each).
          const indentWidth = widths.type + widths.links + widths.size
            + widths.modified + widths.text + widths.emb + 6 * 2;
          const indent = ' '.repeat(indentWidth);
          for (const link of others) {
            const sameMount = link.mountPointId === mount.id;
            const display = sameMount ? link.relativePath : `${link.mountName}:${link.relativePath}`;
            console.log(`${indent}${DIM}→ ${display}${RESET}`);
          }
        }
      }
    }
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

// ----------------------------------------------------------------------------
// find — substring search on relativePath
// ----------------------------------------------------------------------------

function escapeLike(s) {
  // SQLite LIKE uses % and _ as wildcards; we treat the pattern as a substring
  // literal so the user's % / _ don't have surprise semantics.
  return s.replace(/[%_\\]/g, ch => '\\' + ch);
}

function resolveSearchMounts(db, mountSpec) {
  if (!mountSpec || mountSpec === 'all') {
    return db.prepare(
      `SELECT * FROM doc_mount_points ORDER BY name COLLATE NOCASE`
    ).all();
  }
  return [requireMount(db, mountSpec)];
}

async function handleFind(flags, positional) {
  const pattern = positional[0];
  if (!pattern) {
    console.error('Usage: quilltap docs find [--mount <name|id|all>] [--type file|folder] [--ext <ext>] [--limit N] [--json] <pattern>');
    process.exit(1);
  }
  const limit = flags.limit > 0 ? flags.limit : 100;
  const type = flags.type || 'file';
  if (type !== 'file' && type !== 'folder') {
    console.error(`Error: --type must be file or folder, got "${flags.type}"`);
    process.exit(1);
  }

  const { db } = await openDb(flags);
  try {
    const mounts = resolveSearchMounts(db, flags.mount);
    const showMountColumn = !flags.mount || flags.mount === 'all';

    const liked = `%${escapeLike(pattern)}%`;

    const out = [];
    if (type === 'file') {
      // LIKE is case-insensitive on NOCASE collation; use COLLATE NOCASE on
      // the comparison to make match independent of stored case.
      const stmt = db.prepare(`
        SELECT l.relativePath, l.lastModified, l.updatedAt,
               f.fileSizeBytes, f.fileType
        FROM doc_mount_file_links l
        JOIN doc_mount_files f ON f.id = l.fileId
        WHERE l.mountPointId = ?
          AND l.relativePath LIKE ? ESCAPE '\\' COLLATE NOCASE
        ORDER BY l.relativePath COLLATE NOCASE
      `);
      for (const mount of mounts) {
        const rows = stmt.all(mount.id, liked);
        for (const r of rows) {
          if (flags.ext) {
            const ext = flags.ext.startsWith('.') ? flags.ext.slice(1) : flags.ext;
            if (!r.relativePath.toLowerCase().endsWith('.' + ext.toLowerCase())) continue;
          }
          out.push({
            mount: { id: mount.id, name: mount.name },
            kind: 'file',
            relativePath: r.relativePath,
            size: r.fileSizeBytes,
            fileType: r.fileType,
            lastModified: r.lastModified,
            updatedAt: r.updatedAt,
          });
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
    } else {
      // folder search (database-backed mounts only — doc_mount_folders is
      // populated by the database scan path; filesystem mounts derive
      // hierarchy from the OS at request time).
      const stmt = db.prepare(`
        SELECT path, name, updatedAt
        FROM doc_mount_folders
        WHERE mountPointId = ?
          AND path LIKE ? ESCAPE '\\' COLLATE NOCASE
        ORDER BY path COLLATE NOCASE
      `);
      for (const mount of mounts) {
        const rows = stmt.all(mount.id, liked);
        for (const r of rows) {
          out.push({
            mount: { id: mount.id, name: mount.name },
            kind: 'folder',
            relativePath: r.path,
            name: r.name,
            updatedAt: r.updatedAt,
          });
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
    }

    if (flags.json) {
      process.stdout.write(JSON.stringify({ pattern, type, results: out }, null, 2) + '\n');
      return;
    }
    if (out.length === 0) {
      console.log('(no matches)');
      return;
    }
    // Plain text columns.
    const headers = showMountColumn
      ? ['mount', 'path', 'size', 'modified']
      : ['path', 'size', 'modified'];
    const rows = out.map(r => {
      const size = r.size != null ? formatBytes(r.size) : '-';
      const mod = r.lastModified || r.updatedAt || '';
      return showMountColumn
        ? [r.mount.name, r.relativePath, size, mod]
        : [r.relativePath, size, mod];
    });
    printColumnar(headers, rows);
    if (out.length >= limit) {
      console.log(`${DIM}(limit ${limit} reached — use --limit to widen)${RESET}`);
    }
  } finally {
    db.close();
  }
}

function printColumnar(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] || '').length)));
  const fmt = (cols) => cols.map((c, i) => String(c || '').padEnd(widths[i])).join('  ');
  console.log(`${BOLD}${fmt(headers)}${RESET}`);
  for (const r of rows) console.log(fmt(r));
}

// ----------------------------------------------------------------------------
// grep — substring search inside extracted text
// ----------------------------------------------------------------------------

async function handleGrep(flags, positional) {
  const pattern = positional[0];
  if (!pattern) {
    console.error('Usage: quilltap docs grep [--mount <name|id|all>] [--ignore-case] [-l] [--max N] [--context N] [--json] <pattern>');
    process.exit(1);
  }
  const max = flags.max > 0 ? flags.max : 5;
  const contextLines = flags.context > 0 ? flags.context : 0;

  const { db } = await openDb(flags);
  try {
    const mounts = resolveSearchMounts(db, flags.mount);
    const showMountColumn = !flags.mount || flags.mount === 'all';

    const linksByMount = db.prepare(`
      SELECT l.id AS linkId, l.fileId, l.relativePath, l.extractedText,
             f.source, f.fileType
      FROM doc_mount_file_links l
      JOIN doc_mount_files f ON f.id = l.fileId
      WHERE l.mountPointId = ?
      ORDER BY l.relativePath COLLATE NOCASE
    `);
    const docStmt = db.prepare(`SELECT content FROM doc_mount_documents WHERE fileId = ?`);
    const chunkStmt = db.prepare(`SELECT content FROM doc_mount_chunks WHERE linkId = ? ORDER BY chunkIndex`);

    const needle = flags.ignoreCase ? pattern.toLowerCase() : pattern;

    const results = [];
    for (const mount of mounts) {
      const links = linksByMount.all(mount.id);
      for (const link of links) {
        const text = resolveTextForLink(db, mount, link, docStmt, chunkStmt);
        if (text == null || text.length === 0) continue;
        const haystack = flags.ignoreCase ? text.toLowerCase() : text;
        if (haystack.indexOf(needle) === -1) continue;

        const matches = [];
        if (!flags.pathsOnly) {
          const lines = text.split(/\r?\n/);
          for (let lineNum = 0; lineNum < lines.length && matches.length < max; lineNum++) {
            const hay = flags.ignoreCase ? lines[lineNum].toLowerCase() : lines[lineNum];
            if (hay.indexOf(needle) === -1) continue;
            let snippet = lines[lineNum];
            if (contextLines > 0) {
              const start = Math.max(0, lineNum - contextLines);
              const end = Math.min(lines.length, lineNum + contextLines + 1);
              snippet = lines.slice(start, end).join('\n');
            }
            matches.push({ line: lineNum + 1, snippet });
          }
        }
        results.push({
          mount: { id: mount.id, name: mount.name },
          relativePath: link.relativePath,
          matches,
        });
      }
    }

    if (flags.json) {
      process.stdout.write(JSON.stringify({ pattern, results }, null, 2) + '\n');
      return;
    }
    if (results.length === 0) {
      console.log('(no matches)');
      return;
    }

    for (const r of results) {
      const prefix = showMountColumn ? `${r.mount.name}:` : '';
      if (flags.pathsOnly) {
        console.log(`${prefix}${r.relativePath}`);
        continue;
      }
      for (const m of r.matches) {
        const oneLine = m.snippet.replace(/\n/g, ' ⏎ ');
        console.log(`${prefix}${r.relativePath}:${m.line}: ${oneLine}`);
      }
    }
  } finally {
    db.close();
  }
}

// Resolve text for a single link row using the same decision tree as
// readRendered — so grep sees everything the user can `docs read --rendered`.
function resolveTextForLink(db, mount, link, docStmt, chunkStmt) {
  if (link.extractedText) return link.extractedText;
  if (link.source === 'database' && TEXT_FILE_TYPES.has(link.fileType)) {
    const doc = docStmt.get(link.fileId);
    if (doc) return doc.content;
  }
  if (link.source === 'filesystem' && TEXT_FILE_TYPES.has(link.fileType)) {
    const fullPath = path.join(mount.basePath, link.relativePath);
    try {
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, 'utf8');
      }
    } catch { /* unreadable file — skip */ }
  }
  const chunks = chunkStmt.all(link.linkId);
  if (chunks.length > 0) return chunks.map(c => c.content).join('\n\n');
  return null;
}

// ----------------------------------------------------------------------------
// reindex / embed — server-required, talks to /api/v1/mount-points/[id]
// ----------------------------------------------------------------------------

async function callMountAction(port, mountId, action, body) {
  const url = `http://localhost:${port}/api/v1/mount-points/${encodeURIComponent(mountId)}?action=${action}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    return { reachable: false, error: err.message };
  }
  let text = '';
  let parsed = null;
  try {
    text = await res.text();
    parsed = text ? JSON.parse(text) : null;
  } catch { /* leave parsed null */ }
  if (!res.ok) {
    const msg = parsed && parsed.error ? parsed.error : `HTTP ${res.status}`;
    return { reachable: true, ok: false, status: res.status, error: msg };
  }
  return { reachable: true, ok: true, result: parsed && parsed.data ? parsed.data : parsed };
}

async function pollJob(port, jobId, opts = {}) {
  const intervalMs = opts.intervalMs || 1500;
  const timeoutMs = opts.timeoutMs || 0;
  const start = Date.now();
  while (true) {
    let res;
    try {
      res = await fetch(`http://localhost:${port}/api/v1/system/jobs/${encodeURIComponent(jobId)}`);
    } catch (err) {
      return { ok: false, error: `Unreachable while polling: ${err.message}` };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} polling job` };
    let body;
    try { body = await res.json(); } catch { body = null; }
    const job = body && (body.job || (body.data && body.data.job));
    if (!job) return { ok: false, error: 'Malformed job response' };
    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return { ok: true, terminal: true, job };
    }
    if (timeoutMs && Date.now() - start > timeoutMs) {
      return { ok: false, error: 'Polling timed out' };
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

async function handleReindex(flags, positional) {
  const mountSpec = positional[0];
  const pathArg = positional[1];
  if (!mountSpec) {
    console.error('Usage: quilltap docs reindex <mount> [path] [--force] [--json]');
    process.exit(1);
  }

  const { db } = await openDb(flags);
  let mount;
  try {
    mount = requireMount(db, mountSpec);
  } finally {
    db.close();
  }

  const http = await callMountAction(flags.port, mount.id, 'reindex', {
    path: pathArg,
    force: !!flags.force,
  });
  if (!http.reachable) {
    console.error(`Cannot reach Quilltap server at localhost:${flags.port}. The reindex action requires the running server (it owns the background job queue).`);
    console.error(`  ${http.error || ''}`);
    process.exit(1);
  }
  if (!http.ok) {
    console.error(`Reindex failed: ${http.error}`);
    process.exit(1);
  }

  const r = http.result;
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }
  console.log(`${BOLD}Reindex${RESET} ${mount.name}${pathArg ? `:${pathArg}` : ''}`);
  console.log(`  processed:  ${r.processed}`);
  console.log(`  succeeded:  ${r.succeeded}`);
  console.log(`  failed:     ${r.failed}`);
  console.log(`  skipped:    ${r.skipped}`);
  if (r.errors && r.errors.length > 0) {
    console.log(`  errors:`);
    for (const e of r.errors.slice(0, 10)) {
      console.log(`    ${e.relativePath}: ${e.error}`);
    }
    if (r.errors.length > 10) {
      console.log(`    … ${r.errors.length - 10} more`);
    }
  }
}

async function handleEmbed(flags, positional) {
  const mountSpec = positional[0];
  const pathArg = positional[1];
  if (!mountSpec) {
    console.error('Usage: quilltap docs embed <mount> [path] [--force] [--wait] [--json]');
    process.exit(1);
  }

  const { db } = await openDb(flags);
  let mount;
  try {
    mount = requireMount(db, mountSpec);
  } finally {
    db.close();
  }

  const http = await callMountAction(flags.port, mount.id, 'embed', {
    path: pathArg,
    force: !!flags.force,
  });
  if (!http.reachable) {
    console.error(`Cannot reach Quilltap server at localhost:${flags.port}. The embed action requires the running server (it owns the background job queue).`);
    console.error(`  ${http.error || ''}`);
    process.exit(1);
  }
  if (!http.ok) {
    console.error(`Embed failed: ${http.error}`);
    process.exit(1);
  }

  const r = http.result;
  if (!flags.wait) {
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      return;
    }
    console.log(`${BOLD}Embed${RESET} ${mount.name}${pathArg ? `:${pathArg}` : ''}`);
    console.log(`  queued:   ${r.queued}`);
    console.log(`  skipped:  ${r.skipped}`);
    if (r.jobs && r.jobs.length > 0 && r.jobs.length <= 5) {
      console.log(`  jobs:`);
      for (const j of r.jobs) console.log(`    ${j.id}  (${j.status})`);
    } else if (r.jobs && r.jobs.length > 5) {
      console.log(`  jobs:    ${r.jobs.length} queued (use --json for ids)`);
    }
    return;
  }

  // --wait: poll each job to terminal status.
  const jobs = r.jobs || [];
  if (jobs.length === 0) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ...r, waited: true, completed: 0, failed: 0 }, null, 2) + '\n');
    } else {
      console.log('No jobs queued.');
    }
    return;
  }
  console.log(`Waiting on ${jobs.length} job${jobs.length === 1 ? '' : 's'}…`);
  let done = 0;
  let failed = 0;
  for (const j of jobs) {
    const poll = await pollJob(flags.port, j.id);
    if (!poll.ok) {
      console.error(`Job ${j.id}: ${poll.error}`);
      failed++;
      continue;
    }
    if (poll.job.status === 'COMPLETED') done++;
    else failed++;
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ...r, waited: true, completed: done, failed }, null, 2) + '\n');
  } else {
    console.log(`Embed done: ${done} completed, ${failed} failed.`);
  }
  if (failed > 0) process.exit(1);
}

// ----------------------------------------------------------------------------
// status
// ----------------------------------------------------------------------------

async function handleStatus(flags) {
  const { db } = await openDb(flags);
  try {
    // Resolve target mounts: --mount narrows; default is all.
    let mounts;
    if (flags.mount) {
      mounts = [requireMount(db, flags.mount)];
    } else {
      mounts = db.prepare(
        `SELECT * FROM doc_mount_points ORDER BY name COLLATE NOCASE`
      ).all();
    }

    const topN = flags.top >= 0 ? flags.top : 5;

    // Per-mount aggregates.
    const extractionGroupByStatus = db.prepare(
      `SELECT extractionStatus, COUNT(*) AS n FROM doc_mount_file_links WHERE mountPointId = ? GROUP BY extractionStatus`
    );
    const textNativeCount = db.prepare(
      `SELECT COUNT(*) AS n
       FROM doc_mount_file_links l
       JOIN doc_mount_files f ON f.id = l.fileId
       WHERE l.mountPointId = ? AND f.fileType IN ('markdown', 'txt', 'json', 'jsonl')`
    );
    const nonTextLinkCount = db.prepare(
      `SELECT COUNT(*) AS n
       FROM doc_mount_file_links l
       JOIN doc_mount_files f ON f.id = l.fileId
       WHERE l.mountPointId = ? AND f.fileType NOT IN ('markdown', 'txt', 'json', 'jsonl')`
    );
    const chunkAgg = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded
       FROM doc_mount_chunks WHERE mountPointId = ?`
    );
    const oldestExtraction = db.prepare(
      `SELECT l.relativePath, l.updatedAt, l.extractionStatus, l.extractionError
       FROM doc_mount_file_links l
       WHERE l.mountPointId = ? AND l.extractionStatus = ?
       ORDER BY l.updatedAt ASC
       LIMIT ?`
    );

    const report = [];
    for (const mount of mounts) {
      const statusRows = extractionGroupByStatus.all(mount.id);
      const byStatus = {};
      for (const r of statusRows) byStatus[r.extractionStatus] = r.n;
      const textNative = (textNativeCount.get(mount.id) || { n: 0 }).n;
      const nonText = (nonTextLinkCount.get(mount.id) || { n: 0 }).n;
      // converted/pending/failed counts apply to non-text-native files only.
      const extracted = byStatus['converted'] || 0;
      const extractionPending = byStatus['pending'] || 0;
      const extractionFailed = byStatus['failed'] || 0;
      const extractionSkipped = byStatus['skipped'] || 0;
      const extractionNone = byStatus['none'] || 0;

      const chunkRow = chunkAgg.get(mount.id) || { total: 0, embedded: 0 };
      const totalChunks = chunkRow.total || 0;
      const embeddedChunks = chunkRow.embedded || 0;
      const embeddingPending = Math.max(0, totalChunks - embeddedChunks);

      const oldestPending = topN > 0 ? oldestExtraction.all(mount.id, 'pending', topN) : [];
      const oldestFailed = topN > 0 ? oldestExtraction.all(mount.id, 'failed', topN) : [];

      report.push({
        mount: { id: mount.id, name: mount.name, mountType: mount.mountType, basePath: mount.basePath },
        files: {
          'text-native': textNative,
          extracted,
          'extraction-pending': extractionPending,
          'extraction-failed': extractionFailed,
          'extraction-skipped': extractionSkipped,
          'extraction-none': extractionNone,
          'non-text-total': nonText,
        },
        chunks: {
          total: totalChunks,
          embedded: embeddedChunks,
          'embedding-pending': embeddingPending,
        },
        oldestPendingExtractions: oldestPending,
        oldestFailedExtractions: oldestFailed,
      });
    }

    if (flags.json) {
      process.stdout.write(JSON.stringify({ mounts: report }, null, 2) + '\n');
      return;
    }

    // Human text output.
    for (let i = 0; i < report.length; i++) {
      if (i > 0) console.log('');
      const r = report[i];
      console.log(`${BOLD}Mount: ${r.mount.name}${RESET}  ${DIM}(${r.mount.id})${RESET}`);
      console.log('  Files');
      console.log(`    text-native:         ${String(r.files['text-native']).padStart(7)}`);
      console.log(`    extracted:           ${String(r.files.extracted).padStart(7)}`);
      console.log(`    extraction-pending:  ${String(r.files['extraction-pending']).padStart(7)}`);
      console.log(`    extraction-failed:   ${String(r.files['extraction-failed']).padStart(7)}`);
      if (r.files['extraction-skipped']) {
        console.log(`    extraction-skipped:  ${String(r.files['extraction-skipped']).padStart(7)}`);
      }
      console.log('  Chunks');
      console.log(`    total:               ${String(r.chunks.total).padStart(7)}`);
      console.log(`    embedded:            ${String(r.chunks.embedded).padStart(7)}`);
      console.log(`    embedding-pending:   ${String(r.chunks['embedding-pending']).padStart(7)}`);
      if (r.oldestPendingExtractions.length > 0) {
        console.log('  Oldest pending extractions:');
        for (const row of r.oldestPendingExtractions) {
          console.log(`    ${row.relativePath}  ${DIM}queued ${row.updatedAt}${RESET}`);
        }
      }
      if (r.oldestFailedExtractions.length > 0) {
        console.log('  Oldest failed extractions:');
        for (const row of r.oldestFailedExtractions) {
          const reason = row.extractionError ? `  ("${truncateSnippet(row.extractionError, 60)}")` : '';
          console.log(`    ${row.relativePath}  ${DIM}failed ${row.updatedAt}${RESET}${reason}`);
        }
      }
    }
  } finally {
    db.close();
  }
}

function truncateSnippet(s, n) {
  if (s == null) return '';
  const str = String(s).replace(/\s+/g, ' ');
  if (str.length <= n) return str;
  return str.slice(0, n) + '…';
}

async function docsCommand(args) {
  if (args.length === 0) {
    printDocsHelp();
    process.exit(1);
  }

  const { flags, positional } = parseFlags(args);

  if (flags.help) {
    printDocsHelp();
    process.exit(0);
  }

  if (positional.length === 0) {
    printDocsHelp();
    process.exit(1);
  }

  const verb = positional.shift();

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
      case 'ls':
      case 'dir':
        await handleLs(flags, positional[0], positional[1]);
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
      case 'status':
        await handleStatus(flags);
        break;
      case 'find':
        await handleFind(flags, positional);
        break;
      case 'grep':
        await handleGrep(flags, positional);
        break;
      case 'reindex':
        await handleReindex(flags, positional);
        break;
      case 'embed':
        await handleEmbed(flags, positional);
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
