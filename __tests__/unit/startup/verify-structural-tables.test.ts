/**
 * @jest-environment node
 *
 * The boot-time structural table check (bug 176). Once a structural
 * migration is ledgered the runner never asks it again, so this pass is the
 * one boot step that looks at the mount-index and help-chunks tables. The
 * shape check must catch what `CREATE TABLE IF NOT EXISTS` cannot — a column
 * renamed in place, a table swapped for a view — and the pass must record
 * what it finds for `/api/health` without stopping the boot.
 *
 * Guards:
 *   - lib/database/table-shape.ts (`findTableShapeProblem`)
 *   - lib/database/repositories/dedicated-db.repository.ts (`verifyStructure`)
 *   - lib/startup/verify-structural-tables.ts
 */

import path from 'path';
import { z } from 'zod';

jest.mock('@/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...log, child: () => log } };
});

jest.mock('@/lib/database/manager', () => ({
  getDatabaseAsync: jest.fn(async () => ({})),
}));

jest.mock('@/lib/startup/startup-state', () => {
  let problems: string[] = [];
  return {
    startupState: {
      setStructuralProblems: (p: string[]) => { problems = [...p]; },
      getStructuralProblems: () => [...problems],
    },
  };
});

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

import { findTableShapeProblem, type ShapeQuery } from '@/lib/database/table-shape';
import { AbstractDedicatedDbRepository } from '@/lib/database/repositories/dedicated-db.repository';
import { verifyStructuralTables } from '@/lib/startup/verify-structural-tables';
import { startupState } from '@/lib/startup/startup-state';
import { getRepositories } from '@/lib/repositories/factory';

// The jest moduleNameMapper replaces the bare better-sqlite3 name with a
// no-op mock; require the real binding by absolute path.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const LinkSchema = z.object({
  id: z.string(),
  relativePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type Link = z.infer<typeof LinkSchema>;

class LinksRepository extends AbstractDedicatedDbRepository<Link> {
  constructor(acquireDb: () => unknown) {
    super('links', LinkSchema, {
      dbTarget: 'mountIndex',
      acquireDb: acquireDb as () => never,
    });
  }
  async findById(): Promise<Link | null> { return null; }
  async findAll(): Promise<Link[]> { return []; }
  async create(): Promise<Link> { throw new Error('unused'); }
  async update(): Promise<Link | null> { return null; }
  async delete(): Promise<boolean> { return false; }
}

function queryOf(db: { prepare(sql: string): { all(...p: unknown[]): unknown[] } }): ShapeQuery {
  return <R>(sql: string, params: unknown[]) => db.prepare(sql).all(...params) as R[];
}

describe('findTableShapeProblem', () => {
  let db: any;
  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => db.close());

  it('accepts a table with every schema column (extras allowed)', async () => {
    db.exec('CREATE TABLE links (id TEXT, relativePath TEXT, createdAt TEXT, updatedAt TEXT, extra TEXT)');
    expect(await findTableShapeProblem(queryOf(db), 'links', LinkSchema)).toBeNull();
  });

  it('names a column renamed in place', async () => {
    db.exec('CREATE TABLE links (id TEXT, relativePath TEXT, createdAt TEXT, updatedAt TEXT)');
    db.exec('ALTER TABLE links RENAME COLUMN relativePath TO relativePath_x');
    expect(await findTableShapeProblem(queryOf(db), 'links', LinkSchema)).toBe(
      'table links is missing column relativePath'
    );
  });

  it('refuses a view standing in for the table', async () => {
    db.exec('CREATE TABLE links_x (id TEXT, relativePath TEXT, createdAt TEXT, updatedAt TEXT)');
    db.exec('CREATE VIEW links AS SELECT * FROM links_x');
    expect(await findTableShapeProblem(queryOf(db), 'links', LinkSchema)).toBe('links is a view, not a table');
  });

  it('reports a missing table', async () => {
    expect(await findTableShapeProblem(queryOf(db), 'links', LinkSchema)).toBe('table links does not exist');
  });
});

describe('AbstractDedicatedDbRepository.verifyStructure', () => {
  it('creates a missing table and passes', async () => {
    const db = new Database(':memory:');
    expect(await new LinksRepository(() => db).verifyStructure()).toBeNull();
    db.close();
  });

  it('reports the renamed column the IF NOT EXISTS DDL walks past', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE links (id TEXT, relativePath_x TEXT, createdAt TEXT, updatedAt TEXT)');
    expect(await new LinksRepository(() => db).verifyStructure()).toBe(
      'table links is missing column relativePath'
    );
    db.close();
  });

  it('reports an unavailable database instead of throwing', async () => {
    const repo = new LinksRepository(() => {
      throw new Error('Mount index database is in degraded mode');
    });
    expect(await repo.verifyStructure()).toBe(
      'mount index database unavailable: Mount index database is in degraded mode'
    );
  });
});

describe('verifyStructuralTables', () => {
  afterEach(() => startupState.setStructuralProblems([]));

  it('records each damaged table once and skips repositories without the check', async () => {
    const damaged = { verifyStructure: jest.fn(async () => 'table links is missing column relativePath') };
    const sound = { verifyStructure: jest.fn(async () => null) };
    (getRepositories as jest.Mock).mockReturnValue({
      links: damaged,
      alias: damaged,
      chunks: sound,
      plain: { findAll: jest.fn() },
    });

    const problems = await verifyStructuralTables();

    expect(problems).toEqual(['table links is missing column relativePath']);
    expect(damaged.verifyStructure).toHaveBeenCalledTimes(1);
    expect(startupState.getStructuralProblems()).toEqual(problems);
  });

  it('clears the record when everything is sound', async () => {
    startupState.setStructuralProblems(['stale']);
    (getRepositories as jest.Mock).mockReturnValue({ chunks: { verifyStructure: async () => null } });

    expect(await verifyStructuralTables()).toEqual([]);
    expect(startupState.getStructuralProblems()).toEqual([]);
  });
});
