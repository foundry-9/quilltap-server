/**
 * @jest-environment node
 *
 * Bugs 231 and 234: related links and reinforcement footnotes are written as
 * deltas against the row as it stands at write time, never as whole values
 * built from a caller's earlier read. These run the repository's real SQL
 * against an in-memory SQLite database.
 *
 * Guards: lib/database/repositories/memories.repository.ts
 *   (addRelatedMemoryIds, removeRelatedMemoryIds,
 *    removeRelatedMemoryIdsForCharacter, appendReinforcementFootnotes)
 */

import path from 'path';

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}));

import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository';
import { MAX_REINFORCEMENT_FOOTNOTES } from '@/lib/memory/reinforcement-footnotes';

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const CHAR = 'char-1';
const OTHER = 'char-2';
let db: any;

function seed(id: string, characterId: string, related: string[] | string | null, content = 'Base.') {
  db.prepare('INSERT INTO memories (id, characterId, content, relatedMemoryIds, updatedAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, characterId, content, Array.isArray(related) ? JSON.stringify(related) : related, '2026-01-01T00:00:00.000Z');
}

function links(id: string): string[] {
  const row = db.prepare('SELECT relatedMemoryIds FROM memories WHERE id = ?').get(id);
  return JSON.parse(row.relatedMemoryIds ?? '[]');
}

function content(id: string): string {
  return db.prepare('SELECT content FROM memories WHERE id = ?').get(id).content;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT NOT NULL, content TEXT,
    relatedMemoryIds TEXT DEFAULT '[]', updatedAt TEXT)`);
  (getRawDatabase as jest.Mock).mockReturnValue(db);
});

afterEach(() => {
  db.close();
});

describe('addRelatedMemoryIds / removeRelatedMemoryIds (bug 231)', () => {
  it('unions against the live row, so two writers built from one read both land', async () => {
    seed('n', CHAR, ['x']);
    const repo = new MemoriesRepository();

    // Both writers read ['x']; each adds its own id.
    await repo.addRelatedMemoryIds(CHAR, 'n', ['a']);
    await expect(repo.addRelatedMemoryIds(CHAR, 'n', ['b', 'a'])).resolves.toEqual(['x', 'a', 'b']);
    expect(links('n')).toEqual(['x', 'a', 'b']);
  });

  it('never links a row to itself, treats NULL as empty, and refuses another holder\'s row', async () => {
    seed('n', CHAR, null);
    const repo = new MemoriesRepository();
    await expect(repo.addRelatedMemoryIds(CHAR, 'n', ['n', 'a'])).resolves.toEqual(['a']);
    await expect(repo.addRelatedMemoryIds(OTHER, 'n', ['b'])).resolves.toBeNull();
    expect(links('n')).toEqual(['a']);
  });

  it('removes only the named ids', async () => {
    seed('n', CHAR, ['a', 'b', 'c']);
    const repo = new MemoriesRepository();
    await expect(repo.removeRelatedMemoryIds(CHAR, 'n', ['b', 'zz'])).resolves.toEqual(['a', 'c']);
    expect(links('n')).toEqual(['a', 'c']);
  });
});

describe('removeRelatedMemoryIdsForCharacter (bug 234)', () => {
  it('scrubs every row of the holder that names a removed id, and nothing else', async () => {
    seed('n1', CHAR, ['a', 'b', 'k']);
    seed('n2', CHAR, ['b']);
    seed('n3', CHAR, ['k']);
    seed('o1', OTHER, ['a']);
    seed('bad', CHAR, 'not json');
    const repo = new MemoriesRepository();

    // Two deletes, applied one after the other, each naming only its own id.
    await expect(repo.removeRelatedMemoryIdsForCharacter(CHAR, ['a'])).resolves.toBe(1);
    await expect(repo.removeRelatedMemoryIdsForCharacter(CHAR, ['b'])).resolves.toBe(2);

    expect(links('n1')).toEqual(['k']);
    expect(links('n2')).toEqual([]);
    expect(links('n3')).toEqual(['k']);
    expect(links('o1')).toEqual(['a']);
    expect(db.prepare('SELECT relatedMemoryIds FROM memories WHERE id = ?').get('bad').relatedMemoryIds).toBe('not json');
  });

  it('chunks a large removal under the SQLite variable limit', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `gone-${i}`);
    seed('n', CHAR, ['gone-3', 'keep', 'gone-1499']);
    const repo = new MemoriesRepository();
    await repo.removeRelatedMemoryIdsForCharacter(CHAR, ids);
    expect(links('n')).toEqual(['keep']);
  });
});

describe('appendReinforcementFootnotes (bug 231)', () => {
  it('appends against the live content, so two writers both land', async () => {
    seed('m', CHAR, [], 'Friday keeps the ledger.');
    const repo = new MemoriesRepository();

    await repo.appendReinforcementFootnotes(CHAR, 'm', ['Marguerite']);
    const second = await repo.appendReinforcementFootnotes(CHAR, 'm', ['Valparaiso', 'Marguerite']);

    expect(second).toEqual({
      content: 'Friday keeps the ledger.\n[+] Marguerite\n[+] Valparaiso',
      appended: ['Valparaiso'],
    });
    expect(content('m')).toBe('Friday keeps the ledger.\n[+] Marguerite\n[+] Valparaiso');
  });

  it('honours the footnote cap against the live content', async () => {
    const full = ['Base.', ...Array.from({ length: MAX_REINFORCEMENT_FOOTNOTES - 1 }, (_, i) => `[+] d${i}`)].join('\n');
    seed('m', CHAR, [], full);
    const repo = new MemoriesRepository();
    const result = await repo.appendReinforcementFootnotes(CHAR, 'm', ['last', 'over']);
    expect(result?.appended).toEqual(['last']);
    expect(content('m').split('\n').filter((l: string) => l.startsWith('[+] '))).toHaveLength(MAX_REINFORCEMENT_FOOTNOTES);
  });

  it('returns null for a missing row', async () => {
    const repo = new MemoriesRepository();
    await expect(repo.appendReinforcementFootnotes(CHAR, 'missing', ['x'])).resolves.toBeNull();
  });
});
