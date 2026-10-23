/**
 * Glob matching for `doc_list_files`' `pattern` (bug 261).
 *
 * The tool's schema promises patterns like `*.md`, `*.{ts,tsx}` and
 * `src/**\/*.js`; the old matcher understood only `*.ext` and an exact file
 * name, so `**\/CHANGELOG.md` matched nothing anywhere. This compiles a glob
 * to a RegExp once per call.
 *
 * Rules:
 *  - A pattern with no `/` matches a file's name in any folder (`*.md`,
 *    `CHANGELOG.md`), the way the tool always behaved for `*.ext`.
 *  - A pattern with a `/` matches the whole store-relative path.
 *  - `**` spans folders, and `**\/` may match no folder at all, so
 *    `**\/CHANGELOG.md` finds a file at the root too. `*` and `?` stay within
 *    one path segment. `{a,b}` is alternation; `[abc]` / `[!abc]` are classes.
 *  - Matching is case-insensitive: store names are case-insensitive, and a
 *    model's guess at a file's casing should not hide it.
 *
 * Pure and client-safe.
 *
 * @module doc-edit/path-glob
 */

/** Translate a glob to the body of an anchored RegExp. */
function globToRegExpSource(glob: string): string {
  let out = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        i++; // consume the second '*'
        if (glob[i + 1] === '/' && atSegmentStart) {
          i++; // consume the '/': `**/` is zero or more whole folders
          out += '(?:[^/]*/)*';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let body = glob.slice(i + 1, close);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        out += `[${body.replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else if (c === '{') {
      braceDepth++;
      out += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      out += ')';
    } else if (c === ',' && braceDepth > 0) {
      out += '|';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // An unclosed brace: close it so the RegExp still compiles.
  out += ')'.repeat(braceDepth);
  return out;
}

/**
 * Compile `pattern` into a predicate over store-relative paths (`/`
 * separators, no leading slash). An empty pattern matches everything; a
 * pattern that cannot compile matches only its literal text.
 */
export function compilePathGlob(pattern: string): (relativePath: string) => boolean {
  const normalised = pattern.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  if (!normalised) return () => true;

  const matchesBasename = !normalised.includes('/');
  let regex: RegExp;
  try {
    regex = new RegExp(`^${globToRegExpSource(normalised)}$`, 'i');
  } catch {
    const literal = normalised.toLowerCase();
    return (relativePath) => {
      const target = matchesBasename ? relativePath.split('/').pop() ?? '' : relativePath;
      return target.toLowerCase() === literal;
    };
  }

  return (relativePath) => {
    const p = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const target = matchesBasename ? p.split('/').pop() ?? '' : p;
    return regex.test(target);
  };
}
