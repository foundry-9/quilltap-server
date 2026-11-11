/**
 * The store's path-equality rule (#224): `foldStorePath` folds ASCII only,
 * as SQLite `COLLATE NOCASE` does, and `chooseIdWinners` picks one file per id
 * when a split case-variant pair (or a Scriptorium copy) claims it twice.
 */

import { foldStorePath, sameStorePath } from '@/lib/mount-index/store-path-fold';
import { chooseIdWinners } from '@/lib/mount-index/item-rules';

describe('foldStorePath', () => {
  it('folds ASCII letters only, like SQLite NOCASE', () => {
    expect(foldStorePath('Wardrobe/Formal/NOTES.md')).toBe('wardrobe/formal/notes.md');
    expect(foldStorePath('Atlas/Café.md')).toBe('atlas/café.md');
    expect(foldStorePath('Atlas/CAFÉ.md')).toBe('atlas/cafÉ.md');
    expect(foldStorePath('Élan')).toBe('Élan');
  });

  it('never changes a path\'s length (slices stay aligned)', () => {
    // `toLowerCase()` turns the dotted capital I into two code units.
    const p = 'Atlas/İstanbul.md';
    expect(p.toLowerCase().length).not.toBe(p.length);
    expect(foldStorePath(p).length).toBe(p.length);
  });

  it('calls ASCII case variants one path and non-ASCII case variants two', () => {
    expect(sameStorePath('Atlas/cafe.md', 'Atlas/CAFE.md')).toBe(true);
    expect(sameStorePath('Atlas/Café.md', 'Atlas/CAFÉ.md')).toBe(false);
    expect(sameStorePath('Atlas/Café.md', 'atlas/café.md')).toBe(true);
  });
});

describe('chooseIdWinners', () => {
  const own = (r: { name: string }) => `Atlas/${r.name}.md`;

  it('prefers the file at the record\'s own name over a copy', () => {
    const winners = chooseIdWinners(
      [
        { path: 'Atlas/Café copy.md', record: { id: 'x', name: 'Café', updatedAt: '2026-11-11T00:00:00Z' } },
        { path: 'Atlas/Café.md', record: { id: 'x', name: 'Café', updatedAt: '2026-01-01T00:00:00Z' } },
      ],
      own,
    );
    expect(winners.get('x')).toBe('Atlas/Café.md');
  });

  it('keeps the newer half of a split Unicode case-only rename', () => {
    const winners = chooseIdWinners(
      [
        { path: 'Atlas/Café.md', record: { id: 'x', name: 'Café', updatedAt: '2026-01-01T00:00:00Z' } },
        { path: 'Atlas/CAFÉ.md', record: { id: 'x', name: 'CAFÉ', updatedAt: '2026-11-11T00:00:00Z' } },
      ],
      own,
    );
    expect(winners.get('x')).toBe('Atlas/CAFÉ.md');
  });

  it('falls back to the first by order when nothing is at its own name', () => {
    const winners = chooseIdWinners(
      [
        { path: 'Atlas/a.md', record: { id: 'x', name: 'Other' } },
        { path: 'Atlas/b.md', record: { id: 'x', name: 'Other' } },
      ],
      own,
    );
    expect(winners.get('x')).toBe('Atlas/a.md');
  });

  it('compares own names by the store rule, not toLowerCase()', () => {
    // `CAFÉ.md` is not at the own name of a record titled "Café" to the store.
    const winners = chooseIdWinners(
      [
        { path: 'Atlas/CAFÉ.md', record: { id: 'x', name: 'Café', updatedAt: '2026-11-11T00:00:00Z' } },
        { path: 'Atlas/café.md', record: { id: 'x', name: 'Café', updatedAt: '2026-01-01T00:00:00Z' } },
      ],
      own,
    );
    expect(winners.get('x')).toBe('Atlas/café.md');
  });
});
