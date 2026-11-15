/**
 * Theme draft operations on the manifest and its files (Calliope Live, Spec F
 * §0.2): fonts, licence files, images, icon overrides, subsystem pictures and
 * the manifest's own fields.
 *
 * Every operation takes the manifest revision the caller read (decision 6) and
 * is checked in full before anything is written: the revision, the upload
 * (`./uploads.ts`: kind, bytes, limits), and the edited manifest against
 * `ThemeManifestSchema` (a dry run on the manifest as read, so a manifest
 * broken from outside refuses the operation with its reason and the file is
 * untouched). Then a file is written before the manifest names it, and a
 * manifest entry is removed before its file is deleted — a failure half way
 * leaves an unused file, never a reference to nothing. Operations on one draft
 * run one at a time, so two uploads cannot pick the same free name.
 *
 * Files are written only through `./store.ts`. Each operation returns the
 * fresh draft detail (and the stored path, for an upload).
 *
 * @module lib/themes/drafts/operations
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { ThemeFontSchema, ThemeManifestSchema, type ThemeFont } from '../engine';
import { normaliseBundlePath } from '../engine/css-text';
import { guessFontFromFileName, readFontInfo, type FontInfo, type FontNameGuess } from '../font-info';
import { validationContextFor } from '../theme-bundle';
import {
  DraftFileInUseError,
  DraftManifestInvalidError,
  DraftManifestRevisionConflictError,
  DraftManifestUnreadableError,
  DraftOperationRefusedError,
  REMOVABLE_KINDS,
  loadDraft,
  readDraft,
  rewriteManifest,
  type DraftDetail,
} from './service';
import { deleteDraftFile, writeDraftFile, type DraftFileEntry, type DraftsStore } from './store';
import { checkUploadContent, checkUploadLimits, storedUploadPath, type DraftUploadKind } from './uploads';

const logger = createServiceLogger('ThemeDraftOperations');

// ============================================================================
// Shapes
// ============================================================================

/** A file as it arrived: the name the browser gave (never trusted) and its bytes. */
export interface DraftUpload {
  fileName: string;
  bytes: Buffer;
}

export interface DraftOperationResult {
  draft: DraftDetail;
}

export interface DraftUploadResult extends DraftOperationResult {
  /** Where the file was stored in the draft. */
  path: string;
}

type FontDisplay = NonNullable<ThemeFont['display']>;
type FontStyleValue = NonNullable<ThemeFont['style']>;

export interface AddDraftFontInput {
  revision: string;
  file: DraftUpload;
  /** The licence chosen by the author (decision 4): an SPDX identifier or `proprietary`. */
  license: string;
  /** Defaults to what the font says, else the file-name guess. */
  family?: string;
  weight?: string;
  style?: FontStyleValue;
  display?: FontDisplay;
  /** A licence file already in the draft. */
  licenseFile?: string;
}

/** Fields of a font entry to change; `null` clears an optional one. */
export interface UpdateDraftFontFields {
  family?: string;
  weight?: string | null;
  style?: FontStyleValue | null;
  display?: FontDisplay | null;
  license?: string;
  licenseFile?: string | null;
}

/** One subsystem's override; a field left out stays, an empty string clears it. */
export interface DraftSubsystemFields {
  name?: string;
  description?: string;
  /** A picture in the draft, or `none`. */
  thumbnail?: string;
  backgroundImage?: string;
}

export type DraftAuthor = string | { name: string; email?: string; url?: string };

/** The manifest's own fields; a field left out stays, `null` (or an empty list) clears an optional one. */
export interface DraftManifestFields {
  name?: string;
  description?: string | null;
  author?: DraftAuthor;
  license?: string | null;
  tags?: string[];
  supportsDarkMode?: boolean;
  previewImage?: string | null;
}

/** What an uploaded font says it is, before it is added (writes nothing). */
export type UploadedFontReading =
  | { read: true; info: FontInfo }
  | { read: false; reason: string; guess: FontNameGuess; format: FontInfo['format'] | null };

// ============================================================================
// The common path
// ============================================================================

type ManifestEdit = (manifest: Record<string, unknown>) => void;

interface DraftContext {
  id: string;
  store: DraftsStore;
  files: DraftFileEntry[];
  detail: DraftDetail;
}

const queues = new Map<string, Promise<unknown>>();

/** Run one operation on a draft after any already running on it. */
function serialised<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  queues.set(id, settled);
  void settled.then(() => {
    if (queues.get(id) === settled) queues.delete(id);
  });
  return next;
}

/** Load the draft and hold the caller's manifest revision to it. */
async function open(id: string, revision: string): Promise<DraftContext> {
  const { store, files, read } = await loadDraft(id);
  if (read.detail.manifestRevision !== revision) {
    logger.debug('Theme draft operation refused: stale manifest revision', { draftId: id });
    throw new DraftManifestRevisionConflictError(read.detail.manifestRevision);
  }
  return { id, store, files, detail: read.detail };
}

/**
 * Apply `edit` to a copy of the manifest as read and hold the result to the
 * schema, before any file is written. A manifest that does not parse, or one
 * already invalid, refuses the operation with the reason.
 */
function dryRun(ctx: DraftContext, edit: ManifestEdit): void {
  if (!ctx.detail.manifest) {
    const reason = ctx.detail.issues.find((i) => i.message.startsWith('theme.json'))?.message ?? 'theme.json does not parse';
    throw new DraftManifestUnreadableError(ctx.id, reason.replace(/^theme\.json:\s*/, ''));
  }
  const copy = structuredClone(ctx.detail.manifest);
  edit(copy);
  const checked = ThemeManifestSchema.safeParse(copy);
  if (!checked.success) {
    const errors = checked.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    logger.debug('Theme draft operation refused: the manifest would not be valid', { draftId: ctx.id, errors });
    throw new DraftManifestInvalidError(errors);
  }
}

/** Write the edit, guarded by the revision read. */
function commit(ctx: DraftContext, edit: ManifestEdit): Promise<void> {
  return rewriteManifest(ctx.store, ctx.id, edit, { revision: ctx.detail.manifestRevision, validate: true });
}

const filePaths = (ctx: DraftContext) => ctx.files.map((f) => f.path);
const hasFile = (ctx: DraftContext, p: string) => ctx.files.some((f) => f.path === p);
const fileKind = (detail: DraftDetail, p: string) => detail.files.find((f) => f.path === p)?.kind;

/** Check an upload's bytes and limits; returns its stored extension. */
function checkUpload(ctx: DraftContext, kind: DraftUploadKind, file: DraftUpload, replacing?: string): string {
  const ext = checkUploadContent(kind, file.fileName, file.bytes);
  checkUploadLimits(file.fileName, file.bytes.length, ctx.files, replacing);
  return ext;
}

/** Store an upload that a manifest edit will name; on a refused edit the new file is removed again. */
async function writeThenCommit(ctx: DraftContext, stored: string, bytes: Buffer, edit: ManifestEdit, isNew: boolean): Promise<void> {
  await writeDraftFile(ctx.store, ctx.id, stored, bytes);
  try {
    await commit(ctx, edit);
  } catch (error) {
    if (isNew) {
      await deleteDraftFile(ctx.store, ctx.id, stored).catch((cleanup) => {
        logger.warn('Could not remove an upload whose manifest edit was refused', { draftId: ctx.id, file: stored, error: (cleanup as Error).message });
      });
    }
    throw error;
  }
}

/** After a manifest edit, delete each of `paths` that nothing uses any more. */
async function deleteIfUnused(id: string, store: DraftsStore, paths: Iterable<string>): Promise<string[]> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return [];
  const { read } = await loadDraft(id);
  const deleted: string[] = [];
  for (const p of unique) {
    const file = read.detail.files.find((f) => f.path === p);
    if (!file || file.users.length > 0) continue;
    if (await deleteDraftFile(store, id, p)) deleted.push(p);
  }
  if (deleted.length > 0) logger.debug('Deleted theme draft files nothing uses any more', { draftId: id, deleted });
  return deleted;
}

function requireImage(ctx: DraftContext, p: string, what: string): string {
  const normalised = normaliseBundlePath(p);
  if (!hasFile(ctx, normalised)) throw new DraftOperationRefusedError(`${what}: ${normalised} is not in the draft`);
  if (fileKind(ctx.detail, normalised) !== 'image') throw new DraftOperationRefusedError(`${what}: ${normalised} is not an image`);
  return normalised;
}

function fontsOf(manifest: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(manifest.fonts)) manifest.fonts = [];
  return manifest.fonts as Array<Record<string, unknown>>;
}

function fontAt(ctx: DraftContext, index: number): Record<string, unknown> {
  const fonts = ctx.detail.manifest && Array.isArray(ctx.detail.manifest.fonts) ? ctx.detail.manifest.fonts : [];
  const font = fonts[index] as Record<string, unknown> | undefined;
  if (!Number.isInteger(index) || !font || typeof font !== 'object') {
    throw new DraftOperationRefusedError(`There is no font #${index + 1} in the manifest`);
  }
  return font;
}

function requireLicenceFile(ctx: DraftContext, p: string): string {
  const normalised = normaliseBundlePath(p);
  if (!hasFile(ctx, normalised)) throw new DraftOperationRefusedError(`The licence file ${normalised} is not in the draft`);
  if (fileKind(ctx.detail, normalised) !== 'licence') throw new DraftOperationRefusedError(`${normalised} is not a licence file`);
  return normalised;
}

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ============================================================================
// Fonts
// ============================================================================

/** What an uploaded font says it is: read from the font, or guessed from its name. Writes nothing. */
export function readUploadedFont(file: DraftUpload): UploadedFontReading {
  checkUploadContent('font', file.fileName, file.bytes);
  checkUploadLimits(file.fileName, file.bytes.length, []);
  const read = readFontInfo(file.bytes);
  if (read.ok) return { read: true, info: read.info };
  logger.debug('An uploaded font could not be read; guessing from its name', { fileName: file.fileName, reason: read.reason });
  return { read: false, reason: read.reason, guess: guessFontFromFileName(file.fileName), format: read.format };
}

/** Store a font under `fonts/` and add its manifest entry. */
export function addDraftFont(id: string, input: AddDraftFontInput): Promise<DraftUploadResult> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    const ext = checkUpload(ctx, 'font', input.file);
    const reading = readUploadedFont(input.file);
    const known = reading.read ? reading.info : reading.guess;
    const stored = storedUploadPath('font', input.file.fileName, ext, filePaths(ctx));
    const entry: Record<string, unknown> = {
      family: (input.family ?? known.family).trim(),
      src: stored,
      weight: input.weight ?? known.weight,
      style: input.style ?? known.style,
      display: input.display ?? 'swap',
      license: input.license,
    };
    if (input.licenseFile) entry.licenseFile = requireLicenceFile(ctx, input.licenseFile);
    const checked = ThemeFontSchema.safeParse(entry);
    if (!checked.success) {
      throw new DraftManifestInvalidError(checked.error.issues.map((i) => `fonts.${i.path.join('.')}: ${i.message}`));
    }
    const edit: ManifestEdit = (m) => {
      fontsOf(m).push({ ...entry });
    };
    dryRun(ctx, edit);
    await writeThenCommit(ctx, stored, input.file.bytes, edit, true);
    logger.debug('Added a font to a theme draft', { draftId: id, file: stored, family: entry.family, read: reading.read });
    return { draft: await readDraft(id), path: stored };
  });
}

/** Change one font entry's fields. */
export function updateDraftFont(id: string, input: { revision: string; index: number; fields: UpdateDraftFontFields }): Promise<DraftOperationResult> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    fontAt(ctx, input.index);
    const { fields } = input;
    const licenseFile = fields.licenseFile ? requireLicenceFile(ctx, fields.licenseFile) : fields.licenseFile;
    const edit: ManifestEdit = (m) => {
      const font = fontsOf(m)[input.index];
      const set = (key: string, value: unknown) => {
        if (value === undefined) return;
        if (value === null) delete font[key];
        else font[key] = typeof value === 'string' ? value.trim() : value;
      };
      set('family', fields.family);
      set('weight', fields.weight);
      set('style', fields.style);
      set('display', fields.display);
      set('license', fields.license);
      set('licenseFile', licenseFile);
    };
    dryRun(ctx, edit);
    await commit(ctx, edit);
    logger.debug('Updated a font in a theme draft', { draftId: id, index: input.index, fields: Object.keys(fields) });
    return { draft: await readDraft(id) };
  });
}

/** Remove one font entry, then its file when nothing else uses it. */
export function removeDraftFont(id: string, input: { revision: string; index: number }): Promise<DraftOperationResult & { deleted: string[] }> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    const font = fontAt(ctx, input.index);
    const edit: ManifestEdit = (m) => {
      const fonts = fontsOf(m);
      fonts.splice(input.index, 1);
      if (fonts.length === 0) delete m.fonts;
    };
    dryRun(ctx, edit);
    await commit(ctx, edit);
    const src = typeof font.src === 'string' ? [normaliseBundlePath(font.src)] : [];
    const deleted = await deleteIfUnused(id, ctx.store, src);
    logger.debug('Removed a font from a theme draft', { draftId: id, index: input.index, deleted });
    return { draft: await readDraft(id), deleted };
  });
}

/** Store a licence file (`.txt` or `.md`) under `fonts/`. */
export function addDraftLicenceFile(id: string, input: { revision: string; file: DraftUpload }): Promise<DraftUploadResult> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    const ext = checkUpload(ctx, 'licence', input.file);
    const stored = storedUploadPath('licence', input.file.fileName, ext, filePaths(ctx));
    await writeDraftFile(ctx.store, id, stored, input.file.bytes);
    logger.debug('Added a licence file to a theme draft', { draftId: id, file: stored });
    return { draft: await readDraft(id), path: stored };
  });
}

// ============================================================================
// Images and files
// ============================================================================

/** Store an image under `images/`. */
export function addDraftImage(id: string, input: { revision: string; file: DraftUpload }): Promise<DraftUploadResult> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    const ext = checkUpload(ctx, 'image', input.file);
    const stored = storedUploadPath('image', input.file.fileName, ext, filePaths(ctx));
    await writeDraftFile(ctx.store, id, stored, input.file.bytes);
    logger.debug('Added an image to a theme draft', { draftId: id, file: stored, bytes: input.file.bytes.length });
    return { draft: await readDraft(id), path: stored };
  });
}

/** Delete an image, font or licence file; refused while anything uses it. */
export function removeDraftFile(id: string, input: { revision: string; path: string }): Promise<DraftOperationResult> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    const target = normaliseBundlePath(input.path);
    const file = ctx.detail.files.find((f) => f.path === target);
    if (!file) throw new DraftOperationRefusedError(`${target} is not in the draft`);
    if (!REMOVABLE_KINDS.has(file.kind)) throw new DraftOperationRefusedError(`${target} is not an image, font or licence file`);
    if (file.users.length > 0) {
      logger.debug('Theme draft file removal refused: in use', { draftId: id, file: target, users: file.usedBy });
      throw new DraftFileInUseError(target, file.usedBy);
    }
    await deleteDraftFile(ctx.store, id, target);
    logger.debug('Removed a file from a theme draft', { draftId: id, file: target });
    return { draft: await readDraft(id) };
  });
}

// ============================================================================
// Icons
// ============================================================================

function requireIconName(name: string): void {
  if (!validationContextFor(new Set()).iconNames.has(name)) {
    throw new DraftOperationRefusedError(`${JSON.stringify(name)} is not one of Quilltap's icons`);
  }
}

const iconPathOf = (detail: DraftDetail, name: string): string | null => {
  const p = record(detail.manifest?.icons)?.[name];
  return typeof p === 'string' ? normaliseBundlePath(p) : null;
};

/** Store an icon file under `icons/` and set it as the override for `name`. */
export function setDraftIcon(id: string, input: { revision: string; name: string; file: DraftUpload }): Promise<DraftUploadResult> {
  return serialised(id, async () => {
    requireIconName(input.name);
    const ctx = await open(id, input.revision);
    const previous = iconPathOf(ctx.detail, input.name);
    const ext = checkUploadContent('icon', input.file.fileName, input.file.bytes);
    // The file is named for the icon. A file of that name is replaced in
    // place only when this icon is all that uses it; otherwise the upload
    // gets a free name beside it.
    const wanted = `icons/${input.name}${ext}`;
    const existing = ctx.detail.files.find((f) => f.path === wanted);
    const inPlace = !!existing && existing.users.every((u) => u.kind === 'icon' && u.name === input.name);
    const stored = !existing || inPlace ? wanted : storedUploadPath('icon', input.name, ext, filePaths(ctx));
    checkUploadLimits(input.file.fileName, input.file.bytes.length, ctx.files, inPlace ? wanted : undefined);
    const edit: ManifestEdit = (m) => {
      const icons = record(m.icons) ?? {};
      icons[input.name] = stored;
      m.icons = icons;
    };
    dryRun(ctx, edit);
    await writeThenCommit(ctx, stored, input.file.bytes, edit, !existing);
    const deleted = previous && previous !== stored ? await deleteIfUnused(id, ctx.store, [previous]) : [];
    logger.debug('Set a theme draft icon override', { draftId: id, icon: input.name, file: stored, replacedInPlace: inPlace, deleted });
    return { draft: await readDraft(id), path: stored };
  });
}

/** Remove the override for `name`, then its file when nothing else uses it. */
export function clearDraftIcon(id: string, input: { revision: string; name: string }): Promise<DraftOperationResult & { deleted: string[] }> {
  return serialised(id, async () => {
    requireIconName(input.name);
    const ctx = await open(id, input.revision);
    const previous = iconPathOf(ctx.detail, input.name);
    if (!previous) throw new DraftOperationRefusedError(`The icon ${input.name} has no override in this draft`);
    const edit: ManifestEdit = (m) => {
      const icons = record(m.icons);
      if (!icons) return;
      delete icons[input.name];
      if (Object.keys(icons).length === 0) delete m.icons;
    };
    dryRun(ctx, edit);
    await commit(ctx, edit);
    const deleted = await deleteIfUnused(id, ctx.store, [previous]);
    logger.debug('Cleared a theme draft icon override', { draftId: id, icon: input.name, deleted });
    return { draft: await readDraft(id), deleted };
  });
}

// ============================================================================
// Subsystems
// ============================================================================

/** Set or clear one subsystem's name, description and pictures. */
export function setDraftSubsystem(id: string, input: { revision: string; subsystem: string; fields: DraftSubsystemFields }): Promise<DraftOperationResult> {
  return serialised(id, async () => {
    if (!validationContextFor(new Set()).subsystemIds.has(input.subsystem)) {
      throw new DraftOperationRefusedError(`${JSON.stringify(input.subsystem)} is not one of Quilltap's subsystems`);
    }
    const ctx = await open(id, input.revision);
    const { fields } = input;
    const picture = (value: string | undefined, what: string) =>
      value === undefined || value === '' || value === 'none' ? value : requireImage(ctx, value, what);
    const thumbnail = picture(fields.thumbnail, 'The thumbnail');
    const backgroundImage = picture(fields.backgroundImage, 'The background picture');
    const edit: ManifestEdit = (m) => {
      const subsystems = record(m.subsystems) ?? {};
      const entry = record(subsystems[input.subsystem]) ?? {};
      const set = (key: string, value: string | undefined) => {
        if (value === undefined) return;
        if (value === '') delete entry[key];
        else entry[key] = value;
      };
      set('name', fields.name?.trim());
      set('description', fields.description?.trim());
      set('thumbnail', thumbnail);
      set('backgroundImage', backgroundImage);
      if (Object.keys(entry).length > 0) subsystems[input.subsystem] = entry;
      else delete subsystems[input.subsystem];
      if (Object.keys(subsystems).length > 0) m.subsystems = subsystems;
      else delete m.subsystems;
    };
    dryRun(ctx, edit);
    await commit(ctx, edit);
    logger.debug('Set a theme draft subsystem override', { draftId: id, subsystem: input.subsystem, fields: Object.keys(fields) });
    return { draft: await readDraft(id) };
  });
}

// ============================================================================
// The manifest's own fields
// ============================================================================

/** Change the manifest's name, description, author, licence, tags, dark-mode flag or preview image. The id never changes (decision 10). */
export function setDraftManifestFields(id: string, input: { revision: string; fields: DraftManifestFields }): Promise<DraftOperationResult> {
  return serialised(id, async () => {
    const ctx = await open(id, input.revision);
    const { fields } = input;
    const previewImage = fields.previewImage ? requireImage(ctx, fields.previewImage, 'The preview image') : fields.previewImage;
    const edit: ManifestEdit = (m) => {
      const set = (key: string, value: unknown) => {
        if (value === undefined) return;
        if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) delete m[key];
        else m[key] = value;
      };
      set('name', fields.name?.trim());
      set('description', typeof fields.description === 'string' ? fields.description.trim() : fields.description);
      set('author', typeof fields.author === 'string' ? fields.author.trim() : fields.author);
      set('license', fields.license);
      set('tags', fields.tags?.map((t) => t.trim()).filter((t) => t !== ''));
      set('supportsDarkMode', fields.supportsDarkMode);
      set('previewImage', previewImage);
    };
    dryRun(ctx, edit);
    await commit(ctx, edit);
    logger.debug('Set theme draft manifest fields', { draftId: id, fields: Object.keys(fields) });
    return { draft: await readDraft(id) };
  });
}
