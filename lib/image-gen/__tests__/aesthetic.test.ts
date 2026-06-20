/**
 * Unit tests for the default-aesthetics resolver + the Ariel Clause.
 *
 * jest.setup.ts already globally mocks `@/lib/repositories/factory`
 * (getRepositories). We additionally mock the instance-settings General-store
 * lookup and the database-store write/delete primitives, then configure a fake
 * repo proxy per test via jest.mocked.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import {
  resolveAesthetic,
  resolveDepictionGuidelines,
  readAestheticForMount,
  writeAestheticForMount,
  getProjectOfficialMountPointId,
  LANTERN_AESTHETICS_FILENAME,
  AURORA_AESTHETICS_FILENAME,
  DEPICTION_GUIDELINES_FILENAME,
} from '../aesthetic';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { writeDatabaseDocument, deleteDatabaseDocument } from '@/lib/mount-index/database-store';

// ── Fixtures / helpers ────────────────────────────────────────────────────────

/** docs: mountId -> { lowercaseFilename: content } */
type DocMap = Record<string, Record<string, string>>;
/** projects: projectId -> officialMountPointId | null */
type ProjectMap = Record<string, string | null>;

function makeRepos(docs: DocMap, projects: ProjectMap = {}) {
  return {
    docMountDocuments: {
      findByMountPointAndPath: jest.fn(async (mountId: string, relPath: string) => {
        const content = docs[mountId]?.[relPath.toLowerCase()];
        return content === undefined ? null : { content };
      }),
    },
    projects: {
      findByIdRaw: jest.fn(async (id: string) =>
        id in projects ? { officialMountPointId: projects[id] } : null,
      ),
    },
  };
}

function setRepos(repos: ReturnType<typeof makeRepos>) {
  jest.mocked(getRepositories).mockReturnValue(repos as never);
}

const PROJECT_MOUNT = 'mount-project';
const GENERAL_MOUNT = 'mount-general';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getGeneralMountPointId).mockResolvedValue(GENERAL_MOUNT);
});

// ── resolveAesthetic ──────────────────────────────────────────────────────────

describe('resolveAesthetic', () => {
  it('project official store overrides Quilltap General', async () => {
    setRepos(
      makeRepos({
        [PROJECT_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: 'PROJECT scene' },
        [GENERAL_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: 'GLOBAL scene' },
      }),
    );
    const result = await resolveAesthetic({
      kind: 'lantern',
      projectOfficialMountPointId: PROJECT_MOUNT,
    });
    expect(result).toBe('PROJECT scene');
  });

  it('falls back to Quilltap General when the project file is absent', async () => {
    setRepos(
      makeRepos({
        [GENERAL_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: 'GLOBAL scene' },
      }),
    );
    const result = await resolveAesthetic({
      kind: 'lantern',
      projectOfficialMountPointId: PROJECT_MOUNT,
    });
    expect(result).toBe('GLOBAL scene');
  });

  it('returns null when neither tier has the file', async () => {
    setRepos(makeRepos({}));
    const result = await resolveAesthetic({
      kind: 'lantern',
      projectOfficialMountPointId: PROJECT_MOUNT,
    });
    expect(result).toBeNull();
  });

  it('resolves the two files independently', async () => {
    setRepos(
      makeRepos({
        // Project overrides aurora only; lantern inherits global.
        [PROJECT_MOUNT]: { [AURORA_AESTHETICS_FILENAME]: 'PROJECT people' },
        [GENERAL_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: 'GLOBAL scene' },
      }),
    );
    const [lantern, aurora] = await Promise.all([
      resolveAesthetic({ kind: 'lantern', projectOfficialMountPointId: PROJECT_MOUNT }),
      resolveAesthetic({ kind: 'aurora', projectOfficialMountPointId: PROJECT_MOUNT }),
    ]);
    expect(lantern).toBe('GLOBAL scene');
    expect(aurora).toBe('PROJECT people');
  });

  it('treats a whitespace-only file as absent and falls through', async () => {
    setRepos(
      makeRepos({
        [PROJECT_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: '   \n\t  ' },
        [GENERAL_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: 'GLOBAL scene' },
      }),
    );
    const result = await resolveAesthetic({
      kind: 'lantern',
      projectOfficialMountPointId: PROJECT_MOUNT,
    });
    expect(result).toBe('GLOBAL scene');
  });

  it('global-only resolution when no project mount id is given', async () => {
    setRepos(makeRepos({ [GENERAL_MOUNT]: { [AURORA_AESTHETICS_FILENAME]: 'GLOBAL people' } }));
    const result = await resolveAesthetic({ kind: 'aurora' });
    expect(result).toBe('GLOBAL people');
  });

  it('fails soft to null when the read throws', async () => {
    const repos = makeRepos({});
    repos.docMountDocuments.findByMountPointAndPath.mockRejectedValue(new Error('boom'));
    setRepos(repos);
    const result = await resolveAesthetic({
      kind: 'lantern',
      projectOfficialMountPointId: PROJECT_MOUNT,
    });
    expect(result).toBeNull();
  });

  it('caps the content at maxChars', async () => {
    const long = 'x'.repeat(50);
    setRepos(makeRepos({ [GENERAL_MOUNT]: { [LANTERN_AESTHETICS_FILENAME]: long } }));
    const result = await resolveAesthetic({ kind: 'lantern', maxChars: 10 });
    expect(result).toBe('x'.repeat(10));
  });
});

// ── readAestheticForMount / writeAestheticForMount ────────────────────────────

describe('readAestheticForMount', () => {
  it('returns the raw file content for the requested kind', async () => {
    setRepos(makeRepos({ [PROJECT_MOUNT]: { [AURORA_AESTHETICS_FILENAME]: '  raw with space  ' } }));
    const result = await readAestheticForMount(PROJECT_MOUNT, 'aurora');
    // Editor view is untrimmed.
    expect(result).toBe('  raw with space  ');
  });

  it('returns empty string when the file is absent', async () => {
    setRepos(makeRepos({}));
    const result = await readAestheticForMount(PROJECT_MOUNT, 'lantern');
    expect(result).toBe('');
  });
});

describe('writeAestheticForMount', () => {
  it('writes the file for non-empty content', async () => {
    setRepos(makeRepos({}));
    await writeAestheticForMount(PROJECT_MOUNT, 'lantern', 'new look');
    expect(writeDatabaseDocument).toHaveBeenCalledWith(
      PROJECT_MOUNT,
      LANTERN_AESTHETICS_FILENAME,
      'new look',
    );
    expect(deleteDatabaseDocument).not.toHaveBeenCalled();
  });

  it('deletes the file when content is empty/whitespace', async () => {
    setRepos(makeRepos({}));
    await writeAestheticForMount(PROJECT_MOUNT, 'aurora', '   ');
    expect(deleteDatabaseDocument).toHaveBeenCalledWith(PROJECT_MOUNT, AURORA_AESTHETICS_FILENAME);
    expect(writeDatabaseDocument).not.toHaveBeenCalled();
  });
});

// ── resolveDepictionGuidelines (the Ariel Clause) ─────────────────────────────

describe('resolveDepictionGuidelines', () => {
  it('returns a guideline for a single character with a vault file', async () => {
    setRepos(
      makeRepos({ 'vault-1': { [DEPICTION_GUIDELINES_FILENAME]: 'never show her face' } }),
    );
    const result = await resolveDepictionGuidelines([
      { id: 'c1', name: 'Ariel', characterDocumentMountPointId: 'vault-1' },
    ]);
    expect(result).toEqual([
      { characterId: 'c1', characterName: 'Ariel', content: 'never show her face' },
    ]);
  });

  it('attributes guidelines per character for multiple characters', async () => {
    setRepos(
      makeRepos({
        'vault-1': { [DEPICTION_GUIDELINES_FILENAME]: 'rule A' },
        'vault-2': { [DEPICTION_GUIDELINES_FILENAME]: 'rule B' },
      }),
    );
    const result = await resolveDepictionGuidelines([
      { id: 'c1', name: 'Ariel', characterDocumentMountPointId: 'vault-1' },
      { id: 'c2', name: 'Triton', characterDocumentMountPointId: 'vault-2' },
    ]);
    expect(result).toEqual([
      { characterId: 'c1', characterName: 'Ariel', content: 'rule A' },
      { characterId: 'c2', characterName: 'Triton', content: 'rule B' },
    ]);
  });

  it('skips characters without a vault and without the file', async () => {
    setRepos(makeRepos({ 'vault-2': { [DEPICTION_GUIDELINES_FILENAME]: 'rule B' } }));
    const result = await resolveDepictionGuidelines([
      { id: 'c0', name: 'NoVault', characterDocumentMountPointId: null },
      { id: 'c1', name: 'EmptyVault', characterDocumentMountPointId: 'vault-1' }, // no file
      { id: 'c2', name: 'Triton', characterDocumentMountPointId: 'vault-2' },
    ]);
    expect(result).toEqual([
      { characterId: 'c2', characterName: 'Triton', content: 'rule B' },
    ]);
  });

  it('fails soft (skips) when a vault read throws', async () => {
    const repos = makeRepos({ 'vault-2': { [DEPICTION_GUIDELINES_FILENAME]: 'rule B' } });
    repos.docMountDocuments.findByMountPointAndPath.mockImplementation(async (mountId: string) => {
      if (mountId === 'vault-1') throw new Error('broken vault');
      if (mountId === 'vault-2') return { content: 'rule B' };
      return null;
    });
    setRepos(repos);
    const result = await resolveDepictionGuidelines([
      { id: 'c1', name: 'Broken', characterDocumentMountPointId: 'vault-1' },
      { id: 'c2', name: 'Triton', characterDocumentMountPointId: 'vault-2' },
    ]);
    expect(result).toEqual([
      { characterId: 'c2', characterName: 'Triton', content: 'rule B' },
    ]);
  });

  it('caps each guideline at maxCharsEach', async () => {
    setRepos(makeRepos({ 'vault-1': { [DEPICTION_GUIDELINES_FILENAME]: 'y'.repeat(40) } }));
    const result = await resolveDepictionGuidelines(
      [{ id: 'c1', name: 'Ariel', characterDocumentMountPointId: 'vault-1' }],
      10,
    );
    expect(result[0].content).toBe('y'.repeat(10));
  });
});

// ── getProjectOfficialMountPointId ────────────────────────────────────────────

describe('getProjectOfficialMountPointId', () => {
  it('returns the official mount id for a project', async () => {
    setRepos(makeRepos({}, { 'proj-1': 'mount-official' }));
    expect(await getProjectOfficialMountPointId('proj-1')).toBe('mount-official');
  });

  it('returns null for a missing/empty projectId', async () => {
    setRepos(makeRepos({}, {}));
    expect(await getProjectOfficialMountPointId(null)).toBeNull();
    expect(await getProjectOfficialMountPointId(undefined)).toBeNull();
  });

  it('fails soft to null when the lookup throws', async () => {
    const repos = makeRepos({}, {});
    repos.projects.findByIdRaw.mockRejectedValue(new Error('overlay blew up'));
    setRepos(repos);
    expect(await getProjectOfficialMountPointId('proj-1')).toBeNull();
  });
});
