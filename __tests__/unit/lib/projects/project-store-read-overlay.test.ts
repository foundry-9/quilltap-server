/**
 * Unit tests for the project-store read overlay's hydration and its asymmetric
 * failure behavior:
 *   - applyProjectStoreOverlayOne THROWS when the store is unavailable.
 *   - applyProjectStoreOverlay DROPS the bad row and returns the rest.
 *
 * The doc-store repository (via getRepositories) is mocked, so no real database
 * is needed.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { getRepositories } from '@/lib/repositories/factory';
import {
  applyProjectStoreOverlay,
  applyProjectStoreOverlayOne,
} from '@/lib/projects/project-store/read-overlay';
import { ProjectStoreUnavailableError } from '@/lib/projects/project-store/schema';
import type { Project } from '@/lib/schemas/project.types';

jest.mock('@/lib/repositories/factory');

const mockGetRepositories = jest.mocked(getRepositories);
const mockFindMany =
  jest.fn<(ids: string[], path: string) => Promise<Array<{ mountPointId: string; content: string }>>>();

/** Wire the mock from a { [mountId]: { [path]: content } } fixture. */
function mockStore(perMount: Record<string, Record<string, string>>): void {
  mockFindMany.mockImplementation(async (ids: string[], path: string) => {
    const out: Array<{ mountPointId: string; content: string }> = [];
    for (const id of ids) {
      const files = perMount[id];
      if (files && path in files) out.push({ mountPointId: id, content: files[path] });
    }
    return out;
  });
  mockGetRepositories.mockReturnValue({
    docMountDocuments: { findManyByMountPointsAndPath: mockFindMany },
  } as unknown as ReturnType<typeof getRepositories>);
}

function row(id: string, mountPointId: string | null): Project {
  return {
    id,
    name: `Project ${id}`,
    officialMountPointId: mountPointId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Project;
}

const CHAR_UUID = '11111111-1111-4111-8111-111111111111';
const FULL_FILES = {
  'properties.json': JSON.stringify({ allowAnyCharacter: true, characterRoster: [CHAR_UUID] }),
  'description.md': 'A grand description',
  'instructions.md': '',
  'state.json': JSON.stringify({ turn: 3 }),
};

describe('applyProjectStoreOverlayOne', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hydrates the row from its store files', async () => {
    mockStore({ m1: FULL_FILES });
    const out = await applyProjectStoreOverlayOne(row('p1', 'm1'));
    expect(out).not.toBeNull();
    expect(out!.allowAnyCharacter).toBe(true);
    expect(out!.characterRoster).toEqual([CHAR_UUID]);
    expect(out!.description).toBe('A grand description');
    expect(out!.instructions).toBeNull(); // empty markdown → null
    expect(out!.state).toEqual({ turn: 3 });
  });

  it('returns null for a null row', async () => {
    mockStore({});
    expect(await applyProjectStoreOverlayOne(null)).toBeNull();
  });

  it('throws ProjectStoreUnavailableError when officialMountPointId is null', async () => {
    mockStore({});
    await expect(applyProjectStoreOverlayOne(row('p1', null))).rejects.toBeInstanceOf(
      ProjectStoreUnavailableError,
    );
  });

  it('throws ProjectStoreUnavailableError when properties.json is missing', async () => {
    mockStore({ m1: { 'description.md': 'x' } }); // no properties.json
    await expect(applyProjectStoreOverlayOne(row('p1', 'm1'))).rejects.toBeInstanceOf(
      ProjectStoreUnavailableError,
    );
  });

  it('throws ProjectStoreUnavailableError when properties.json is unparseable', async () => {
    mockStore({ m1: { 'properties.json': '{not json' } });
    await expect(applyProjectStoreOverlayOne(row('p1', 'm1'))).rejects.toBeInstanceOf(
      ProjectStoreUnavailableError,
    );
  });
});

describe('applyProjectStoreOverlay (batched)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an empty array unchanged', async () => {
    mockStore({});
    expect(await applyProjectStoreOverlay([])).toEqual([]);
  });

  it('drops a row whose store is unavailable and keeps the rest', async () => {
    mockStore({ m1: FULL_FILES }); // m2 has no files at all
    const out = await applyProjectStoreOverlay([row('p1', 'm1'), row('p2', 'm2')]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('p1');
  });

  it('drops a row with a null mount and keeps the rest', async () => {
    mockStore({ m1: FULL_FILES });
    const out = await applyProjectStoreOverlay([row('p1', 'm1'), row('p2', null)]);
    expect(out.map((p) => p.id)).toEqual(['p1']);
  });
});
