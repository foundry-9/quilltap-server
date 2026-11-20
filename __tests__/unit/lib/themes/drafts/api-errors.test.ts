/** @jest-environment node */

import { draftErrorResponse } from '@/lib/themes/drafts/api-errors';
import {
  DraftFileInUseError,
  DraftImportRefusedError,
  DraftManifestInvalidError,
  DraftManifestRevisionConflictError,
  DraftManifestUnreadableError,
  DraftNotInstallableError,
  DraftOperationRefusedError,
  DraftRevisionConflictError,
  DraftSourceNotFoundError,
  ThemeDraftNotFoundError,
} from '@/lib/themes/drafts/service';
import { ThemeDraftStoreUnavailableError } from '@/lib/themes/drafts/store';
import { DraftUploadRefusedError } from '@/lib/themes/drafts/uploads';

async function parts(error: unknown) {
  const res = draftErrorResponse(error);
  if (!res) return null;
  return { status: res.status, body: await res.json() };
}

describe('draftErrorResponse', () => {
  it('maps a missing draft to 404', async () => {
    const r = await parts(new ThemeDraftNotFoundError('abc'));
    expect(r?.status).toBe(404);
    expect(r?.body.error).toBe('Theme draft not found');
  });

  it('maps tokens/styles revision conflicts to 409 with currentRevision', async () => {
    const r = await parts(new DraftRevisionConflictError('rev1'));
    expect(r?.status).toBe(409);
    expect(r?.body.details).toEqual({ currentRevision: 'rev1' });
  });

  it('maps manifest revision conflicts to 409 with currentManifestRevision', async () => {
    const r = await parts(new DraftManifestRevisionConflictError('m2'));
    expect(r?.status).toBe(409);
    expect(r?.body.details).toEqual({ currentManifestRevision: 'm2' });
  });

  it('maps an unreadable manifest to 409 without details', async () => {
    const r = await parts(new DraftManifestUnreadableError('d', 'bad token'));
    expect(r?.status).toBe(409);
    expect(r?.body.error).toContain('bad token');
    expect(r?.body.details).toBeUndefined();
  });

  it('maps an invalid manifest to 422 with the errors', async () => {
    const r = await parts(new DraftManifestInvalidError(['e1', 'e2']));
    expect(r?.status).toBe(422);
    expect(r?.body.details).toEqual({ errors: ['e1', 'e2'] });
  });

  it('maps a file in use to 409 with path and users', async () => {
    const r = await parts(new DraftFileInUseError('fonts/a.woff2', ['tokens', 'styles']));
    expect(r?.status).toBe(409);
    expect(r?.body.details).toEqual({ path: 'fonts/a.woff2', usedBy: ['tokens', 'styles'] });
  });

  it('maps a refused operation to 400', async () => {
    const r = await parts(new DraftOperationRefusedError('unknown icon'));
    expect(r?.status).toBe(400);
    expect(r?.body.error).toBe('unknown icon');
  });

  it('maps upload refusals by reason: limit 413, content 422', async () => {
    expect((await parts(new DraftUploadRefusedError('too big', 'limit')))?.status).toBe(413);
    expect((await parts(new DraftUploadRefusedError('not a png', 'content')))?.status).toBe(422);
    expect((await parts(new DraftUploadRefusedError('default')))?.status).toBe(422);
  });

  it('maps a non-installable draft to 422 with the errors', async () => {
    const r = await parts(new DraftNotInstallableError(['x']));
    expect(r?.status).toBe(422);
    expect(r?.body.details).toEqual({ errors: ['x'] });
  });

  it('maps a missing source theme to 400', async () => {
    const r = await parts(new DraftSourceNotFoundError('ghost'));
    expect(r?.status).toBe(400);
    expect(r?.body.error).toContain('ghost');
  });

  it('maps import refusals by reason, carrying errors and reason', async () => {
    const limit = await parts(new DraftImportRefusedError('big', ['a'], 'limit'));
    expect(limit?.status).toBe(413);
    expect(limit?.body.details).toEqual({ errors: ['a'], reason: 'limit' });
    const refused = await parts(new DraftImportRefusedError('old', ['b'], 'refused'));
    expect(refused?.status).toBe(422);
    expect(refused?.body.details.reason).toBe('refused');
    const invalid = await parts(new DraftImportRefusedError('bad', []));
    expect(invalid?.status).toBe(422);
    expect(invalid?.body.details.reason).toBe('invalid');
  });

  it('maps an unavailable store to 503', async () => {
    expect((await parts(new ThemeDraftStoreUnavailableError()))?.status).toBe(503);
  });

  it('returns null for unknown errors and non-errors', () => {
    expect(draftErrorResponse(new Error('boom'))).toBeNull();
    expect(draftErrorResponse('string')).toBeNull();
    expect(draftErrorResponse(undefined)).toBeNull();
  });
});
