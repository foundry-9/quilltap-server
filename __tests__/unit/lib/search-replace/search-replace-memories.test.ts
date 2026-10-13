/**
 * Search and replace over memories (bug 233): each replaced row is written
 * through updateMemory with the old row as its baseline, so the new text is
 * re-embedded in the same write. A row whose new text cannot be embedded is
 * left unchanged and reported.
 */

import { executeSearchReplace, planMemoryReplacement } from '@/lib/search-replace/search-replace-service';
import { updateMemory } from '@/lib/memory/admission';
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/memory/admission', () => ({ updateMemory: jest.fn() }));

const mockEdit = updateMemory as jest.Mock;
const mockRepos = getRepositories as jest.Mock;

const laura = {
  id: 'mem-1',
  characterId: 'char-1',
  content: 'Laura keeps the key under the mat.',
  summary: 'Laura hides the key',
  keywords: ['Laura', 'key'],
};
const other = {
  id: 'mem-2',
  characterId: 'char-1',
  content: 'The tide came in at Laura Bay.',
  summary: 'Tide',
  keywords: [],
};

const request = {
  scope: { type: 'character', characterId: 'char-1' },
  searchText: 'Laura',
  replaceText: 'Lauren',
  includeMessages: false,
  includeMemories: true,
} as never;

describe('planMemoryReplacement', () => {
  it('rewrites only the fields that contain the search text', () => {
    expect(planMemoryReplacement(laura, 'Laura', 'Lauren')).toEqual({
      content: 'Lauren keeps the key under the mat.',
      summary: 'Lauren hides the key',
      keywords: ['Lauren', 'key'],
    });
    expect(planMemoryReplacement(other, 'Laura', 'Lauren')).toEqual({
      content: 'The tide came in at Lauren Bay.',
    });
  });

  it('returns null when nothing matches or the search text is empty', () => {
    expect(planMemoryReplacement(laura, 'Ophelia', 'X')).toBeNull();
    expect(planMemoryReplacement(laura, '', 'X')).toBeNull();
  });
});

describe('executeSearchReplace — memories (bug 233)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepos.mockReturnValue({
      memories: { findMemoriesWithText: jest.fn(async () => [laura, other]) },
    });
  });

  it('writes each row through updateMemory with the replaced fields', async () => {
    mockEdit.mockResolvedValue({ ok: true, memory: {} });

    const result = await executeSearchReplace(request, 'u1');

    expect(mockEdit).toHaveBeenCalledTimes(2);
    expect(mockEdit).toHaveBeenCalledWith(
      'char-1',
      'mem-1',
      expect.objectContaining({
        content: 'Lauren keeps the key under the mat.',
        summary: 'Lauren hides the key',
      }),
      { userId: 'u1' }
    );
    expect(result.memoriesUpdated).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it('reports a row whose new text could not be embedded and does not count it', async () => {
    mockEdit
      .mockResolvedValueOnce({ ok: false, reason: 'embedding-failed', message: 'provider down' })
      .mockResolvedValueOnce({ ok: true, memory: {} });

    const result = await executeSearchReplace(request, 'u1');

    expect(result.memoriesUpdated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('mem-1');
  });
});
