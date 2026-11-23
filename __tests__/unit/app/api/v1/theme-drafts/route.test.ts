/**
 * @jest-environment node
 *
 * The theme-drafts routes' Spec G additions: `?action=import` (multipart,
 * refused on its length before the body is read), the stylesheet save on
 * `PUT`, and the two stylesheet actions. The drafts module is mocked; its own
 * suites cover what it does.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: unknown, ctx: unknown) => Promise<unknown>) => async (req: unknown) => handler(req, { repos: {} }),
  createContextParamsHandler:
    (handler: (req: unknown, ctx: unknown, params: unknown) => Promise<unknown>) =>
    async (req: unknown, route: { params: Promise<unknown> }) =>
      handler(req, { repos: {} }, await route.params),
}));

jest.mock('@/lib/startup/plugin-initialization', () => ({
  isPluginSystemInitialized: () => true,
  initializePlugins: jest.fn(),
}));

jest.mock('@/lib/themes/drafts', () => ({
  importDraft: jest.fn(),
  writeDraftTokens: jest.fn(),
  writeDraftStyles: jest.fn(),
  setDraftStylesFile: jest.fn(),
  clearDraftStylesFile: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST as postCollection } from '@/app/api/v1/theme-drafts/route';
import { POST as postItem, PUT as putItem } from '@/app/api/v1/theme-drafts/[id]/route';
import * as drafts from '@/lib/themes/drafts';
import { MAX_BUNDLE_SIZE } from '@/lib/themes/bundle-archive';

const importDraft = drafts.importDraft as jest.Mock;
const writeDraftStyles = drafts.writeDraftStyles as jest.Mock;
const writeDraftTokens = drafts.writeDraftTokens as jest.Mock;
const setDraftStylesFile = drafts.setDraftStylesFile as jest.Mock;
const clearDraftStylesFile = drafts.clearDraftStylesFile as jest.Mock;

beforeEach(() => jest.clearAllMocks());

/** A multipart request whose body is built by Request, with the length we choose to claim. */
async function multipart(url: string, form: FormData, length?: number | null): Promise<NextRequest> {
  const encoded = new Request('http://localhost/', { method: 'POST', body: form });
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = new Headers({ 'content-type': encoded.headers.get('content-type')! });
  if (length !== null) headers.set('content-length', String(length ?? body.length));
  return new NextRequest(url, { method: 'POST', body, headers });
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/v1/theme-drafts?action=import', () => {
  const URL = 'http://localhost/api/v1/theme-drafts?action=import';

  it('opens the uploaded archive as a draft', async () => {
    importDraft.mockResolvedValue({ draft: { id: 'rains-2' }, bundleId: 'rains', idChanged: true });
    const form = new FormData();
    form.append('file', new File([Buffer.from('PK-archive')], 'rains.qtap-theme'));
    const res = await postCollection(await multipart(URL, form));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ draft: { id: 'rains-2' }, bundleId: 'rains', idChanged: true });
    expect(importDraft).toHaveBeenCalledWith({ fileName: 'rains.qtap-theme', bytes: Buffer.from('PK-archive') });
  });

  it('refuses an upload that claims more than the bundle limit, without reading it', async () => {
    const form = new FormData();
    form.append('file', new File([Buffer.from('x')], 'big.qtap-theme'));
    const res = await postCollection(await multipart(URL, form, MAX_BUNDLE_SIZE * 2));
    expect(res.status).toBe(413);
    expect(importDraft).not.toHaveBeenCalled();
  });

  it('asks for a length when the upload gives none', async () => {
    const form = new FormData();
    form.append('file', new File([Buffer.from('x')], 'a.qtap-theme'));
    const res = await postCollection(await multipart(URL, form, null));
    expect(res.status).toBe(411);
    expect(importDraft).not.toHaveBeenCalled();
  });

  it('refuses a field beside the file', async () => {
    const form = new FormData();
    form.append('file', new File([Buffer.from('x')], 'a.qtap-theme'));
    form.append('name', 'Other');
    const res = await postCollection(await multipart(URL, form));
    expect(res.status).toBe(400);
    expect(importDraft).not.toHaveBeenCalled();
  });

  it('answers a refused archive with 422 and its errors', async () => {
    const { DraftImportRefusedError } = jest.requireActual('@/lib/themes/drafts');
    importDraft.mockRejectedValue(new DraftImportRefusedError('The archive is not a theme that would install: x', ['x']));
    const form = new FormData();
    form.append('file', new File([Buffer.from('x')], 'a.qtap-theme'));
    const res = await postCollection(await multipart(URL, form));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ details: { errors: ['x'], reason: 'invalid' } });
  });
});

describe('PUT /api/v1/theme-drafts/[id]', () => {
  const URL = 'http://localhost/api/v1/theme-drafts/rains-2';

  it('saves the stylesheet from { stylesRevision, css }', async () => {
    writeDraftStyles.mockResolvedValue({ id: 'rains-2' });
    const res = await putItem(json(URL, 'PUT', { stylesRevision: 'abc', css: '.qt-card {}\n' }), params('rains-2'));
    expect(res.status).toBe(200);
    expect(writeDraftStyles).toHaveBeenCalledWith('rains-2', { revision: 'abc', css: '.qt-card {}\n' });
    expect(writeDraftTokens).not.toHaveBeenCalled();
  });

  it('still saves tokens from { revision, tokens }', async () => {
    writeDraftTokens.mockResolvedValue({ id: 'rains-2' });
    const tokens = { primitives: {}, tokens: {}, choices: {} };
    const res = await putItem(json(URL, 'PUT', { revision: 'r1', tokens }), params('rains-2'));
    expect(res.status).toBe(200);
    expect(writeDraftTokens).toHaveBeenCalledWith('rains-2', { revision: 'r1', tokens });
  });

  it('refuses a body that mixes the two (the middleware answers the ZodError with 400)', async () => {
    await expect(putItem(json(URL, 'PUT', { stylesRevision: 'abc', css: '', revision: 'r1' }), params('rains-2'))).rejects.toMatchObject({ name: 'ZodError' });
    expect(writeDraftStyles).not.toHaveBeenCalled();
  });
});

describe('the stylesheet actions', () => {
  it('set-styles-file passes the manifest revision', async () => {
    setDraftStylesFile.mockResolvedValue({ draft: { id: 'd' }, path: 'styles.css', created: true });
    const res = await postItem(json('http://localhost/api/v1/theme-drafts/d?action=set-styles-file', 'POST', { manifestRevision: 'm1' }), params('d'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ path: 'styles.css', created: true });
    expect(setDraftStylesFile).toHaveBeenCalledWith('d', { revision: 'm1' });
  });

  it('clear-styles-file passes deleteFile', async () => {
    clearDraftStylesFile.mockResolvedValue({ draft: { id: 'd' }, deleted: ['styles.css'] });
    const res = await postItem(
      json('http://localhost/api/v1/theme-drafts/d?action=clear-styles-file', 'POST', { manifestRevision: 'm1', deleteFile: true }),
      params('d'),
    );
    expect(res.status).toBe(200);
    expect(clearDraftStylesFile).toHaveBeenCalledWith('d', { revision: 'm1', deleteFile: true });
  });
});
