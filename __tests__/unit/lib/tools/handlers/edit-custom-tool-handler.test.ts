/**
 * `edit_custom_tool` — Pascal's definition editor.
 *
 * The validator stays REAL: the point of the tool is that a file it accepts is
 * a file the roster loads, so the assertion is made against the same judgement
 * discovery uses. What is mocked is the document layer underneath — the store
 * resolution, the read, and `doc_write_file`'s handler, which is where every
 * save must land.
 */

import { executeEditCustomTool, formatEditCustomToolResults } from '@/lib/tools/handlers/edit-custom-tool-handler';
import { loadToolsFromMount, toolDefinitionPathFor, validateToolDefinitionText } from '@/lib/pascal/custom-tools';
import { resolveDocEditPath, readFileWithMtime } from '@/lib/doc-edit';
import { handleWriteFile } from '@/lib/tools/handlers/doc-edit/text-handlers';
import {
  assertCharacterMayRead,
  buildReadResolutionContext,
  buildWriteResolutionContext,
  uriForResolvedPath,
} from '@/lib/tools/handlers/doc-edit/shared';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/pascal/custom-tools', () => {
  const actual = jest.requireActual('@/lib/pascal/custom-tools');
  return { ...actual, loadToolsFromMount: jest.fn() };
});

jest.mock('@/lib/doc-edit', () => ({
  resolveDocEditPath: jest.fn(),
  readFileWithMtime: jest.fn(),
}));

jest.mock('@/lib/tools/handlers/doc-edit/shared', () => ({
  assertCharacterMayRead: jest.fn(),
  buildReadResolutionContext: jest.fn(),
  buildWriteResolutionContext: jest.fn(),
  uriForResolvedPath: jest.fn(),
}));

jest.mock('@/lib/tools/handlers/doc-edit/text-handlers', () => ({
  handleWriteFile: jest.fn(),
}));

const CONTEXT = { userId: 'user-1', chatId: 'chat-1', characterId: 'char-1' };
const MOUNT_ID = 'mount-1';

const VALID = {
  name: 'unlock',
  description: 'Try the lock.',
  outcomes: [{ when: true, message: 'It gives.', state: 'success' }],
};

const RESOLVED = {
  absolutePath: '',
  scope: 'document_store',
  mountPointId: MOUNT_ID,
  mountPointName: 'Vault',
  mountType: 'database',
  basePath: '',
  relativePath: 'Tools/unlock.tool.json',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(buildReadResolutionContext).mockResolvedValue({} as never);
  jest.mocked(buildWriteResolutionContext).mockResolvedValue({} as never);
  jest.mocked(resolveDocEditPath).mockResolvedValue(RESOLVED as never);
  jest.mocked(assertCharacterMayRead).mockResolvedValue(undefined);
  jest.mocked(uriForResolvedPath).mockResolvedValue('qtap://Vault/Tools/unlock.tool.json');
  jest.mocked(loadToolsFromMount).mockResolvedValue({ found: [], errors: [], unread: [] });
  jest.mocked(handleWriteFile).mockResolvedValue({
    success: true,
    result: { success: true, path: 'Tools/unlock.tool.json', uri: 'qtap://Vault/Tools/unlock.tool.json', mtime: 1 },
  });
});

describe('toolDefinitionPathFor', () => {
  it.each([
    ['unlock', 'Tools/unlock.tool.json'],
    ['unlock.tool.json', 'Tools/unlock.tool.json'],
    ['unlock.TOOL.JSON', 'Tools/unlock.tool.json'],
    ['Tools/unlock.tool.json', 'Tools/unlock.tool.json'],
    ['  unlock  ', 'Tools/unlock.tool.json'],
  ])('maps %p to %p', (input, expected) => {
    expect(toolDefinitionPathFor(input)).toBe(expected);
  });

  it.each(['Tools/nested/unlock', 'Notes/unlock.tool.json', '../unlock', '.tool.json', 'Tools/', 'a\\b'])(
    'refuses %p, which is not directly inside Tools/',
    (input) => {
      expect(toolDefinitionPathFor(input)).toBeNull();
    }
  );
});

describe('saving', () => {
  it('validates, then writes through doc_write_file\'s handler', async () => {
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock', content: VALID }, CONTEXT);

    expect(out).toMatchObject({ success: true, action: 'saved', path: 'Tools/unlock.tool.json', name: 'unlock' });
    expect(handleWriteFile).toHaveBeenCalledWith(
      {
        scope: 'document_store',
        mount_point: 'Vault',
        path: 'Tools/unlock.tool.json',
        content: JSON.stringify(VALID, null, 2),
      },
      CONTEXT
    );
    expect(formatEditCustomToolResults(out)).toContain('Saved "unlock"');
  });

  it('writes string content verbatim', async () => {
    const text = JSON.stringify(VALID);
    await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock.tool.json', content: text }, CONTEXT);
    expect(jest.mocked(handleWriteFile).mock.calls[0][0].content).toBe(text);
  });

  it('refuses a definition that fails the schema, and writes nothing', async () => {
    const out = await executeEditCustomTool(
      { mount_point: 'Vault', file: 'unlock', content: { name: 'unlock', outcomes: [] } },
      CONTEXT
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/^Not saved\. Tools\/unlock\.tool\.json fails the custom-tool schema:/);
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('refuses text that is not JSON, and writes nothing', async () => {
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock', content: '{ nope' }, CONTEXT);
    expect(out.error).toMatch(/is not valid JSON/);
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('refuses a name another file in the same store already defines', async () => {
    jest.mocked(loadToolsFromMount).mockResolvedValue({
      found: [{
        definition: { ...VALID } as never,
        tier: 'global',
        mountPointId: MOUNT_ID,
        mountName: 'Vault',
        definitionPath: 'Tools/old-lock.tool.json',
      }],
      errors: [],
      unread: [],
    });
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock', content: VALID }, CONTEXT);
    expect(out.success).toBe(false);
    expect(out.error).toContain('Tools/old-lock.tool.json');
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('lets a file keep its own name when it is rewritten', async () => {
    jest.mocked(loadToolsFromMount).mockResolvedValue({
      found: [{
        definition: { ...VALID } as never,
        tier: 'global',
        mountPointId: MOUNT_ID,
        mountName: 'Vault',
        definitionPath: 'Tools/unlock.tool.json',
      }],
      errors: [],
      unread: [],
    });
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock', content: VALID }, CONTEXT);
    expect(out.success).toBe(true);
    expect(handleWriteFile).toHaveBeenCalled();
  });

  it('refuses a file outside the top level of Tools/', async () => {
    const out = await executeEditCustomTool(
      { mount_point: 'Vault', file: 'Tools/drafts/unlock', content: VALID },
      CONTEXT
    );
    expect(out.success).toBe(false);
    expect(resolveDocEditPath).not.toHaveBeenCalled();
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('reports a store the caller may not reach as a failure', async () => {
    jest.mocked(resolveDocEditPath).mockRejectedValue(new Error('Mount point not accessible: Elsewhere'));
    const out = await executeEditCustomTool({ mount_point: 'Elsewhere', file: 'unlock', content: VALID }, CONTEXT);
    expect(out).toMatchObject({ success: false, error: 'Mount point not accessible: Elsewhere' });
  });
});

describe('validating without content', () => {
  it('validates the file as it stands and writes nothing', async () => {
    jest.mocked(readFileWithMtime).mockResolvedValue({ content: JSON.stringify(VALID), mtime: 1, size: 1 });
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock' }, CONTEXT);

    expect(out).toMatchObject({ success: true, action: 'validated', name: 'unlock' });
    expect(assertCharacterMayRead).toHaveBeenCalled();
    expect(buildWriteResolutionContext).not.toHaveBeenCalled();
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('treats null content as omitted', async () => {
    jest.mocked(readFileWithMtime).mockResolvedValue({ content: JSON.stringify(VALID), mtime: 1, size: 1 });
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock', content: null }, CONTEXT);
    expect(out.action).toBe('validated');
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('reports what is wrong with an invalid file', async () => {
    jest.mocked(readFileWithMtime).mockResolvedValue({ content: '{"name":"unlock"}', mtime: 1, size: 1 });
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock' }, CONTEXT);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/fails the custom-tool schema/);
  });

  it('says so when there is no such file', async () => {
    jest.mocked(readFileWithMtime).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock' }, CONTEXT);
    expect(out.error).toBe('There is no Tools/unlock.tool.json in "Vault" to validate.');
  });

  it('flags a same-store clash discovery has already set aside', async () => {
    jest.mocked(readFileWithMtime).mockResolvedValue({ content: JSON.stringify(VALID), mtime: 1, size: 1 });
    jest.mocked(loadToolsFromMount).mockResolvedValue({
      found: [],
      errors: [{
        definitionPath: 'Tools/zz-unlock.tool.json',
        mountPointId: MOUNT_ID,
        mountName: 'Vault',
        tier: 'global',
        reason: 'defines "unlock", which Tools/unlock.tool.json in this same store already defines',
        stage: 'duplicate',
        name: 'unlock',
      }],
      unread: [],
    });
    const out = await executeEditCustomTool({ mount_point: 'Vault', file: 'unlock' }, CONTEXT);
    expect(out.success).toBe(false);
    expect(out.error).toContain('Tools/zz-unlock.tool.json');
  });
});

describe('fetching the schema', () => {
  it('returns the published JSON Schema and specimens that pass the runtime validator, touching no store', async () => {
    const out = await executeEditCustomTool({ action: 'schema' }, CONTEXT);

    expect(out).toMatchObject({ success: true, action: 'schema' });
    expect(out.schema).toMatchObject({ $id: 'https://quilltap.ai/schemas/qtap-custom-tool.schema.json' });
    expect(out.examples).toHaveLength(2);
    for (const example of out.examples!) {
      expect(validateToolDefinitionText(JSON.stringify(example)).ok).toBe(true);
    }
    expect(resolveDocEditPath).not.toHaveBeenCalled();
    expect(readFileWithMtime).not.toHaveBeenCalled();
    expect(handleWriteFile).not.toHaveBeenCalled();
    expect(formatEditCustomToolResults(out)).toContain('JSON Schema');
  });

  it('ignores any store fields passed alongside it', async () => {
    const out = await executeEditCustomTool({ action: 'schema', mount_point: 'Vault', file: 'unlock', content: VALID }, CONTEXT);
    expect(out.action).toBe('schema');
    expect(handleWriteFile).not.toHaveBeenCalled();
  });

  it('still requires mount_point and file without it', async () => {
    const out = await executeEditCustomTool({ file: 'unlock' }, CONTEXT);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/required unless `action` is "schema"/);
  });
});
