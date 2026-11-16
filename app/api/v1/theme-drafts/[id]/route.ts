/**
 * One theme draft (Calliope Live, Spec D)
 *
 * GET    /api/v1/theme-drafts/[id]                         - The draft: tokens, revisions, compiled parts, files and their users, totals, issues
 * PUT    /api/v1/theme-drafts/[id]                         - Save `{ revision, tokens }`, or the stylesheet `{ stylesRevision, css }`; 409 when the revision is stale
 * DELETE /api/v1/theme-drafts/[id]                         - Delete the draft folder (an installed copy stays)
 * POST   /api/v1/theme-drafts/[id]?action=install          - Install the draft as a theme (422 when it has errors)
 *
 * Manifest and file operations (Calliope Live, Spec F §0.4). Each takes the
 * `manifestRevision` it read (409 with `currentManifestRevision` when stale)
 * and returns the fresh draft. Uploads are multipart, the file in `file`:
 * POST ?action=read-font          - (multipart) what a font says it is; writes nothing
 * POST ?action=add-font           - (multipart) `license`, optional family / weight / style / display / licenseFile
 * POST ?action=update-font        - `{ index, fields }`
 * POST ?action=remove-font        - `{ index }`; the file goes too when nothing else uses it
 * POST ?action=add-licence-file   - (multipart) a .txt or .md licence file
 * POST ?action=add-image          - (multipart) an image
 * POST ?action=remove-file        - `{ path }`; 409 with `usedBy` while anything uses it
 * POST ?action=set-icon           - (multipart) `name`, the icon file (.svg or .webp)
 * POST ?action=clear-icon         - `{ name }`
 * POST ?action=set-subsystem      - `{ subsystem, fields }`; an empty field clears it
 * POST ?action=set-manifest       - `{ fields }`: name, description, author, license, tags, supportsDarkMode, previewImage
 * POST ?action=set-styles-file    - `{}`: name `styles.css` as the custom stylesheet, creating it when absent (Spec G)
 * POST ?action=clear-styles-file  - `{ deleteFile? }`: stop using the stylesheet; delete the file too when asked
 */

import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { withActionDispatch, type ActionHandler } from '@/lib/api/middleware/actions';
import { badRequest, messageResponse, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { ThemeTokensDocumentSchema } from '@/lib/themes/engine';

const getDrafts = () => import('@/lib/themes/drafts');
const getDraftErrors = () => import('@/lib/themes/drafts/api-errors');
const getPluginInit = () => import('@/lib/startup/plugin-initialization');

async function ensureThemesLoaded() {
  const { isPluginSystemInitialized, initializePlugins } = await getPluginInit();
  if (!isPluginSystemInitialized()) await initializePlugins();
}

const SaveDraftSchema = z.union([
  z.strictObject({
    revision: z.string().min(1),
    tokens: ThemeTokensDocumentSchema,
  }),
  z.strictObject({
    stylesRevision: z.string().min(1),
    // Bytes are held to the bundle's per-file limit by the drafts module.
    css: z.string(),
  }),
]);

const manifestRevision = z.string().min(1);
const fontStyle = z.enum(['normal', 'italic', 'oblique']);
const fontDisplay = z.enum(['auto', 'block', 'swap', 'fallback', 'optional']);
const fontWeight = z.string().trim().min(1).max(20);
const licence = z.string().trim().min(1).max(200);
const bundlePath = z.string().trim().min(1).max(300);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

// Multipart fields: every value is text, held to a strict schema like JSON.
const ReadFontFormSchema = z.strictObject({});
const AddFontFormSchema = z.strictObject({
  manifestRevision,
  license: licence,
  family: optionalText(100),
  weight: optionalText(20),
  style: fontStyle.optional(),
  display: fontDisplay.optional(),
  licenseFile: optionalText(300),
});
const UploadFormSchema = z.strictObject({ manifestRevision });
const SetIconFormSchema = z.strictObject({ manifestRevision, name: z.string().trim().min(1).max(60) });

const UpdateFontSchema = z.strictObject({
  manifestRevision,
  index: z.number().int().min(0),
  fields: z.strictObject({
    family: z.string().trim().min(1).max(100).optional(),
    weight: fontWeight.nullable().optional(),
    style: fontStyle.nullable().optional(),
    display: fontDisplay.nullable().optional(),
    license: licence.optional(),
    licenseFile: bundlePath.nullable().optional(),
  }),
});
const RemoveFontSchema = z.strictObject({ manifestRevision, index: z.number().int().min(0) });
const RemoveFileSchema = z.strictObject({ manifestRevision, path: bundlePath });
const ClearIconSchema = z.strictObject({ manifestRevision, name: z.string().trim().min(1).max(60) });
const SetSubsystemSchema = z.strictObject({
  manifestRevision,
  subsystem: z.string().trim().min(1).max(60),
  fields: z.strictObject({
    name: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    thumbnail: z.string().max(300).optional(),
    backgroundImage: z.string().max(300).optional(),
  }),
});
const AuthorSchema = z.union([
  z.string().trim().min(1).max(200),
  z.strictObject({ name: z.string().trim().min(1).max(200), email: z.string().max(200).optional(), url: z.string().max(500).optional() }),
]);
const SetManifestSchema = z.strictObject({
  manifestRevision,
  fields: z.strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    author: AuthorSchema.optional(),
    license: licence.nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    supportsDarkMode: z.boolean().optional(),
    previewImage: bundlePath.nullable().optional(),
  }),
});

/**
 * A multipart upload: the file in `file`, every other field once, held to
 * `schema`. The name the browser sent is kept only as a hint; the drafts
 * module builds the stored name.
 */
async function readUpload<S extends z.ZodType>(request: NextRequest, schema: S): Promise<{ file: { fileName: string; bytes: Buffer }; fields: z.infer<S> }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) throw new UploadShapeError('Expected multipart/form-data with the file in "file"');
  const form = await request.formData();
  const file = form.getAll('file');
  if (file.length !== 1 || !(file[0] instanceof File)) throw new UploadShapeError('Expected exactly one file in "file"');
  const raw: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key === 'file') continue;
    if (typeof value !== 'string') throw new UploadShapeError(`"${key}" must be text`);
    if (key in raw) throw new UploadShapeError(`"${key}" was sent more than once`);
    raw[key] = value;
  }
  const upload = file[0];
  return { file: { fileName: upload.name, bytes: Buffer.from(await upload.arrayBuffer()) }, fields: schema.parse(raw) };
}

class UploadShapeError extends Error {}

/** Run a drafts call, answering its known errors; anything else is the middleware's 500. */
async function answering<T>(run: () => Promise<T>, respond: (value: T) => NextResponse): Promise<NextResponse> {
  try {
    return respond(await run());
  } catch (error) {
    if (error instanceof UploadShapeError) return badRequest(error.message);
    const response = (await getDraftErrors()).draftErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

type Handler = ActionHandler<{ id: string }>;

const handleGet: Handler = async (_req, _ctx, { id }) => {
  const { readDraft } = await getDrafts();
  logger.debug('Reading theme draft', { context: 'theme-drafts-api', draftId: id });
  return answering(() => readDraft(id), (draft) => successResponse({ draft }));
};

const handlePut: Handler = async (request, _ctx, { id }) => {
  const body = SaveDraftSchema.parse(await request.json());
  const { writeDraftTokens, writeDraftStyles } = await getDrafts();
  if ('css' in body) {
    logger.debug('Saving theme draft stylesheet', { context: 'theme-drafts-api', draftId: id, chars: body.css.length });
    return answering(() => writeDraftStyles(id, { revision: body.stylesRevision, css: body.css }), (draft) => successResponse({ draft }));
  }
  logger.debug('Saving theme draft tokens', { context: 'theme-drafts-api', draftId: id });
  return answering(() => writeDraftTokens(id, { revision: body.revision, tokens: body.tokens }), (draft) => successResponse({ draft }));
};

const handleDelete: Handler = async (_req, _ctx, { id }) => {
  const { deleteDraft } = await getDrafts();
  return answering(() => deleteDraft(id), () => messageResponse('Theme draft deleted'));
};

const handleInstall: Handler = async (_req, _ctx, { id }) => {
  await ensureThemesLoaded();
  const { installDraft } = await getDrafts();
  logger.info('Installing theme draft', { context: 'theme-drafts-api', draftId: id });
  return answering(() => installDraft(id), (result) => successResponse({ result }));
};

// ----------------------------------------------------------------------------
// Manifest and file operations (Spec F)
// ----------------------------------------------------------------------------

const respondDraft = (result: { draft: unknown; path?: string; deleted?: string[]; created?: boolean }) => successResponse(result);

const handleReadFont: Handler = async (request, _ctx, { id }) => {
  const drafts = await getDrafts();
  return answering(async () => {
    if (!drafts.isValidDraftId(id)) throw new drafts.ThemeDraftNotFoundError(id);
    const { file } = await readUpload(request, ReadFontFormSchema);
    logger.debug('Reading an uploaded font for a theme draft', { context: 'theme-drafts-api', draftId: id, bytes: file.bytes.length });
    return drafts.readUploadedFont(file);
  }, (font) => successResponse({ font }));
};

const handleAddFont: Handler = async (request, _ctx, { id }) => {
  const { addDraftFont } = await getDrafts();
  return answering(async () => {
    const { file, fields } = await readUpload(request, AddFontFormSchema);
    logger.debug('Adding a font to a theme draft', { context: 'theme-drafts-api', draftId: id, bytes: file.bytes.length });
    const { manifestRevision: revision, ...rest } = fields;
    return addDraftFont(id, { revision, file, ...rest });
  }, respondDraft);
};

const handleUpdateFont: Handler = async (request, _ctx, { id }) => {
  const body = UpdateFontSchema.parse(await request.json());
  const { updateDraftFont } = await getDrafts();
  logger.debug('Updating a theme draft font', { context: 'theme-drafts-api', draftId: id, index: body.index });
  return answering(() => updateDraftFont(id, { revision: body.manifestRevision, index: body.index, fields: body.fields }), respondDraft);
};

const handleRemoveFont: Handler = async (request, _ctx, { id }) => {
  const body = RemoveFontSchema.parse(await request.json());
  const { removeDraftFont } = await getDrafts();
  logger.debug('Removing a theme draft font', { context: 'theme-drafts-api', draftId: id, index: body.index });
  return answering(() => removeDraftFont(id, { revision: body.manifestRevision, index: body.index }), respondDraft);
};

const handleAddLicenceFile: Handler = async (request, _ctx, { id }) => {
  const { addDraftLicenceFile } = await getDrafts();
  return answering(async () => {
    const { file, fields } = await readUpload(request, UploadFormSchema);
    logger.debug('Adding a licence file to a theme draft', { context: 'theme-drafts-api', draftId: id, bytes: file.bytes.length });
    return addDraftLicenceFile(id, { revision: fields.manifestRevision, file });
  }, respondDraft);
};

const handleAddImage: Handler = async (request, _ctx, { id }) => {
  const { addDraftImage } = await getDrafts();
  return answering(async () => {
    const { file, fields } = await readUpload(request, UploadFormSchema);
    logger.debug('Adding an image to a theme draft', { context: 'theme-drafts-api', draftId: id, bytes: file.bytes.length });
    return addDraftImage(id, { revision: fields.manifestRevision, file });
  }, respondDraft);
};

const handleRemoveFile: Handler = async (request, _ctx, { id }) => {
  const body = RemoveFileSchema.parse(await request.json());
  const { removeDraftFile } = await getDrafts();
  logger.debug('Removing a theme draft file', { context: 'theme-drafts-api', draftId: id, path: body.path });
  return answering(() => removeDraftFile(id, { revision: body.manifestRevision, path: body.path }), respondDraft);
};

const handleSetIcon: Handler = async (request, _ctx, { id }) => {
  const { setDraftIcon } = await getDrafts();
  return answering(async () => {
    const { file, fields } = await readUpload(request, SetIconFormSchema);
    logger.debug('Setting a theme draft icon', { context: 'theme-drafts-api', draftId: id, icon: fields.name, bytes: file.bytes.length });
    return setDraftIcon(id, { revision: fields.manifestRevision, name: fields.name, file });
  }, respondDraft);
};

const handleClearIcon: Handler = async (request, _ctx, { id }) => {
  const body = ClearIconSchema.parse(await request.json());
  const { clearDraftIcon } = await getDrafts();
  logger.debug('Clearing a theme draft icon', { context: 'theme-drafts-api', draftId: id, icon: body.name });
  return answering(() => clearDraftIcon(id, { revision: body.manifestRevision, name: body.name }), respondDraft);
};

const handleSetSubsystem: Handler = async (request, _ctx, { id }) => {
  const body = SetSubsystemSchema.parse(await request.json());
  const { setDraftSubsystem } = await getDrafts();
  logger.debug('Setting a theme draft subsystem', { context: 'theme-drafts-api', draftId: id, subsystem: body.subsystem });
  return answering(() => setDraftSubsystem(id, { revision: body.manifestRevision, subsystem: body.subsystem, fields: body.fields }), respondDraft);
};

const handleSetManifest: Handler = async (request, _ctx, { id }) => {
  const body = SetManifestSchema.parse(await request.json());
  const { setDraftManifestFields } = await getDrafts();
  logger.debug('Setting theme draft manifest fields', { context: 'theme-drafts-api', draftId: id, fields: Object.keys(body.fields) });
  return answering(() => setDraftManifestFields(id, { revision: body.manifestRevision, fields: body.fields }), respondDraft);
};

const SetStylesFileSchema = z.strictObject({ manifestRevision });
const ClearStylesFileSchema = z.strictObject({ manifestRevision, deleteFile: z.boolean().optional() });

const handleSetStylesFile: Handler = async (request, _ctx, { id }) => {
  const body = SetStylesFileSchema.parse(await request.json());
  const { setDraftStylesFile } = await getDrafts();
  logger.debug('Setting a theme draft stylesheet', { context: 'theme-drafts-api', draftId: id });
  return answering(() => setDraftStylesFile(id, { revision: body.manifestRevision }), respondDraft);
};

const handleClearStylesFile: Handler = async (request, _ctx, { id }) => {
  const body = ClearStylesFileSchema.parse(await request.json());
  const { clearDraftStylesFile } = await getDrafts();
  logger.debug('Clearing a theme draft stylesheet', { context: 'theme-drafts-api', draftId: id, deleteFile: body.deleteFile === true });
  return answering(() => clearDraftStylesFile(id, { revision: body.manifestRevision, deleteFile: body.deleteFile }), respondDraft);
};

export const GET = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handleGet));
export const PUT = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handlePut));
export const DELETE = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handleDelete));
export const POST = createContextParamsHandler<{ id: string }>(
  withActionDispatch({
    install: handleInstall,
    'read-font': handleReadFont,
    'add-font': handleAddFont,
    'update-font': handleUpdateFont,
    'remove-font': handleRemoveFont,
    'add-licence-file': handleAddLicenceFile,
    'add-image': handleAddImage,
    'remove-file': handleRemoveFile,
    'set-icon': handleSetIcon,
    'clear-icon': handleClearIcon,
    'set-subsystem': handleSetSubsystem,
    'set-manifest': handleSetManifest,
    'set-styles-file': handleSetStylesFile,
    'clear-styles-file': handleClearStylesFile,
  }),
);
