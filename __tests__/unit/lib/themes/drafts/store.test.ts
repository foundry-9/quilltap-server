/**
 * @jest-environment node
 *
 * The drafts' door to Quilltap General (`lib/themes/drafts/store.ts`): an id
 * is checked before it reaches a path, a file is resolved inside its draft
 * folder, and the result is handed to the operator's own path resolver — so
 * nothing the drafts module is given can name a file outside `Themes/<id>/`.
 * Also: which answers an asset URL, an installed theme or a draft.
 */

const mockResolveOperatorDocPath = jest.fn(async (_ctx: unknown, args: { filePath: string; mountPoint: string }) => ({
  relativePath: args.filePath,
  mountPointId: 'general',
  mountType: 'database',
}));
jest.mock('@/lib/documents/operator-doc-actions', () => ({
  STANDALONE_ACCESS_CONTEXT: {},
  resolveOperatorDocPath: (...args: [unknown, { filePath: string; mountPoint: string }]) => mockResolveOperatorDocPath(...args),
}));
jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: async () => 'general' }));
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: () => ({}) }));
jest.mock('@/lib/mount-index/store-file', () => ({ storeMountFile: jest.fn() }));
jest.mock('@/lib/mount-index/database-store', () => ({ listDatabaseFiles: jest.fn() }));
jest.mock('@/lib/mount-index/folder-ops', () => ({ deleteFolder: jest.fn() }));
jest.mock('@/lib/documents/core', () => ({ readDocument: jest.fn(), readDocumentBytes: jest.fn(), writeDocument: jest.fn() }));

import { resolveDraftFile } from '@/lib/themes/drafts/store';
import { registryAnswers } from '@/lib/themes/drafts/serve';

const store = { mountPointId: 'general', name: 'Quilltap General' };

beforeEach(() => mockResolveOperatorDocPath.mockClear());

describe('resolveDraftFile', () => {
  it('resolves a file inside its draft folder in General', async () => {
    const resolved = await resolveDraftFile(store, 'my-theme', 'fonts/a.woff2');
    expect(resolved.relativePath).toBe('Themes/my-theme/fonts/a.woff2');
    expect(mockResolveOperatorDocPath).toHaveBeenCalledWith({}, {
      scope: 'document_store',
      mountPoint: 'Quilltap General',
      filePath: 'Themes/my-theme/fonts/a.woff2',
    });
  });

  it.each(['../other', 'My Theme', '', 'a/b', '..'])('refuses the id %p before any path is built', async (id) => {
    await expect(resolveDraftFile(store, id, 'theme.json')).rejects.toThrow('Not a valid theme draft id');
    expect(mockResolveOperatorDocPath).not.toHaveBeenCalled();
  });

  it.each(['../other/theme.json', '../../Secrets.md', '/etc/passwd', '.', 'fonts/../../x'])(
    'refuses the file %p that would leave the draft folder',
    async (file) => {
      await expect(resolveDraftFile(store, 'my-theme', file)).rejects.toThrow();
      expect(mockResolveOperatorDocPath).not.toHaveBeenCalled();
    },
  );
});

describe('registryAnswers', () => {
  it('an installed theme answers its own version, or a URL with none', () => {
    expect(registryAnswers('1.0.0', '1.0.0')).toBe(true);
    expect(registryAnswers('1.0.0', null)).toBe(true);
  });

  it('a draft may answer a different version, or an id nothing installed holds', () => {
    expect(registryAnswers('1.0.0', '1.0.1')).toBe(false);
    expect(registryAnswers(undefined, '0.1.0')).toBe(false);
    expect(registryAnswers(undefined, null)).toBe(false);
  });
});
