/**
 * Theme bundle archives: inspect, extract, validate and pack `.qtap-theme`
 * files and bundle directories.
 *
 * This is the one routine for a bundle's archive, shared by the app's loader
 * (`./bundle-loader.ts`, which adds the install index on top) and the
 * `quilltap themes` CLI (bundled into `packages/quilltap/lib/` by
 * `scripts/build-cli-theme-engine.mjs`). Every entry is extracted through
 * `resolveInsideSync`, symbolic links are refused, and the document itself is
 * validated by the theme engine through `loadThemeFromDir`.
 *
 * @module themes/bundle-archive
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import yauzl from 'yauzl';
import { logger } from '@/lib/logger';
import { resolveInside, resolveInsideSync } from '@/lib/paths/resolve-inside';
import { getErrorMessage } from '@/lib/error-utils';
import { isBundleRelativePath } from './bundle-paths';
import { listBundleFiles, loadThemeFromDir, ThemeBundleError } from './theme-bundle';
import { refusalForManifest, type RefusedTheme } from './refused';
import type { ThemeManifest } from './engine/document';
import { ThemeManifestSchema } from './engine/document';

const archiveLogger = logger.child({ module: 'theme-bundle-archive' });

// ============================================================================
// LIMITS
// ============================================================================

export const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB total
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
export const MAX_FILE_COUNT = 200;

const ALLOWED_EXTENSIONS = new Set([
  '.json', '.css',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.txt', '.md', '.license',
]);

const BLOCKED_EXTENSIONS = new Set([
  '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx',
  '.wasm', '.sh', '.bash', '.bat', '.cmd', '.ps1', '.exe',
  '.dll', '.so', '.dylib', '.py', '.rb', '.php',
]);

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  manifest?: ThemeManifest;
  /** Set when the bundle was made for an earlier Quilltap. */
  refused?: RefusedTheme;
  errors: string[];
  warnings: string[];
  fileCount: number;
  totalSize: number;
}

// ============================================================================
// ZIP UTILITIES
// ============================================================================

interface ZipEntry {
  fileName: string;
  uncompressedSize: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

/**
 * Whether a zip entry is a symbolic link: its Unix mode, in the high half of
 * the external attributes, says S_IFLNK. Theme bundles never carry links.
 */
function isSymlinkEntry(entry: yauzl.Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err) reject(err);
      else resolve(zipFile!);
    });
  });
}

function readZipEntries(zipFile: yauzl.ZipFile): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ZipEntry[] = [];
    zipFile.readEntry();
    zipFile.on('entry', (entry: yauzl.Entry) => {
      entries.push({
        fileName: entry.fileName,
        uncompressedSize: entry.uncompressedSize,
        isDirectory: /\/$/.test(entry.fileName),
        isSymlink: isSymlinkEntry(entry),
      });
      zipFile.readEntry();
    });
    zipFile.on('end', () => resolve(entries));
    zipFile.on('error', reject);
  });
}

function extractZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, readStream) => {
      if (err) {
        reject(err);
        return;
      }
      const chunks: Buffer[] = [];
      readStream!.on('data', (chunk: Buffer) => chunks.push(chunk));
      readStream!.on('end', () => resolve(Buffer.concat(chunks)));
      readStream!.on('error', reject);
    });
  });
}

/** Read one named file's bytes out of a zip without extracting the rest. */
async function readZipFile(zipPath: string, fileName: string): Promise<Buffer | null> {
  const zipFile = await openZip(zipPath);
  try {
    return await new Promise<Buffer | null>((resolve, reject) => {
      let found = false;
      zipFile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== fileName) {
          zipFile.readEntry();
          return;
        }
        found = true;
        extractZipEntry(zipFile, entry).then(resolve, reject);
      });
      zipFile.on('end', () => {
        if (!found) resolve(null);
      });
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
}

/**
 * Extract every entry of a zip into `destDir`. Each entry must resolve inside
 * `destDir` (realpath-aware, so a directory link planted earlier cannot carry
 * a later entry out), and a symbolic link entry is refused.
 */
async function extractZipToDir(zipPath: string, destDir: string): Promise<void> {
  const zipFile = await openZip(zipPath);

  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.readEntry();
      zipFile.on('entry', async (entry: yauzl.Entry) => {
        try {
          let entryPath: string;
          try {
            entryPath = resolveInsideSync(destDir, entry.fileName, { realpath: true });
          } catch {
            archiveLogger.warn('Refusing theme bundle entry outside the extraction directory', { entry: entry.fileName });
            reject(new Error(`Path traversal detected: ${entry.fileName}`));
            return;
          }

          if (isSymlinkEntry(entry)) {
            archiveLogger.warn('Refusing symbolic link in theme bundle', { entry: entry.fileName });
            reject(new Error(`Symbolic links are not allowed in theme bundles: ${entry.fileName}`));
            return;
          }

          if (/\/$/.test(entry.fileName)) {
            await fs.mkdir(entryPath, { recursive: true });
          } else {
            await fs.mkdir(path.dirname(entryPath), { recursive: true });
            await fs.writeFile(entryPath, await extractZipEntry(zipFile, entry));
          }
          zipFile.readEntry();
        } catch (err) {
          reject(err);
        }
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });
  } finally {
    zipFile.close();
  }
}

// ============================================================================
// SHARED CHECKS
// ============================================================================

/** The per-file rules: a path inside the bundle, a size limit, a permitted type. */
function checkBundleFile(fileName: string, size: number, errors: string[], warnings: string[]): void {
  if (!isBundleRelativePath(fileName)) {
    errors.push(`Unsafe path detected: ${fileName}`);
    return;
  }
  if (size > MAX_FILE_SIZE) {
    errors.push(`File ${fileName} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }
  const ext = path.extname(fileName).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    errors.push(`Blocked file type: ${fileName} (${ext} files are not allowed)`);
  } else if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    warnings.push(`Unrecognized file type: ${fileName} (${ext})`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Validate a bundle directory whose theme.json has been read: refuse an
 * earlier format, check the manifest, then validate the whole document with
 * the engine. Errors and warnings are appended to the arrays given.
 */
async function validateExtracted(
  dir: string,
  manifestJson: unknown,
  fallbackId: string,
  errors: string[],
  warnings: string[]
): Promise<{ manifest?: ThemeManifest; refused?: RefusedTheme }> {
  const refused = refusalForManifest(manifestJson, fallbackId);
  if (refused) {
    archiveLogger.info('Refusing a theme bundle made for an earlier Quilltap', { dir, themeId: refused.id, version: refused.version });
    errors.push(refused.message);
    return { refused };
  }
  if (manifestJson === undefined) {
    errors.push('Failed to parse theme.json: not valid JSON');
    return {};
  }
  const parsed = ThemeManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`theme.json: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return {};
  }
  try {
    const loaded = await loadThemeFromDir(dir, manifestJson);
    warnings.push(...loaded.warnings);
  } catch (err) {
    if (err instanceof ThemeBundleError) errors.push(...err.errors);
    else errors.push(`Failed to load theme: ${getErrorMessage(err)}`);
    return {};
  }
  return { manifest: parsed.data };
}

/** The directory holding theme.json: `dir` itself, or its one-level subdirectory. */
async function findManifestDir(dir: string): Promise<string | null> {
  try {
    await fs.access(path.join(dir, 'theme.json'));
    return dir;
  } catch {
    // Some archives wrap the bundle in one root folder.
  }
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await fs.access(path.join(dir, entry.name, 'theme.json'));
      return path.join(dir, entry.name);
    } catch {
      continue;
    }
  }
  return null;
}

// ============================================================================
// VALIDATION
// ============================================================================

/** Validate a `.qtap-theme` archive without installing it. */
export async function validateThemeBundle(zipPath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fileCount = 0;
  let totalSize = 0;

  archiveLogger.debug('Validating theme bundle', { zipPath });

  try {
    const stat = await fs.stat(zipPath);
    if (stat.size > MAX_BUNDLE_SIZE) {
      errors.push(`Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB`);
      return { valid: false, errors, warnings, fileCount: 0, totalSize: stat.size };
    }
    totalSize = stat.size;
  } catch {
    errors.push('Bundle file not found or not readable');
    return { valid: false, errors, warnings, fileCount: 0, totalSize: 0 };
  }

  let zipFile: yauzl.ZipFile;
  try {
    zipFile = await openZip(zipPath);
  } catch (err) {
    errors.push(`Invalid zip file: ${getErrorMessage(err)}`);
    return { valid: false, errors, warnings, fileCount: 0, totalSize };
  }

  try {
    const entries = await readZipEntries(zipFile);
    fileCount = entries.filter(e => !e.isDirectory).length;

    if (fileCount > MAX_FILE_COUNT) {
      errors.push(`Bundle contains ${fileCount} files, exceeding limit of ${MAX_FILE_COUNT}`);
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    let themeJsonEntry: string | undefined;
    let totalUncompressed = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (entry.isSymlink) {
        errors.push(`Symbolic links are not allowed in theme bundles: ${entry.fileName}`);
        continue;
      }
      checkBundleFile(entry.fileName, entry.uncompressedSize, errors, warnings);
      totalUncompressed += entry.uncompressedSize;
      if (entry.fileName === 'theme.json' || (!themeJsonEntry && /^[^/]+\/theme\.json$/.test(entry.fileName))) {
        themeJsonEntry = entry.fileName;
      }
    }

    // Zip bomb protection
    if (totalUncompressed > MAX_BUNDLE_SIZE * 10) {
      errors.push('Suspicious compression ratio detected (potential zip bomb)');
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    if (!themeJsonEntry) {
      errors.push('Bundle must contain a theme.json file');
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    // A bundle made for an earlier Quilltap is refused before anything is
    // extracted, read straight out of the archive.
    const fallbackId = path.basename(zipPath).replace(/\.qtap-theme$/i, '');
    const rawManifest = await readZipFile(zipPath, themeJsonEntry);
    const refused = rawManifest ? refusalForManifest(parseJson(rawManifest.toString('utf-8')), fallbackId) : null;
    if (refused) {
      archiveLogger.info('Refusing a theme bundle made for an earlier Quilltap', { zipPath, themeId: refused.id, version: refused.version });
      return { valid: false, refused, errors: [refused.message], warnings, fileCount, totalSize };
    }

    if (errors.length > 0) {
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-validate-'));
    try {
      await extractZipToDir(zipPath, tempDir);
      const dir = await findManifestDir(tempDir);
      if (!dir) {
        errors.push('theme.json not found in bundle');
        return { valid: false, errors, warnings, fileCount, totalSize };
      }
      const manifestJson = parseJson(await fs.readFile(path.join(dir, 'theme.json'), 'utf-8'));
      const { manifest } = await validateExtracted(dir, manifestJson, fallbackId, errors, warnings);
      const valid = errors.length === 0 && manifest !== undefined;
      archiveLogger.debug('Theme bundle validated', { zipPath, valid, errorCount: errors.length, warningCount: warnings.length });
      return { valid, manifest: valid ? manifest : undefined, errors, warnings, fileCount, totalSize };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    // An entry name the archive reader or the extraction refuses (an
    // absolute or climbing path, a link) is a problem with the bundle.
    archiveLogger.warn('Theme bundle could not be read', { zipPath, error: getErrorMessage(err) });
    errors.push(`Invalid zip file: ${getErrorMessage(err)}`);
    return { valid: false, errors, warnings, fileCount, totalSize };
  } finally {
    zipFile.close();
  }
}

/**
 * Validate a bundle directory (an unpacked bundle, a theme being written, or
 * an installed one) with the same rules as an archive. Symbolic links inside
 * it are not followed or listed.
 */
export async function validateThemeDirectory(dir: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  archiveLogger.debug('Validating theme directory', { dir });

  let files: Set<string>;
  try {
    files = await listBundleFiles(dir);
  } catch (err) {
    errors.push(`Theme directory not readable: ${getErrorMessage(err)}`);
    return { valid: false, errors, warnings, fileCount: 0, totalSize: 0 };
  }

  let totalSize = 0;
  for (const rel of files) {
    const size = (await fs.stat(await resolveInside(dir, rel, { realpath: true }))).size;
    totalSize += size;
    checkBundleFile(rel, size, errors, warnings);
  }
  if (files.size > MAX_FILE_COUNT) errors.push(`Bundle contains ${files.size} files, exceeding limit of ${MAX_FILE_COUNT}`);
  if (totalSize > MAX_BUNDLE_SIZE) errors.push(`Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB`);
  if (!files.has('theme.json')) {
    errors.push('Bundle must contain a theme.json file');
    return { valid: false, errors, warnings, fileCount: files.size, totalSize };
  }

  const manifestJson = parseJson(await fs.readFile(path.join(dir, 'theme.json'), 'utf-8'));
  const fallbackId = path.basename(path.resolve(dir));
  const refused = refusalForManifest(manifestJson, fallbackId);
  if (refused) {
    archiveLogger.info('Refusing a theme directory made for an earlier Quilltap', { dir, themeId: refused.id });
    return { valid: false, refused, errors: [refused.message], warnings, fileCount: files.size, totalSize };
  }
  if (errors.length > 0) return { valid: false, errors, warnings, fileCount: files.size, totalSize };

  const { manifest } = await validateExtracted(dir, manifestJson, fallbackId, errors, warnings);
  const valid = errors.length === 0 && manifest !== undefined;
  archiveLogger.debug('Theme directory validated', { dir, valid, errorCount: errors.length, warningCount: warnings.length });
  return { valid, manifest: valid ? manifest : undefined, errors, warnings, fileCount: files.size, totalSize };
}

// ============================================================================
// EXTRACT AND PACK
// ============================================================================

/**
 * Extract an archive into `destDir` (which should be empty), hoisting the
 * contents of a single wrapping folder so theme.json sits at the top. Call
 * `validateThemeBundle` first; this repeats only the containment and link
 * checks.
 */
export async function extractThemeBundle(zipPath: string, destDir: string): Promise<void> {
  archiveLogger.debug('Extracting theme bundle', { zipPath, destDir });
  await fs.mkdir(destDir, { recursive: true });
  await extractZipToDir(zipPath, destDir);
  const manifestDir = await findManifestDir(destDir);
  if (!manifestDir) throw new Error('theme.json not found in bundle');
  if (manifestDir === destDir) return;
  for (const entry of await fs.readdir(manifestDir)) {
    await fs.rename(path.join(manifestDir, entry), path.join(destDir, entry));
  }
  await fs.rmdir(manifestDir);
}

/**
 * Pack a bundle directory into a `.qtap-theme` archive: the bundle's own
 * files (symbolic links are not followed), copied through `resolveInside`
 * and zipped with `zip` called with an argument list, never a shell string.
 * A directory made for an earlier Quilltap is refused.
 */
export async function packThemeDirectory(dir: string, outputPath: string): Promise<void> {
  archiveLogger.debug('Packing theme directory', { dir, outputPath });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-pack-'));
  try {
    const files = await listBundleFiles(dir);
    for (const rel of files) {
      const source = await resolveInside(dir, rel, { realpath: true });
      const dest = resolveInsideSync(tempDir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(source, dest);
    }
    const manifestJson = files.has('theme.json') ? parseJson(await fs.readFile(path.join(tempDir, 'theme.json'), 'utf-8')) : undefined;
    const refused = refusalForManifest(manifestJson, path.basename(path.resolve(dir)));
    if (refused) throw new Error(refused.message);
    if ((manifestJson as { formatVersion?: unknown } | undefined)?.formatVersion !== 2) {
      throw new Error(`${dir} is not a current theme bundle (no formatVersion 2 theme.json)`);
    }
    const output = path.resolve(outputPath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.rm(output, { force: true });
    execFileSync('zip', ['-r', '-q', output, '.'], { cwd: tempDir, stdio: 'pipe' });
    archiveLogger.debug('Theme directory packed', { dir, outputPath: output, fileCount: files.size });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
