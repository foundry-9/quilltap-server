/**
 * @jest-environment node
 *
 * Structured issues (Calliope Live, Spec G decision 6): the scoper, the
 * validator and the bundle loader give each message's file and line beside
 * it, and the message text is what it always was.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scopeThemeCss, validateThemeDocument } from '@/lib/themes/engine';
import { listBundleFiles, loadThemeFromSource, ThemeBundleError, validationContextFor, type ThemeBundleSource } from '@/lib/themes/theme-bundle';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/themes/v2-sample');
const manifest = () => JSON.parse(readFileSync(path.join(FIXTURE, 'theme.json'), 'utf8'));
const tokens = () => JSON.parse(readFileSync(path.join(FIXTURE, 'tokens.json'), 'utf8'));

let files: Set<string>;
beforeAll(async () => {
  files = await listBundleFiles(FIXTURE);
});

const scope = (css: string) => scopeThemeCss(css, { id: 'v2-sample', version: '1.0.0', files });

describe('scopeThemeCss', () => {
  it('gives a parse error its line, with the message unchanged', () => {
    const r = scope('.a { color: red; }\n\n.b { color: blue;\n');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^custom CSS does not parse \(line 3\): /);
    expect(r.issues).toEqual([{ message: r.errors[0], line: 3 }]);
  });

  it('gives a refused at-rule its line', () => {
    const r = scope('.a { color: red; }\n@import url("x.css");\n@font-face { font-family: X; }\n');
    expect(r.errors).toEqual([
      '@import is not allowed (line 2)',
      '@font-face is not allowed in custom CSS; declare fonts in theme.json (line 3)',
    ]);
    expect(r.issues).toEqual([
      { message: '@import is not allowed (line 2)', line: 2 },
      { message: '@font-face is not allowed in custom CSS; declare fonts in theme.json (line 3)', line: 3 },
    ]);
  });

  it('gives a url() error the line of its declaration', () => {
    const r = scope('.a {\n  color: red;\n  background: url("https://example.com/x.png");\n}\n');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].line).toBe(3);
    expect(r.issues[0].message).toMatch(/\(line 3\)$/);
  });

  it('has no issues when the CSS scopes cleanly', () => {
    const r = scope('.a { color: red; }');
    expect(r.errors).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});

describe('validateThemeDocument', () => {
  it('names the file of each error, and the line for custom CSS', () => {
    const t = tokens();
    t.tokens['--theme-not-a-token'] = { value: 'red' };
    const r = validateThemeDocument({ manifest: manifest(), tokens: t, css: '.a { color: red; }\n@charset "utf-8";\n' }, validationContextFor(files));
    expect(r.valid).toBe(false);
    if (r.valid) return;
    // The strings are unchanged and the issues carry the same messages, in order.
    expect(r.errorIssues.map((i) => i.message)).toEqual(r.errors);
    const css = r.errorIssues.find((i) => i.message.startsWith('styles.css:'));
    expect(css).toEqual({ message: 'styles.css: @charset is not allowed (line 2)', file: 'styles.css', line: 2 });
    const token = r.errorIssues.find((i) => i.message.includes('--theme-not-a-token'));
    expect(token).toMatchObject({ file: 'tokens.json' });
    expect(token?.line).toBeUndefined();
  });

  it('names theme.json for a manifest error', () => {
    const m = manifest();
    m.icons = { 'no-such-icon': 'icons/sun.svg' };
    const r = validateThemeDocument({ manifest: m, tokens: tokens(), css: '' }, validationContextFor(files));
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.errorIssues.every((i) => i.file === 'theme.json')).toBe(true);
  });
});

describe('the bundle loader', () => {
  /** The fixture, with its stylesheet replaced. */
  function sourceWithCss(css: string): ThemeBundleSource {
    return {
      label: 'test',
      files,
      readText: async (rel) => (rel === 'styles.css' ? css : readFileSync(path.join(FIXTURE, rel), 'utf8')),
    };
  }

  it('locates a hook finding as a warning on its line', async () => {
    const loaded = await loadThemeFromSource(sourceWithCss('.qt-card { color: red; }\n\n.not-a-hook-at-all { color: blue; }\n'), manifest());
    const finding = loaded.warningIssues.find((i) => i.message.includes('.not-a-hook-at-all'));
    expect(finding).toMatchObject({ file: 'styles.css', line: 3 });
    expect(finding?.message).toMatch(/^styles\.css:3: \.not-a-hook-at-all — /);
    expect(loaded.warnings).toContain(finding?.message);
  });

  it('carries the located errors on ThemeBundleError', async () => {
    let caught: unknown;
    try {
      await loadThemeFromSource(sourceWithCss('.a { color: red; }\n@namespace svg url(x);\n'), manifest());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ThemeBundleError);
    const error = caught as ThemeBundleError;
    expect(error.errors).toEqual(['styles.css: @namespace is not allowed (line 2)']);
    expect(error.issues).toEqual([{ message: 'styles.css: @namespace is not allowed (line 2)', file: 'styles.css', line: 2 }]);
  });
});
