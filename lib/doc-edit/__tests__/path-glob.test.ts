/**
 * Bug 261 — `doc_list_files`' pattern is a real glob (`compilePathGlob`).
 */
import { compilePathGlob } from '../path-glob';

const matches = (pattern: string, path: string) => compilePathGlob(pattern)(path);

describe('compilePathGlob', () => {
  it('an empty pattern matches everything', () => {
    expect(matches('', 'a/b.md')).toBe(true);
  });

  it('`**/` may match no folder at all', () => {
    expect(matches('**/CHANGELOG.md', 'CHANGELOG.md')).toBe(true);
    expect(matches('**/CHANGELOG.md', 'docs/CHANGELOG.md')).toBe(true);
    expect(matches('**/CHANGELOG.md', 'a/b/c/CHANGELOG.md')).toBe(true);
    expect(matches('**/CHANGELOG.md', 'docs/OLD-CHANGELOG.md')).toBe(false);
  });

  it('a pattern without a slash matches the file name in any folder', () => {
    expect(matches('*.md', 'notes.md')).toBe(true);
    expect(matches('*.md', 'deep/folder/notes.md')).toBe(true);
    expect(matches('CHANGELOG.md', 'docs/CHANGELOG.md')).toBe(true);
    expect(matches('*.md', 'notes.mdx')).toBe(false);
  });

  it('a pattern with a slash matches the whole path, `*` within one segment', () => {
    expect(matches('docs/*.md', 'docs/a.md')).toBe(true);
    expect(matches('docs/*.md', 'docs/sub/a.md')).toBe(false);
    expect(matches('src/**/*.js', 'src/a.js')).toBe(true);
    expect(matches('src/**/*.js', 'src/x/y/a.js')).toBe(true);
    expect(matches('src/**/*.js', 'lib/a.js')).toBe(false);
    expect(matches('docs/**', 'docs/a/b.md')).toBe(true);
  });

  it('supports braces, ? and character classes', () => {
    expect(matches('*.{ts,tsx}', 'a.tsx')).toBe(true);
    expect(matches('*.{ts,tsx}', 'a.js')).toBe(false);
    expect(matches('v?.md', 'v2.md')).toBe(true);
    expect(matches('v?.md', 'v10.md')).toBe(false);
    expect(matches('v[0-9].md', 'v3.md')).toBe(true);
    expect(matches('v[!0-9].md', 'v3.md')).toBe(false);
  });

  it('is case-insensitive and ignores a leading ./ or /', () => {
    expect(matches('changelog.MD', 'CHANGELOG.md')).toBe(true);
    expect(matches('./docs/*.md', 'docs/a.md')).toBe(true);
    expect(matches('/docs/*.md', 'docs/a.md')).toBe(true);
  });

  it('treats regex metacharacters literally', () => {
    expect(matches('notes (2).md', 'notes (2).md')).toBe(true);
    expect(matches('a+b.md', 'aab.md')).toBe(false);
    expect(matches('a.md', 'aXmd')).toBe(false);
  });

  it('never throws on a malformed pattern', () => {
    expect(() => compilePathGlob('[unclosed')).not.toThrow();
    expect(matches('{a,b', 'a')).toBe(true);
  });
});
