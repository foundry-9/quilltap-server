/**
 * Unit tests for DocMountPointsRepository.findByName / countByName — the
 * ambiguity helper that producers consult before emitting the readable
 * (name) form of a `qtap://` URI. Names are case-insensitive, trimmed, and
 * scoped to ENABLED mounts only.
 *
 * Strategy: stub `findEnabled` (the only collaborator) — no real database.
 *
 * @jest-environment node
 */

import { describe, it, expect } from '@jest/globals';
import { DocMountPointsRepository, MountPointNameTakenError } from '../doc-mount-points.repository';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

jest.mock('@/lib/logger', () => {
  const l = {
    child: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  l.child.mockReturnValue(l);
  return { logger: l };
});

function mount(name: string, id: string): DocMountPoint {
  return { id, name, enabled: true } as DocMountPoint;
}

function repoWithEnabled(mounts: DocMountPoint[]): DocMountPointsRepository {
  const repo = new DocMountPointsRepository();
  jest.spyOn(repo, 'findEnabled').mockResolvedValue(mounts);
  return repo;
}

describe('DocMountPointsRepository.findByName', () => {
  it('matches case-insensitively and trims', async () => {
    const repo = repoWithEnabled([mount('My Store', 'a'), mount('Other', 'b')]);
    const matches = await repo.findByName('  my store  ');
    expect(matches.map(m => m.id)).toEqual(['a']);
  });

  it('returns every match when the name is duplicated', async () => {
    const repo = repoWithEnabled([
      mount('Notes', 'a'),
      mount('notes', 'b'),
      mount('Elsewhere', 'c'),
    ]);
    const matches = await repo.findByName('Notes');
    expect(matches.map(m => m.id).sort()).toEqual(['a', 'b']);
  });

  it('returns [] when nothing matches', async () => {
    const repo = repoWithEnabled([mount('A', 'a')]);
    expect(await repo.findByName('Z')).toEqual([]);
  });
});

describe('DocMountPointsRepository.countByName', () => {
  it('counts matches (1 ⇒ unambiguous, >1 ⇒ ambiguous)', async () => {
    const repo = repoWithEnabled([mount('Dup', 'a'), mount('DUP', 'b'), mount('Solo', 'c')]);
    expect(await repo.countByName('Solo')).toBe(1);
    expect(await repo.countByName('dup')).toBe(2);
    expect(await repo.countByName('missing')).toBe(0);
  });
});

describe('DocMountPointsRepository name chokepoint (bug 186)', () => {
  function repoWithAll(mounts: DocMountPoint[]) {
    const repo = new DocMountPointsRepository();
    jest.spyOn(repo, 'findAll').mockResolvedValue(mounts);
    const createSpy = jest
      .spyOn(repo as unknown as { _create: (d: unknown) => Promise<unknown> }, '_create')
      .mockImplementation(async (d) => d);
    const updateSpy = jest
      .spyOn(repo as unknown as { _update: (id: string, d: unknown) => Promise<unknown> }, '_update')
      .mockImplementation(async (_id, d) => d);
    return { repo, createSpy, updateSpy };
  }

  it('refuses to create a store under a name another holds, ignoring case', async () => {
    const { repo, createSpy } = repoWithAll([mount('Tester Character Vault', 'a')]);
    await expect(repo.create({ name: ' tester character vault' } as DocMountPoint)).rejects.toThrow(
      MountPointNameTakenError
    );
    expect(createSpy).not.toHaveBeenCalled();
    await repo.create({ name: 'Tester Character Vault (2)' } as DocMountPoint);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a rename onto a peer, but not a store keeping or re-casing its own name', async () => {
    const { repo, updateSpy } = repoWithAll([mount('Notes', 'a'), mount('Lore', 'b')]);
    await expect(repo.update('b', { name: 'NOTES' })).rejects.toThrow(MountPointNameTakenError);
    await repo.update('a', { name: 'NOTES' });
    await repo.update('b', { enabled: false });
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });
});
