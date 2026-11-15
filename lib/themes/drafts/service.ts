/**
 * Theme drafts: list, read, create, save, delete and install (Calliope Live,
 * Spec D, Stage 1).
 *
 * A draft is a folder `Themes/<id>/` in Quilltap General holding an unpacked
 * version 2 bundle, and nothing else — no side file, no database row; its
 * dates come from the store. Anything may edit it (Document Mode, a
 * character's `doc_*` call, the editor), so nothing here assumes the files are
 * valid: a `theme.json` or `tokens.json` that does not parse is an issue on
 * the draft, and the draft still lists and opens.
 *
 * Validation and compiling go through the same loader as an installed bundle
 * (`loadThemeFromSource`, `lib/themes/theme-bundle.ts`), reading the store
 * folder directly, so a draft and a bundle are judged by one rule.
 *
 * @module lib/themes/drafts/service
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { sha256OfString } from '@/lib/utils/sha256';
import { getThemesDir } from '@/lib/paths';
import { resolveInside, resolveInsideSync } from '@/lib/paths/resolve-inside';
import { docStoreUriFor } from '@/lib/doc-edit/uri-producers';
import { DocumentConflictError } from '@/lib/documents/core/errors';
import { HOOK_CATALOGUE } from '../hooks';
import { ThemeTokensDocumentSchema, type ThemeTokensDocument } from '../engine';
import { bundleAssetUrl, imageMimeType, normaliseBundlePath } from '../engine/css-text';
import { listBundleFiles, loadThemeFromSource, ThemeBundleError, type ThemeBundleSource } from '../theme-bundle';
import { themeRegistry } from '../theme-registry';
import { packThemeDirectory } from '../bundle-archive';
import { installThemeBundle } from '../bundle-loader';
import { hotLoadInstalledTheme } from '../hot-load';
import { convertThemeImages, type ThemeImageConversion } from '../convert-images';
import { draftFolderPath, isValidDraftId, THEME_DRAFTS_FOLDER } from './location';
import {
  draftsStore,
  deleteDraftFolder,
  listDraftFiles,
  listDraftFolders,
  readDraftBytes,
  readDraftText,
  writeDraftDocument,
  writeDraftFile,
  type DraftFileEntry,
  type DraftsStore,
} from './store';

const logger = createServiceLogger('ThemeDrafts');

const MANIFEST_FILE = 'theme.json';

// ============================================================================
// Errors
// ============================================================================

export class ThemeDraftNotFoundError extends Error {
  constructor(readonly draftId: string) {
    super(`No theme draft named ${JSON.stringify(draftId)}`);
    this.name = 'ThemeDraftNotFoundError';
  }
}

/** The caller's revision is not the draft's: someone else saved first. */
export class DraftRevisionConflictError extends Error {
  constructor(readonly currentRevision: string) {
    super('The draft was changed since it was read; reload it and try again');
    this.name = 'DraftRevisionConflictError';
  }
}

/** A draft whose `theme.json` does not parse cannot have its fields edited. */
export class DraftManifestUnreadableError extends Error {
  constructor(readonly draftId: string, reason: string) {
    super(`theme.json cannot be read as JSON: ${reason}`);
    this.name = 'DraftManifestUnreadableError';
  }
}

/** Install refused: the draft has validation errors (or its images cannot be converted). */
export class DraftNotInstallableError extends Error {
  constructor(readonly errors: string[]) {
    super(`The draft cannot be installed: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (and ${errors.length - 3} more)` : ''}`);
    this.name = 'DraftNotInstallableError';
  }
}

/** A create from a theme that is not registered, or has no bundle to copy. */
export class DraftSourceNotFoundError extends Error {
  constructor(readonly from: string) {
    super(`No installed theme named ${JSON.stringify(from)} to start from`);
    this.name = 'DraftSourceNotFoundError';
  }
}

// ============================================================================
// Shapes
// ============================================================================

export interface DraftIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface DraftSummary {
  id: string;
  name: string;
  /** ISO time of the newest file in the folder. */
  updatedAt: string;
  errorCount: number;
  warningCount: number;
}

export interface DraftDetail {
  id: string;
  /** The parsed theme.json, or null when it does not parse. */
  manifest: Record<string, unknown> | null;
  /** The parsed tokens document, or null when it is missing or does not parse. */
  tokens: ThemeTokensDocument | null;
  /** The content hash of the tokens file, or `missing`. */
  revision: string;
  /** The draft folder's `qtap://` address. */
  uri: string;
  /** The parts the editor cannot change yet, compiled by the server (empty when invalid). */
  compiled: { fontFaces: string; icons: string; custom: string };
  /** The manifest's subsystem overrides, image paths resolved to the draft's asset URLs. */
  subsystems: Record<string, DraftSubsystemOverride>;
  issues: DraftIssue[];
  updatedAt: string;
  /** The manifest version asset URLs carry, when the manifest names one. */
  version: string | null;
  /** Every image file in the draft (what an image token may name, Spec E decision 10). */
  images: DraftImageFile[];
}

/** One image file in a draft. */
export interface DraftImageFile {
  /** Path inside the draft (`textures/paper.webp`). */
  path: string;
  /** Its media type (`image/webp`). */
  type: string;
  /** Where the draft serves it at its version, or null when the draft is not valid enough to serve. */
  url: string | null;
}

/** One subsystem override as the preview applies it. */
export interface DraftSubsystemOverride {
  name?: string;
  description?: string;
  thumbnail?: string;
  backgroundImage?: string;
}

/**
 * A draft's subsystem overrides with each relative image path turned into its
 * asset URL at the draft's version (the URL a draft is served at; data URIs,
 * absolute URLs, rooted paths and `none` pass through).
 */
export function draftSubsystems(manifest: Record<string, unknown> | null, id: string, version: string | null): Record<string, DraftSubsystemOverride> {
  const raw = manifest?.subsystems;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const url = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || value === '') return undefined;
    if (value === 'none' || value.startsWith('data:') || /^https?:\/\//.test(value) || value.startsWith('/')) return value;
    const path = normaliseBundlePath(value).split('/').map(encodeURIComponent).join('/');
    return `/api/themes/assets/bundle:${id}/${path}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
  };
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const out: Record<string, DraftSubsystemOverride> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    out[key] = { name: text(e.name), description: text(e.description), thumbnail: url(e.thumbnail), backgroundImage: url(e.backgroundImage) };
  }
  return out;
}

/** What the asset and font routes may serve for a draft. */
export interface DraftServedSet {
  version: string;
  assets: ReadonlySet<string>;
  fonts: ReadonlySet<string>;
}

export interface DraftInstallResult {
  themeId: string;
  /** The version installed. */
  version: string;
  /** The draft's version after the bump. */
  draftVersion: string;
  conversion: Pick<ThemeImageConversion, 'converted' | 'reencoded' | 'skippedAnimated'>;
}

// ============================================================================
// Reading
// ============================================================================

const newest = (files: DraftFileEntry[]) =>
  files.reduce((latest, f) => (f.lastModified > latest ? f.lastModified : latest), '');

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

function storeSource(store: DraftsStore, id: string, files: DraftFileEntry[]): ThemeBundleSource {
  const folder = `/${draftFolderPath(id)}`;
  return {
    label: `${THEME_DRAFTS_FOLDER}/${id}`,
    files: new Set(files.map((f) => f.path)),
    readText: async (rel) => (await readDraftText(store, id, rel)).content,
    checkReferenced: async (rel) => {
      resolveInsideSync(folder, rel, { allowBase: false });
    },
  };
}

interface DraftRead {
  detail: DraftDetail;
  served: DraftServedSet | null;
}

async function readDraftFromStore(store: DraftsStore, id: string, files: DraftFileEntry[]): Promise<DraftRead> {
  const issues: DraftIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'error', message });

  let manifestJson: unknown;
  let manifest: Record<string, unknown> | null = null;
  try {
    manifestJson = JSON.parse((await readDraftText(store, id, MANIFEST_FILE)).content);
    if (manifestJson && typeof manifestJson === 'object' && !Array.isArray(manifestJson)) {
      manifest = manifestJson as Record<string, unknown>;
    } else {
      error('theme.json: is not a JSON object');
    }
  } catch (e) {
    error(`theme.json: cannot be read as JSON (${(e as Error).message})`);
  }
  if (manifest && manifest.id !== id) {
    error(`theme.json: id ${JSON.stringify(manifest.id)} does not match the draft folder ${JSON.stringify(id)}`);
  }

  const tokensPath = typeof manifest?.tokensPath === 'string' ? manifest.tokensPath : 'tokens.json';
  let tokens: ThemeTokensDocument | null = null;
  let revision = 'missing';
  try {
    const content = (await readDraftText(store, id, tokensPath)).content;
    revision = sha256OfString(content);
    const parsed = ThemeTokensDocumentSchema.safeParse(JSON.parse(content));
    if (parsed.success) tokens = parsed.data;
    else error(`${tokensPath}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  } catch (e) {
    if (isMissing(e)) error(`${tokensPath}: is not in the draft`);
    else error(`${tokensPath}: cannot be read as JSON (${(e as Error).message})`);
  }

  const imagePaths = files.map((f) => f.path).filter((p) => imageMimeType(p) !== null).sort();
  let compiled = { fontFaces: '', icons: '', custom: '' };
  let served: DraftServedSet | null = null;
  if (manifest && tokens && issues.length === 0) {
    try {
      const loaded = await loadThemeFromSource(storeSource(store, id, files), manifestJson);
      compiled = { fontFaces: loaded.compiled.css.fontFaces, icons: loaded.compiled.css.icons, custom: loaded.compiled.css.custom };
      for (const w of loaded.warnings) issues.push({ severity: 'warning', message: w });
      served = {
        version: loaded.document.manifest.version,
        // Every image in the draft, not only those its CSS names today, so the
        // editor can show a thumbnail and preview an image token before saving.
        assets: new Set([...loaded.compiled.assets, ...imagePaths]),
        fonts: new Set((loaded.document.manifest.fonts ?? []).map((f) => normaliseBundlePath(f.src))),
      };
    } catch (e) {
      if (e instanceof ThemeBundleError) for (const m of e.errors) error(m);
      else error((e as Error).message);
    }
  }

  const uri = await docStoreUriFor({ mountPointId: store.mountPointId, mountPointName: store.name, relativePath: draftFolderPath(id) });
  const images: DraftImageFile[] = imagePaths.map((p) => ({
    path: p,
    type: imageMimeType(p) as string,
    url: served ? bundleAssetUrl(id, served.version, p) : null,
  }));
  logger.debug('Read theme draft', {
    draftId: id,
    files: files.length,
    images: images.length,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  });
  return {
    detail: {
      id,
      manifest,
      tokens,
      revision,
      uri,
      compiled,
      subsystems: draftSubsystems(manifest, id, typeof manifest?.version === 'string' ? manifest.version : null),
      issues,
      updatedAt: newest(files),
      version: typeof manifest?.version === 'string' ? manifest.version : null,
      images,
    },
    served,
  };
}

/** The served set, cached by the folder's file listing (paths and hashes). */
const servedCache = new Map<string, { signature: string; served: DraftServedSet | null }>();
const signatureOf = (files: DraftFileEntry[]) =>
  sha256OfString(files.map((f) => `${f.path}\u0000${f.sha256}`).sort().join('\n'));

async function loadDraft(id: string): Promise<{ store: DraftsStore; files: DraftFileEntry[]; read: DraftRead }> {
  if (!isValidDraftId(id)) throw new ThemeDraftNotFoundError(id);
  const store = await draftsStore();
  const files = await listDraftFiles(store, id);
  if (!files.some((f) => f.path === MANIFEST_FILE)) throw new ThemeDraftNotFoundError(id);
  const read = await readDraftFromStore(store, id, files);
  servedCache.set(id, { signature: signatureOf(files), served: read.served });
  return { store, files, read };
}

/** Every draft: each folder under `Themes/` that holds a `theme.json`. */
export async function listDrafts(): Promise<DraftSummary[]> {
  const store = await draftsStore();
  const folders = await listDraftFolders(store);
  const drafts: DraftSummary[] = [];
  for (const [folder, files] of folders) {
    if (!isValidDraftId(folder)) {
      logger.warn('Skipping a folder under Themes/ whose name is not a theme id', { folder });
      continue;
    }
    if (!files.some((f) => f.path === MANIFEST_FILE)) continue;
    const { detail, served } = await readDraftFromStore(store, folder, files);
    servedCache.set(folder, { signature: signatureOf(files), served });
    drafts.push({
      id: folder,
      name: typeof detail.manifest?.name === 'string' ? detail.manifest.name : folder,
      updatedAt: detail.updatedAt,
      errorCount: detail.issues.filter((i) => i.severity === 'error').length,
      warningCount: detail.issues.filter((i) => i.severity === 'warning').length,
    });
  }
  drafts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  logger.debug('Listed theme drafts', { count: drafts.length });
  return drafts;
}

/** One draft, with its issues. Throws ThemeDraftNotFoundError. */
export async function readDraft(id: string): Promise<DraftDetail> {
  return (await loadDraft(id)).read.detail;
}

/**
 * What a draft's asset and font URLs may serve, or null when it is not a
 * draft or does not compile. Cached until the folder's files change.
 */
export async function draftServedSet(id: string): Promise<DraftServedSet | null> {
  if (!isValidDraftId(id)) return null;
  const store = await draftsStore();
  const files = await listDraftFiles(store, id);
  if (!files.some((f) => f.path === MANIFEST_FILE)) return null;
  const cached = servedCache.get(id);
  if (cached && cached.signature === signatureOf(files)) return cached.served;
  const read = await readDraftFromStore(store, id, files);
  servedCache.set(id, { signature: signatureOf(files), served: read.served });
  return read.served;
}

/** The bytes of one file in a draft's served set (fonts or assets). */
export async function readDraftServedFile(id: string, file: string): Promise<Buffer> {
  return readDraftBytes(await draftsStore(), id, file);
}

// ============================================================================
// Creating
// ============================================================================

/** A theme id from a name: lowercase, hyphenated, starting with a letter. */
export function draftIdFromName(name: string): string {
  let slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = 'theme';
  if (!/^[a-z]/.test(slug)) slug = `theme-${slug}`;
  return slug.slice(0, 56).replace(/-+$/, '');
}

/** Ids already taken: every draft folder and every registered theme (the default included). */
async function takenIds(store: DraftsStore): Promise<Set<string>> {
  const taken = new Set<string>(['default']);
  for (const folder of (await listDraftFolders(store)).keys()) taken.add(folder.toLowerCase());
  for (const theme of themeRegistry.getAll()) taken.add(theme.id);
  return taken;
}

function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Creates are serialised so two at once cannot pick the same free id. */
let createChain: Promise<unknown> = Promise.resolve();

/**
 * Create a draft named `name`: blank (an empty tokens document — the default
 * theme) or a copy of every file of the registered theme `from`, under a new
 * id and name at version 0.1.0. The copy keeps no link to its source.
 */
export function createDraft(input: { name: string; from?: string }): Promise<DraftDetail> {
  const run = createChain.then(() => createDraftNow(input));
  createChain = run.catch(() => undefined);
  return run;
}

async function createDraftNow({ name, from }: { name: string; from?: string }): Promise<DraftDetail> {
  const store = await draftsStore();
  const trimmed = name.trim();
  const id = freeId(draftIdFromName(trimmed), await takenIds(store));
  const source = from && from !== 'default' ? themeRegistry.get(from) : null;
  if (from && from !== 'default' && (!source || source.source !== 'bundle' || !source.bundlePath)) {
    throw new DraftSourceNotFoundError(from);
  }
  logger.info('Creating theme draft', { draftId: id, from: source?.id ?? 'blank' });

  try {
    await writeNewDraft(store, id, trimmed, source?.id ?? null, source?.bundlePath ?? null);
  } catch (e) {
    // A write failed part-way (#226). The folder has no theme.json, so it
    // never lists as a draft, but `takenIds` would still count it and keep
    // the id taken forever. Remove whatever was written before rethrowing.
    logger.warn('Theme draft create failed; removing the partial folder', { draftId: id, error: (e as Error).message });
    try {
      await deleteDraftFolder(store, id);
    } catch (cleanup) {
      logger.error('Could not remove a partial theme draft folder', { draftId: id, error: (cleanup as Error).message });
    }
    throw e;
  }
  return readDraft(id);
}

/** Write a new draft's files; the manifest always goes last. */
async function writeNewDraft(
  store: DraftsStore,
  id: string,
  trimmed: string,
  sourceId: string | null,
  bundleDir: string | null,
): Promise<void> {
  if (!bundleDir) {
    const manifest = {
      format: 'qtap-theme',
      formatVersion: 2,
      id,
      name: trimmed,
      version: '0.1.0',
      author: 'Anonymous',
      supportsDarkMode: true,
      tokensPath: 'tokens.json',
      hooksVersion: HOOK_CATALOGUE.version,
    };
    await writeDraftDocument(store, id, 'tokens.json', `${JSON.stringify({ primitives: {}, tokens: {}, choices: {} }, null, 2)}\n`);
    await writeDraftDocument(store, id, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  const files = [...(await listBundleFiles(bundleDir))].sort();
  let manifestText: string | null = null;
  for (const rel of files) {
    const data = await fs.readFile(await resolveInside(bundleDir, rel, { realpath: true }));
    if (rel === MANIFEST_FILE) {
      manifestText = data.toString('utf-8');
      continue;
    }
    await writeDraftFile(store, id, rel, data);
  }
  const manifest = JSON.parse(manifestText ?? '{}') as Record<string, unknown>;
  manifest.id = id;
  manifest.name = trimmed;
  manifest.version = '0.1.0';
  // The manifest goes last: a folder with a theme.json is a draft, so a copy
  // interrupted part-way never lists as a broken one.
  await writeDraftDocument(store, id, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  logger.debug('Copied theme into a draft', { draftId: id, from: sourceId, files: files.length });
}

// ============================================================================
// Saving
// ============================================================================

/**
 * Save a draft's tokens document. `revision` is the one the caller read; on a
 * mismatch nothing is written and DraftRevisionConflictError carries the
 * current one. Registry-level problems come back as issues and do not block
 * the save.
 */
export async function writeDraftTokens(id: string, input: { revision: string; tokens: ThemeTokensDocument }): Promise<DraftDetail> {
  const { store, read } = await loadDraft(id);
  const tokensPath = typeof read.detail.manifest?.tokensPath === 'string' ? read.detail.manifest.tokensPath : 'tokens.json';
  const tokens = ThemeTokensDocumentSchema.parse(input.tokens);

  let current: { content: string; mtime: number } | null = null;
  try {
    current = await readDraftText(store, id, tokensPath);
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  const currentRevision = current ? sha256OfString(current.content) : 'missing';
  if (currentRevision !== input.revision) {
    logger.debug('Theme draft save refused: stale revision', { draftId: id });
    throw new DraftRevisionConflictError(currentRevision);
  }
  try {
    await writeDraftDocument(store, id, tokensPath, `${JSON.stringify(tokens, null, 2)}\n`, current?.mtime);
  } catch (e) {
    if (e instanceof DocumentConflictError) {
      const now = await readDraftText(store, id, tokensPath).catch(() => null);
      throw new DraftRevisionConflictError(now ? sha256OfString(now.content) : 'missing');
    }
    throw e;
  }
  logger.debug('Saved theme draft tokens', { draftId: id });
  return readDraft(id);
}

async function rewriteManifest(store: DraftsStore, id: string, edit: (manifest: Record<string, unknown>) => void): Promise<void> {
  const current = await readDraftText(store, id, MANIFEST_FILE);
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(current.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
    manifest = parsed as Record<string, unknown>;
  } catch (e) {
    throw new DraftManifestUnreadableError(id, (e as Error).message);
  }
  edit(manifest);
  await writeDraftDocument(store, id, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, current.mtime);
}

/** Edit the draft's name and description, the only manifest fields the editor owns. */
export async function writeDraftManifestFields(id: string, fields: { name?: string; description?: string }): Promise<DraftDetail> {
  const { store } = await loadDraft(id);
  await rewriteManifest(store, id, (manifest) => {
    if (fields.name !== undefined) manifest.name = fields.name.trim();
    if (fields.description !== undefined) {
      const description = fields.description.trim();
      if (description) manifest.description = description;
      else delete manifest.description;
    }
  });
  logger.debug('Saved theme draft manifest fields', { draftId: id, fields: Object.keys(fields) });
  return readDraft(id);
}

/** Delete a draft and every file in it. An installed copy is untouched. */
export async function deleteDraft(id: string): Promise<void> {
  const { store } = await loadDraft(id);
  const deleted = await deleteDraftFolder(store, id);
  servedCache.delete(id);
  logger.info('Deleted theme draft', { draftId: id, files: deleted });
}

// ============================================================================
// Installing
// ============================================================================

/** `1.2.3` → `1.2.4`; anything without a numeric patch gains one. */
export function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m) return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  return `${version}.1`;
}

/**
 * Install a draft: refuse one with validation errors; otherwise write its
 * files to a temporary directory, convert its raster images to WebP there
 * (the draft keeps its originals), pack it and run the ordinary install, so
 * it passes every check a bundle passes. Installing again replaces the
 * earlier install. Afterwards the draft's patch version is bumped, so the
 * installed theme and the draft never share asset URLs.
 */
export async function installDraft(id: string): Promise<DraftInstallResult> {
  const { store, files, read } = await loadDraft(id);
  const errors = read.detail.issues.filter((i) => i.severity === 'error').map((i) => i.message);
  if (errors.length > 0) throw new DraftNotInstallableError(errors);

  // An id a bundled theme holds is never overwritten by a draft's install.
  const registered = themeRegistry.get(id);
  const themesDir = path.resolve(getThemesDir());
  if (registered && (registered.isDefault || !registered.bundlePath || !path.resolve(registered.bundlePath).startsWith(`${themesDir}${path.sep}`))) {
    throw new DraftNotInstallableError([`the id ${JSON.stringify(id)} belongs to a theme that ships with Quilltap`]);
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-draft-'));
  try {
    const dir = path.join(work, 'bundle');
    await fs.mkdir(dir);
    for (const file of files) {
      const target = await resolveInside(dir, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await readDraftBytes(store, id, file.path));
    }
    const conversion = await convertThemeImages(dir);
    if (conversion.errors.length > 0) throw new DraftNotInstallableError(conversion.errors);

    const archive = path.join(work, `${id}.qtap-theme`);
    await packThemeDirectory(dir, archive);
    const result = await installThemeBundle(archive);
    if (!result.success || !result.themeId) {
      throw new DraftNotInstallableError([result.refused?.message ?? result.error ?? 'the install failed']);
    }
    await hotLoadInstalledTheme(result.themeId);

    const installedVersion = result.version ?? read.detail.version ?? '';
    let draftVersion = installedVersion;
    await rewriteManifest(store, id, (manifest) => {
      draftVersion = bumpPatch(typeof manifest.version === 'string' ? manifest.version : installedVersion);
      manifest.version = draftVersion;
    });
    logger.info('Installed theme draft', {
      draftId: id,
      version: installedVersion,
      draftVersion,
      converted: Object.keys(conversion.converted).length,
      skippedAnimated: conversion.skippedAnimated.length,
    });
    return {
      themeId: result.themeId,
      version: installedVersion,
      draftVersion,
      conversion: { converted: conversion.converted, reencoded: conversion.reencoded, skippedAnimated: conversion.skippedAnimated },
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
