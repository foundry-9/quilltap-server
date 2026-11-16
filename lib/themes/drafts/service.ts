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
import { bundleFileUsage, describeFileUse, ThemeManifestSchema, ThemeTokensDocumentSchema, type BundleFileUse, type BundleUsage, type ThemeIssue, type ThemeTokensDocument } from '../engine';
import { bundleAssetUrl, imageMimeType, normaliseBundlePath } from '../engine/css-text';
import { convertThemeFonts, type ThemeFontConversion } from '../convert-fonts';
import { readFontInfo, type FontEmbedding, type FontStyle } from '../font-info';
import { DRAFT_LIMITS, UPLOAD_EXTENSIONS, extensionOf } from './uploads';
import { listBundleFiles, loadThemeFromSource, ThemeBundleError, type ThemeBundleSource } from '../theme-bundle';
import { themeRegistry } from '../theme-registry';
import { extractThemeBundle, MAX_BUNDLE_SIZE, packThemeDirectory, validateThemeBundle } from '../bundle-archive';
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

/** The manifest a caller read is not the draft's: someone else changed theme.json first. */
export class DraftManifestRevisionConflictError extends Error {
  constructor(readonly currentRevision: string) {
    super('The theme manifest was changed since it was read; reload the draft and try again');
    this.name = 'DraftManifestRevisionConflictError';
  }
}

/** A manifest edit that would leave theme.json invalid (or one already broken from outside). */
export class DraftManifestInvalidError extends Error {
  constructor(readonly errors: string[]) {
    super(`theme.json would not be valid: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (and ${errors.length - 3} more)` : ''}`);
    this.name = 'DraftManifestInvalidError';
  }
}

/** An operation refused for a reason the caller can act on (an unknown icon, a missing image). */
export class DraftOperationRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftOperationRefusedError';
  }
}

/** A file cannot be removed while something still uses it. */
export class DraftFileInUseError extends Error {
  constructor(readonly path: string, readonly users: string[]) {
    super(`${path} is still used by ${users.join(', ')}`);
    this.name = 'DraftFileInUseError';
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

/** An uploaded archive that would not install, so it is not opened as a draft (Spec G decision 7). */
export class DraftImportRefusedError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
    /** `limit` for an archive past the bundle limits, `refused` for one made for an earlier Quilltap. */
    readonly reason: 'invalid' | 'limit' | 'refused' = 'invalid',
  ) {
    super(message);
    this.name = 'DraftImportRefusedError';
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
  /** The draft file it is in, when it is in one (Spec G decision 6). */
  file?: string;
  /** 1-based line in that file, where the engine knows it (custom CSS). */
  line?: number;
}

/** A draft's custom stylesheet as the editor reads it. */
export interface DraftStyles {
  /** The file `stylesPath` names. */
  path: string;
  /** Its text, or empty when the manifest names a file that is not there. */
  text: string;
  /** The content hash of the file, or `missing`; sent back with a save. */
  revision: string;
}

/** The result of opening an archive as a draft. */
export interface DraftImportResult {
  draft: DraftDetail;
  /** The id in the archive's theme.json. */
  bundleId: string;
  /** True when that id was taken and the draft has another. */
  idChanged: boolean;
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
  /** The store holding the draft folder (Quilltap General), for a link to it in the Scriptorium. */
  mountPointId: string;
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
  /** The content hash of theme.json, sent back with every manifest edit (Spec F decision 6). */
  manifestRevision: string;
  /** Every file in the draft, with its size and what uses it. */
  files: DraftFile[];
  /** The draft against the bundle's limits. */
  totals: DraftTotals;
  /** The custom stylesheet, or null when the manifest names none. */
  styles: DraftStyles | null;
}

/** What a file in a draft is, by its extension and place. */
export type DraftFileKind = 'manifest' | 'tokens' | 'styles' | 'font' | 'licence' | 'image' | 'other';

/** One file in a draft. */
export interface DraftFile {
  path: string;
  size: number;
  kind: DraftFileKind;
  /** Everything that refers to it (Spec F §0.1). */
  users: BundleFileUse[];
  /** The same, in words. */
  usedBy: string[];
  /** A font or image file nothing refers to: kept in the draft, left out at install. */
  unused: boolean;
  /** For a font file, what the font says it is (null when it cannot be read). */
  font?: DraftFontFacts | null;
}

/** What a font file says about itself (read from its tables, Spec F decision 1). */
export interface DraftFontFacts {
  family: string;
  weight: string;
  style: FontStyle;
  variable: boolean;
  embedding: FontEmbedding;
  licence: string | null;
  licenceUrl: string | null;
}

export interface DraftTotals {
  files: number;
  bytes: number;
  limits: { files: number; bytes: number; fileBytes: number };
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
  /** Fonts converted to WOFF2 in the installed copy (original → new path). */
  fontConversion: ThemeFontConversion['converted'];
  /** Font and image files nothing uses, kept in the draft and left out of the install. */
  leftOut: string[];
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
  /** What refers to each file (Spec F §0.1). */
  usage: BundleUsage;
}

const FONT_EXTENSIONS: readonly string[] = UPLOAD_EXTENSIONS.font;
const LICENCE_EXTENSIONS = ['.txt', '.md', '.license'];

/** What a draft file is, by its place in the manifest, then its extension. */
export function draftFileKind(file: string, manifest: Record<string, unknown> | null, users: readonly BundleFileUse[]): DraftFileKind {
  if (file === MANIFEST_FILE) return 'manifest';
  if (users.some((u) => u.kind === 'tokens-file') || (!manifest && file === 'tokens.json')) return 'tokens';
  if (users.some((u) => u.kind === 'styles-file')) return 'styles';
  const ext = extensionOf(file);
  if (FONT_EXTENSIONS.includes(ext)) return 'font';
  if (imageMimeType(file) !== null) return 'image';
  if (users.some((u) => u.kind === 'licence-file')) return 'licence';
  if (LICENCE_EXTENSIONS.includes(ext) && file.startsWith('fonts/')) return 'licence';
  return 'other';
}

/** Kinds an install leaves out when nothing uses them (Spec F decision 3). */
export const LEFT_OUT_WHEN_UNUSED: ReadonlySet<DraftFileKind> = new Set(['font', 'image']);
/** Kinds the editor may remove (when nothing uses them). */
export const REMOVABLE_KINDS: ReadonlySet<DraftFileKind> = new Set(['font', 'image', 'licence']);

/** What each font file says about itself, by content hash (a font's bytes never change under its hash). */
const fontFactsCache = new Map<string, DraftFontFacts | null>();

async function fontFactsFor(store: DraftsStore, id: string, file: DraftFileEntry): Promise<DraftFontFacts | null> {
  if (fontFactsCache.has(file.sha256)) return fontFactsCache.get(file.sha256) ?? null;
  let facts: DraftFontFacts | null = null;
  try {
    const read = readFontInfo(await readDraftBytes(store, id, file.path));
    if (read.ok) {
      const { family, weight, style, variable, embedding, licence, licenceUrl } = read.info;
      facts = { family, weight, style, variable, embedding, licence, licenceUrl };
    }
  } catch (e) {
    logger.debug('Could not read a draft font file', { draftId: id, file: file.path, error: (e as Error).message });
  }
  if (fontFactsCache.size > 500) fontFactsCache.clear();
  fontFactsCache.set(file.sha256, facts);
  return facts;
}

async function readDraftFromStore(store: DraftsStore, id: string, files: DraftFileEntry[]): Promise<DraftRead> {
  const issues: DraftIssue[] = [];
  const error = (message: string, file?: string) => issues.push(file ? { severity: 'error', message, file } : { severity: 'error', message });
  const located = (severity: DraftIssue['severity'], issue: ThemeIssue): DraftIssue => ({ severity, ...issue });

  let manifestJson: unknown;
  let manifest: Record<string, unknown> | null = null;
  try {
    manifestJson = JSON.parse((await readDraftText(store, id, MANIFEST_FILE)).content);
    if (manifestJson && typeof manifestJson === 'object' && !Array.isArray(manifestJson)) {
      manifest = manifestJson as Record<string, unknown>;
    } else {
      error('theme.json: is not a JSON object', MANIFEST_FILE);
    }
  } catch (e) {
    error(`theme.json: cannot be read as JSON (${(e as Error).message})`, MANIFEST_FILE);
  }
  if (manifest && manifest.id !== id) {
    error(`theme.json: id ${JSON.stringify(manifest.id)} does not match the draft folder ${JSON.stringify(id)}`, MANIFEST_FILE);
  }

  const tokensPath = typeof manifest?.tokensPath === 'string' ? manifest.tokensPath : 'tokens.json';
  let tokens: ThemeTokensDocument | null = null;
  let revision = 'missing';
  try {
    const content = (await readDraftText(store, id, tokensPath)).content;
    revision = sha256OfString(content);
    const parsed = ThemeTokensDocumentSchema.safeParse(JSON.parse(content));
    if (parsed.success) tokens = parsed.data;
    else error(`${tokensPath}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, tokensPath);
  } catch (e) {
    if (isMissing(e)) error(`${tokensPath}: is not in the draft`, tokensPath);
    else error(`${tokensPath}: cannot be read as JSON (${(e as Error).message})`, tokensPath);
  }

  let manifestRevision = 'missing';
  try {
    manifestRevision = sha256OfString((await readDraftText(store, id, MANIFEST_FILE)).content);
  } catch (e) {
    if (!isMissing(e)) throw e;
  }

  const present = new Set(files.map((f) => f.path));
  let css: string | null = null;
  let styles: DraftStyles | null = null;
  if (typeof manifest?.stylesPath === 'string' && manifest.stylesPath.trim() !== '') {
    const stylesPath = normaliseBundlePath(manifest.stylesPath);
    styles = { path: stylesPath, text: '', revision: 'missing' };
    if (present.has(stylesPath)) {
      try {
        css = (await readDraftText(store, id, stylesPath)).content;
        styles = { path: stylesPath, text: css, revision: sha256OfString(css) };
      } catch (e) {
        logger.debug('Could not read a draft\'s custom CSS', { draftId: id, error: (e as Error).message });
      }
    }
  }
  const usage = bundleFileUsage({ manifest, tokens, css });

  const imagePaths = files.map((f) => f.path).filter((p) => imageMimeType(p) !== null).sort();
  let compiled = { fontFaces: '', icons: '', custom: '' };
  let served: DraftServedSet | null = null;
  if (manifest && tokens && issues.length === 0) {
    try {
      const loaded = await loadThemeFromSource(storeSource(store, id, files), manifestJson);
      compiled = { fontFaces: loaded.compiled.css.fontFaces, icons: loaded.compiled.css.icons, custom: loaded.compiled.css.custom };
      for (const w of loaded.warningIssues) issues.push(located('warning', w));
      // Both halves come from the file usage (Spec F §0.1): every font file a
      // font entry names, and every image in the draft — not only those
      // something names today, so the editor can show a thumbnail and preview
      // an image token before saving. Every used image is in that set already
      // (validation refused one that is missing).
      served = {
        version: loaded.document.manifest.version,
        assets: new Set(imagePaths),
        fonts: new Set([...usage].filter(([p, uses]) => present.has(p) && uses.some((u) => u.kind === 'font')).map(([p]) => p)),
      };
    } catch (e) {
      if (e instanceof ThemeBundleError) for (const i of e.issues) issues.push(located('error', i));
      else error((e as Error).message);
    }
  }

  const uri = await docStoreUriFor({ mountPointId: store.mountPointId, mountPointName: store.name, relativePath: draftFolderPath(id) });
  const images: DraftImageFile[] = imagePaths.map((p) => ({
    path: p,
    type: imageMimeType(p) as string,
    url: served ? bundleAssetUrl(id, served.version, p) : null,
  }));
  const draftFiles: DraftFile[] = [];
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const users = usage.get(f.path) ?? [];
    const kind = draftFileKind(f.path, manifest, users);
    const entry: DraftFile = {
      path: f.path,
      size: f.size,
      kind,
      users,
      usedBy: users.map(describeFileUse),
      unused: users.length === 0 && REMOVABLE_KINDS.has(kind),
    };
    if (kind === 'font') entry.font = await fontFactsFor(store, id, f);
    draftFiles.push(entry);
  }
  const totals: DraftTotals = {
    files: files.length,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
    limits: { files: DRAFT_LIMITS.files, bytes: DRAFT_LIMITS.totalBytes, fileBytes: DRAFT_LIMITS.fileBytes },
  };

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
      mountPointId: store.mountPointId,
      compiled,
      subsystems: draftSubsystems(manifest, id, typeof manifest?.version === 'string' ? manifest.version : null),
      issues,
      updatedAt: newest(files),
      version: typeof manifest?.version === 'string' ? manifest.version : null,
      images,
      manifestRevision,
      files: draftFiles,
      totals,
      styles,
    },
    served,
    usage,
  };
}

/** The served set, cached by the folder's file listing (paths and hashes). */
const servedCache = new Map<string, { signature: string; served: DraftServedSet | null }>();
const signatureOf = (files: DraftFileEntry[]) =>
  sha256OfString(files.map((f) => `${f.path}\u0000${f.sha256}`).sort().join('\n'));

export async function loadDraft(id: string): Promise<{ store: DraftsStore; files: DraftFileEntry[]; read: DraftRead }> {
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
    await writeNewDraft(store, id, trimmed, source?.id ?? null, source?.bundlePath ?? null, { version: '0.1.0' });
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

/**
 * Write a new draft's files; the manifest always goes last. A copy restarts
 * at `version` 0.1.0; an import keeps the bundle's own (`version` omitted).
 */
async function writeNewDraft(
  store: DraftsStore,
  id: string,
  trimmed: string,
  sourceId: string | null,
  bundleDir: string | null,
  options: { version?: string } = {},
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
  if (options.version !== undefined) manifest.version = options.version;
  // The manifest goes last: a folder with a theme.json is a draft, so a copy
  // interrupted part-way never lists as a broken one.
  await writeDraftDocument(store, id, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  logger.debug('Copied theme into a draft', { draftId: id, from: sourceId, files: files.length });
}

/**
 * Open an uploaded `.qtap-theme` archive as a new draft (Spec G decision 7).
 * The archive is held to the checks an install runs (`validateThemeBundle`:
 * size, file count, file types, paths, links, a version 1 refusal, then the
 * whole document) before anything is written to the store; it is extracted
 * into a temporary directory with the same containment checks and copied in
 * by the copy path. The draft keeps the bundle's name and version, under the
 * bundle's id when that is free and a numbered one when it is not. The
 * temporary directory is removed whatever happens.
 */
export function importDraft(upload: { fileName: string; bytes: Buffer }): Promise<DraftImportResult> {
  const run = createChain.then(() => importDraftNow(upload));
  createChain = run.catch(() => undefined);
  return run;
}

async function importDraftNow(upload: { fileName: string; bytes: Buffer }): Promise<DraftImportResult> {
  if (upload.bytes.length > MAX_BUNDLE_SIZE) {
    throw new DraftImportRefusedError(
      `The archive is larger than a theme may be (${MAX_BUNDLE_SIZE / 1024 / 1024} MB)`,
      [`Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB`],
      'limit',
    );
  }
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-import-'));
  try {
    // The archive's own name is never used for anything but the log.
    const archive = path.join(work, 'upload.qtap-theme');
    await fs.writeFile(archive, upload.bytes);
    const checked = await validateThemeBundle(archive);
    if (checked.refused) {
      logger.info('Theme import refused: made for an earlier Quilltap', { fileName: upload.fileName, themeId: checked.refused.id });
      throw new DraftImportRefusedError(checked.refused.message, [checked.refused.message], 'refused');
    }
    if (!checked.valid || !checked.manifest) {
      const overLimit = checked.errors.some((e) => /exceed|maximum size|zip bomb/i.test(e));
      logger.info('Theme import refused: the archive would not install', { fileName: upload.fileName, errors: checked.errors.slice(0, 20) });
      throw new DraftImportRefusedError(
        `The archive is not a theme that would install: ${checked.errors.slice(0, 3).join('; ')}${checked.errors.length > 3 ? ` (and ${checked.errors.length - 3} more)` : ''}`,
        checked.errors,
        overLimit ? 'limit' : 'invalid',
      );
    }

    const dir = path.join(work, 'bundle');
    await extractThemeBundle(archive, dir);
    const bundleId = checked.manifest.id;
    const name = checked.manifest.name.trim();

    const store = await draftsStore();
    const id = freeId(isValidDraftId(bundleId) ? bundleId : draftIdFromName(name), await takenIds(store));
    logger.info('Importing a theme archive as a draft', { draftId: id, bundleId, fileName: upload.fileName, files: checked.fileCount });
    try {
      await writeNewDraft(store, id, name, bundleId, dir);
    } catch (e) {
      logger.warn('Theme import failed; removing the partial folder', { draftId: id, error: (e as Error).message });
      try {
        await deleteDraftFolder(store, id);
      } catch (cleanup) {
        logger.error('Could not remove a partial theme draft folder', { draftId: id, error: (cleanup as Error).message });
      }
      throw e;
    }
    return { draft: await readDraft(id), bundleId, idChanged: id !== bundleId };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
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

export interface ManifestRewriteOptions {
  /** The manifest revision the caller read; a mismatch writes nothing (Spec F decision 6). */
  revision?: string;
  /** Hold the edited manifest to `ThemeManifestSchema` (every editor operation does). */
  validate?: boolean;
}

/**
 * Read `theme.json`, change it, and write it back guarded by its mtime. A
 * stale `revision` is a DraftManifestRevisionConflictError; a manifest that
 * does not parse is DraftManifestUnreadableError; with `validate`, an edit
 * whose result is not a valid manifest — including one already broken from
 * outside — is DraftManifestInvalidError. In every refusal the file is
 * untouched.
 */
export async function rewriteManifest(
  store: DraftsStore,
  id: string,
  edit: (manifest: Record<string, unknown>) => void,
  options: ManifestRewriteOptions = {},
): Promise<void> {
  const current = await readDraftText(store, id, MANIFEST_FILE);
  if (options.revision !== undefined) {
    const currentRevision = sha256OfString(current.content);
    if (currentRevision !== options.revision) {
      logger.debug('Theme draft manifest edit refused: stale revision', { draftId: id });
      throw new DraftManifestRevisionConflictError(currentRevision);
    }
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(current.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
    manifest = parsed as Record<string, unknown>;
  } catch (e) {
    throw new DraftManifestUnreadableError(id, (e as Error).message);
  }
  edit(manifest);
  if (options.validate) {
    const checked = ThemeManifestSchema.safeParse(manifest);
    if (!checked.success) {
      const errors = checked.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
      logger.debug('Theme draft manifest edit refused: invalid result', { draftId: id, errors });
      throw new DraftManifestInvalidError(errors);
    }
  }
  try {
    await writeDraftDocument(store, id, MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, current.mtime);
  } catch (e) {
    if (e instanceof DocumentConflictError) {
      const now = await readDraftText(store, id, MANIFEST_FILE).catch(() => null);
      throw new DraftManifestRevisionConflictError(now ? sha256OfString(now.content) : 'missing');
    }
    throw e;
  }
}

/** Delete a draft and every file in it. An installed copy is untouched. */
export async function deleteDraft(id: string): Promise<void> {
  const { store } = await loadDraft(id);
  const deleted = await deleteDraftFolder(store, id);
  servedCache.delete(id);
  const conversations = await deleteDraftConversations(id);
  logger.info('Deleted theme draft', { draftId: id, files: deleted, conversations });
}

/**
 * A draft's conversations with Calliope leave with it (Spec J decision 3);
 * each takes its own attachments through the chats repository's delete.
 */
async function deleteDraftConversations(id: string): Promise<number> {
  const { getRepositories } = await import('@/lib/repositories/factory');
  const repos = getRepositories();
  const chats = await repos.chats.findCalliopeByThemeDraft(id);
  let count = 0;
  for (const chat of chats) {
    if (await repos.chats.delete(chat.id)) count += 1;
  }
  logger.debug('Deleted the draft\'s conversations with Calliope', { draftId: id, found: chats.length, deleted: count });
  return count;
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
 * files to a temporary directory, leave out the font and image files nothing
 * uses (Spec F decision 3), convert its raster images to WebP and its
 * TrueType and OpenType fonts to WOFF2 there (the draft keeps its originals),
 * pack it and run the ordinary install, so it passes every check a bundle
 * passes. Installing again replaces the
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
    // Unused files are decided first, so nothing is converted that will not
    // ship; a converted file stays used under its new name, because the
    // conversions rewrite every reference they rename.
    const leftOut = read.detail.files
      .filter((f) => f.users.length === 0 && LEFT_OUT_WHEN_UNUSED.has(f.kind))
      .map((f) => f.path);
    const skip = new Set(leftOut);
    for (const file of files) {
      if (skip.has(file.path)) continue;
      const target = await resolveInside(dir, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await readDraftBytes(store, id, file.path));
    }
    const conversion = await convertThemeImages(dir);
    if (conversion.errors.length > 0) throw new DraftNotInstallableError(conversion.errors);
    const fontConversion = await convertThemeFonts(dir);
    if (fontConversion.errors.length > 0) throw new DraftNotInstallableError(fontConversion.errors);

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
      fontsConverted: Object.keys(fontConversion.converted).length,
      skippedAnimated: conversion.skippedAnimated.length,
      leftOut,
    });
    return {
      themeId: result.themeId,
      version: installedVersion,
      draftVersion,
      conversion: { converted: conversion.converted, reencoded: conversion.reencoded, skippedAnimated: conversion.skippedAnimated },
      fontConversion: fontConversion.converted,
      leftOut,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
