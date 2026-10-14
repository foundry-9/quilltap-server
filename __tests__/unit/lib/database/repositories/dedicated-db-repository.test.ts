/**
 * @jest-environment node
 *
 * `AbstractDedicatedDbRepository` — the one `getCollection()` / raw-SQL
 * preamble every mount-index and LLM-logs repository used to carry a private
 * copy of.
 *
 * Runs a minimal concrete subclass against a real in-memory SQLite DB so the
 * generated DDL, the `onTableEnsured` / `afterTableReady` hooks, the cached
 * column classification and the `withRawDb` guard are all exercised for
 * real. `acquireDb` is the injection point: a throwing one stands in for a
 * degraded or uninitialized database, exactly as `requireMountIndexDb` /
 * `requireLLMLogsDb` behave.
 */

import path from 'path';
import { z } from 'zod';
import type { Database as DatabaseType } from 'better-sqlite3';

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

// Wrap the column classifier so the once-per-instance cache can be asserted;
// the real implementation still runs underneath.
jest.mock('@/lib/database/schema-translator', () => {
  const actual = jest.requireActual('@/lib/database/schema-translator');
  return { ...actual, classifySchemaColumns: jest.fn(actual.classifySchemaColumns) };
});

import { logger } from '@/lib/logger';
import { classifySchemaColumns } from '@/lib/database/schema-translator';
import { AbstractDedicatedDbRepository } from '@/lib/database/repositories/dedicated-db.repository';
import type { CreateOptions } from '@/lib/database/repositories/base.repository';

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// and the jest moduleNameMapper replaces both bare names with a no-op mock.
// Require the real binding by absolute path (which the mapper's `^name$`
// patterns don't match) so this suite exercises actual SQL.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const WidgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type Widget = z.infer<typeof WidgetSchema>;

class WidgetsRepository extends AbstractDedicatedDbRepository<Widget> {
  ensuredWith: DatabaseType[] = [];
  readyWith: DatabaseType[] = [];
  /** Set to make `afterTableReady` call back into this repository. */
  reenterOnReady = false;
  reentrantRows: Widget[] | null = null;

  constructor(acquireDb: () => DatabaseType) {
    super('widgets', WidgetSchema, { dbTarget: 'mountIndex', acquireDb });
  }

  protected override onTableEnsured(db: DatabaseType): void {
    this.ensuredWith.push(db);
    db.exec('CREATE INDEX IF NOT EXISTS "idx_widgets_name" ON "widgets" ("name")');
  }

  protected override async afterTableReady(db: DatabaseType): Promise<void> {
    this.readyWith.push(db);
    if (this.reenterOnReady) {
      // The folder backfill does exactly this: re-enters the repository while
      // the init block is still on the stack. It must see a ready table.
      this.reentrantRows = await this.findAll();
    }
  }

  async create(data: Omit<Widget, 'id' | 'createdAt' | 'updatedAt'>, options?: CreateOptions): Promise<Widget> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<Widget>): Promise<Widget | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // Public shims over the protected helpers under test.
  countRaw(fallback: number, mode?: 'fallback' | 'rethrow'): Promise<number> {
    return this.withRawDb(
      fallback,
      (db) => (db.prepare('SELECT COUNT(*) AS n FROM widgets').get() as { n: number }).n,
      'Error counting widgets',
      {},
      mode,
    );
  }

  failRaw(fallback: string, mode?: 'fallback' | 'rethrow'): Promise<string> {
    return this.withRawDb(
      fallback,
      () => {
        throw new Error('query exploded');
      },
      'Error exploding',
      { why: 'test' },
      mode,
    );
  }

  rawDb(): Promise<DatabaseType> {
    return this.ensureRawDb();
  }

  collection() {
    return this.getCollection();
  }
}

let db: DatabaseType;

function tableExists(name: string): boolean {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name) !== undefined;
}

function indexExists(name: string): boolean {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`).get(name) !== undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  db = new Database(':memory:');
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
});

describe('AbstractDedicatedDbRepository', () => {
  describe('dbTarget', () => {
    it('declares the dedicated database it was constructed for', () => {
      const repo = new WidgetsRepository(() => db);
      expect(repo.dbTarget).toBe('mountIndex');
    });
  });

  describe('getCollection', () => {
    it('runs the generated DDL and the onTableEnsured hook once, then serves a live collection', async () => {
      const classify = jest.mocked(classifySchemaColumns);
      const repo = new WidgetsRepository(() => db);

      expect(tableExists('widgets')).toBe(false);

      const created = await repo.create({ name: 'gear', enabled: true, tags: ['brass'] });
      expect(tableExists('widgets')).toBe(true);
      expect(indexExists('idx_widgets_name')).toBe(true);
      expect(repo.ensuredWith).toEqual([db]);
      expect(repo.readyWith).toEqual([db]);

      const found = await repo.findById(created.id);
      expect(found).toEqual(created);
      expect(found?.enabled).toBe(true);
      expect(found?.tags).toEqual(['brass']);

      // A second access neither re-runs the DDL nor re-classifies the schema.
      await repo.findAll();
      expect(repo.ensuredWith).toHaveLength(1);
      expect(repo.readyWith).toHaveLength(1);
      expect(classify).toHaveBeenCalledTimes(1);
    });

    it('marks the table ensured before afterTableReady runs, so a re-entrant call does not recurse', async () => {
      const repo = new WidgetsRepository(() => db);
      repo.reenterOnReady = true;

      await repo.collection();

      expect(repo.reentrantRows).toEqual([]);
      expect(repo.ensuredWith).toHaveLength(1);
      expect(repo.readyWith).toHaveLength(1);
    });

    it('throws through acquireDb while the database is unavailable', async () => {
      const repo = new WidgetsRepository(() => {
        throw new Error('Mount index database is in degraded mode');
      });

      await expect(repo.collection()).rejects.toThrow('Mount index database is in degraded mode');
      expect(repo.ensuredWith).toHaveLength(0);
    });

    it('logs, rethrows and leaves the table un-ensured when the hook fails, then retries next time', async () => {
      let hookCalls = 0;
      class FlakyRepository extends WidgetsRepository {
        protected override onTableEnsured(hookDb: DatabaseType): void {
          hookCalls += 1;
          if (hookCalls === 1) throw new Error('index refused');
          super.onTableEnsured(hookDb);
        }
      }
      const repo = new FlakyRepository(() => db);

      await expect(repo.collection()).rejects.toThrow('index refused');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to ensure widgets table in mount index database',
        { error: 'index refused' },
      );
      expect(repo.readyWith).toHaveLength(0);

      await repo.collection();
      expect(hookCalls).toBe(2);
      expect(repo.readyWith).toHaveLength(1);
    });
  });

  describe('ensureRawDb', () => {
    it('hands back the connection with the table ensured', async () => {
      const repo = new WidgetsRepository(() => db);
      const raw = await repo.rawDb();
      expect(raw).toBe(db);
      expect(tableExists('widgets')).toBe(true);
    });

    it('throws when the database is unavailable', async () => {
      const repo = new WidgetsRepository(() => {
        throw new Error('Mount index database not initialized');
      });
      await expect(repo.rawDb()).rejects.toThrow('Mount index database not initialized');
    });
  });

  describe('withRawDb', () => {
    it('answers with the fallback, quietly, while the database is degraded', async () => {
      const repo = new WidgetsRepository(() => {
        throw new Error('Mount index database is in degraded mode');
      });

      await expect(repo.countRaw(-1)).resolves.toBe(-1);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'Dedicated database unavailable; answering with the fallback',
        expect.objectContaining({
          collection: 'widgets',
          dbTarget: 'mountIndex',
          error: 'Mount index database is in degraded mode',
        }),
      );
    });

    it('answers with the fallback, quietly, while the database is uninitialized', async () => {
      const repo = new WidgetsRepository(() => {
        throw new Error('Mount index database not initialized');
      });

      await expect(repo.countRaw(-1)).resolves.toBe(-1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('answers with the fallback even in rethrow mode while the database is unavailable', async () => {
      const repo = new WidgetsRepository(() => {
        throw new Error('Mount index database not initialized');
      });

      await expect(repo.countRaw(-1, 'rethrow')).resolves.toBe(-1);
    });

    it('ensures the table and runs the query on the happy path', async () => {
      const repo = new WidgetsRepository(() => db);

      expect(tableExists('widgets')).toBe(false);
      await expect(repo.countRaw(-1)).resolves.toBe(0);
      expect(tableExists('widgets')).toBe(true);
      expect(repo.ensuredWith).toEqual([db]);

      await repo.create({ name: 'valve', enabled: false, tags: [] });
      await expect(repo.countRaw(-1)).resolves.toBe(1);
      expect(repo.ensuredWith).toHaveLength(1);
    });

    it('logs and answers with the fallback when the query throws (fallback mode)', async () => {
      const repo = new WidgetsRepository(() => db);

      await expect(repo.failRaw('fell back')).resolves.toBe('fell back');
      expect(logger.error).toHaveBeenCalledWith(
        'Error exploding',
        expect.objectContaining({ collection: 'widgets', why: 'test', error: 'query exploded' }),
      );
    });

    it('logs and rethrows when the query throws (rethrow mode)', async () => {
      const repo = new WidgetsRepository(() => db);

      await expect(repo.failRaw('fell back', 'rethrow')).rejects.toThrow('query exploded');
      expect(logger.error).toHaveBeenCalledWith(
        'Error exploding',
        expect.objectContaining({ collection: 'widgets', why: 'test', error: 'query exploded' }),
      );
    });
  });
});
