/**
 * `quilltap migrations status` compares the ledger against the ids it reads
 * out of `migrations/scripts/*.ts`. Most migrations declare their id through a
 * `MIGRATION_ID` constant rather than a string literal; when the reader only
 * understood literals, every one of those vanished from "source" and showed up
 * as "retired" on any instance that had run it.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { extractMigrationId } = require('../migrations-commands');

describe('extractMigrationId', () => {
  it('reads a string-literal id', () => {
    expect(extractMigrationId(`export const m = {\n  id: 'foo-v1',\n};`)).toBe('foo-v1');
  });

  it('resolves an id declared through MIGRATION_ID', () => {
    const src = `const MIGRATION_ID = 'bar-v1';\nexport const m = {\n  id: MIGRATION_ID,\n};`;
    expect(extractMigrationId(src)).toBe('bar-v1');
  });

  it('accepts a typed MIGRATION_ID constant', () => {
    const src = `const MIGRATION_ID: string = 'baz-v1'\nexport const m = {\n  id: MIGRATION_ID,\n};`;
    expect(extractMigrationId(src)).toBe('baz-v1');
  });

  it('returns null when no id is declared', () => {
    expect(extractMigrationId('export const nothing = 1;')).toBeNull();
  });
});

describe('every migration script yields an id', () => {
  const scriptsDir = path.join(__dirname, '..', '..', '..', '..', 'migrations', 'scripts');
  const files = fs.existsSync(scriptsDir)
    ? fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    : [];

  it('finds the migration scripts', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('extracts an id from each one', () => {
    const missing = files.filter(
      (f) => !extractMigrationId(fs.readFileSync(path.join(scriptsDir, f), 'utf8'))
    );
    expect(missing).toEqual([]);
  });
});
