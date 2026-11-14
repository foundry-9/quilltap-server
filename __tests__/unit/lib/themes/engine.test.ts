/**
 * @jest-environment node
 *
 * The version 2 theme engine (Calliope Live, Spec A Stage 3): schema
 * acceptance and every rejection in 3.1 and 3.3, resolve provenance, the
 * emitted and scoped CSS (snapshots), and escaping of manifest strings.
 * The fixture theme is __tests__/fixtures/themes/v2-sample.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  compileThemeV2,
  compiledThemeCss,
  cssString,
  resolveTheme,
  scopeSelector,
  scopeThemeCss,
  tailwindTokenNames,
  ThemeTokensDocumentSchema,
  validateThemeDocument,
  type ThemeDocumentValidation,
} from '@/lib/themes/engine';
import { listBundleFiles, THEME_REGISTRY_VIEW, validationContextFor } from '@/lib/themes/v2-bundle';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/themes/v2-sample');
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const manifest = () => JSON.parse(readFileSync(path.join(FIXTURE, 'theme.json'), 'utf8'));
const tokens = () => JSON.parse(readFileSync(path.join(FIXTURE, 'tokens.json'), 'utf8'));
const css = () => readFileSync(path.join(FIXTURE, 'styles.css'), 'utf8');

let files: Set<string>;
beforeAll(async () => {
  files = await listBundleFiles(FIXTURE);
});

function validate(patch: { manifest?: (m: any) => void; tokens?: (t: any) => void; css?: string } = {}): ThemeDocumentValidation {
  const m = manifest();
  const t = tokens();
  patch.manifest?.(m);
  patch.tokens?.(t);
  return validateThemeDocument({ manifest: m, tokens: t, css: patch.css ?? css() }, validationContextFor(files));
}

const errorsOf = (r: ThemeDocumentValidation) => (r.valid ? [] : r.errors);
const expectError = (r: ThemeDocumentValidation, pattern: RegExp) => {
  expect(r.valid).toBe(false);
  expect(errorsOf(r).some((e) => pattern.test(e))).toBe(true);
};

describe('the fixture theme', () => {
  it('lists its files', () => {
    expect([...files].sort()).toEqual([
      'fonts/OFL.txt',
      'fonts/RethinkSans-latin-ext.woff2',
      'icons/sun.svg',
      'styles.css',
      'textures/paper-dark.webp',
      'textures/paper.webp',
      'theme.json',
      'tokens.json',
    ]);
  });

  it('validates', () => {
    const r = validate();
    expect(errorsOf(r)).toEqual([]);
    expect(r.valid).toBe(true);
  });
});

describe('theme.json rejections (3.1)', () => {
  it.each([
    ['extendsTheme is not part of version 2', (m: any) => (m.extendsTheme = 'default'), /Unrecognized key.*extendsTheme/],
    ['a font needs a licence', (m: any) => delete m.fonts[0].license, /fonts\.0\.license/],
    ['a licence file must exist', (m: any) => (m.fonts[0].licenseFile = 'fonts/LICENSE.txt'), /fonts\.0\.licenseFile: file "fonts\/LICENSE.txt" is not in the bundle/],
    ['a font file must exist', (m: any) => (m.fonts[0].src = 'fonts/Missing.woff2'), /fonts\.0\.src: file/],
    ['an icon must be an app icon', (m: any) => (m.icons = { sunn: 'icons/sun.svg' }), /icons\.sunn: not an app icon \(did you mean "sun"\?\)/],
    ['an icon must be .svg or .webp', (m: any) => (m.icons = { sun: 'textures/paper.png' }), /icons\.sun: must be \.svg or \.webp/],
    ['an icon file must exist', (m: any) => (m.icons = { sun: 'icons/moon.svg' }), /icons\.sun: file "icons\/moon.svg"/],
    ['a subsystem key must be a subsystem id', (m: any) => (m.subsystems = { salonn: {} }), /subsystems\.salonn: not a subsystem id \(did you mean "salon"\?\)/],
    ['a subsystem image must be a bundle path', (m: any) => (m.subsystems = { salon: { backgroundImage: 'https://example.com/a.webp' } }), /subsystems\.salon\.backgroundImage/],
    ['a subsystem image must exist', (m: any) => (m.subsystems = { salon: { thumbnail: 'textures/nope.webp' } }), /subsystems\.salon\.thumbnail: file/],
    ['paths are plain characters only', (m: any) => (m.previewImage = 'textures/my paper.webp'), /previewImage: Must be a path inside the bundle/],
    ['paths stay inside the bundle', (m: any) => (m.stylesPath = '../styles.css'), /stylesPath/],
  ])('%s', (_label, mutate, pattern) => {
    expectError(validate({ manifest: mutate }), pattern);
  });

  it('accepts "none" for a subsystem image', () => {
    expect(validate({ manifest: (m) => (m.subsystems = { salon: { thumbnail: 'none' } }) }).valid).toBe(true);
  });
});

describe('tokens.json rejections (3.1)', () => {
  const setToken = (name: string, value: unknown) => (t: any) => (t.tokens[name] = value);
  it.each([
    ['an unknown token, with the nearest name', setToken('--theme-primery', 'red'), /tokens\.--theme-primery: not a registry token \(did you mean --theme-primary\?\)/],
    ['a primitive written as a token', setToken('--p-gold', 'red'), /primitives go under "primitives"/],
    ['an unknown choice', (t: any) => (t.choices = { densty: 'compact' }), /choices\.densty: not a choice/],
    ['an unknown option', (t: any) => (t.choices = { density: 'roomy' }), /choices\.density: "roomy" is not an option/],
    ['a var() to nothing, with no fallback', setToken('--theme-accent', 'var(--p-golden)'), /var\(--p-golden\) names no primitive or registry token and has no fallback \(did you mean --p-gold\?\)/],
    ['a value with ";"', setToken('--theme-accent', 'red; color: blue'), /may not contain/],
    ['a value with "}"', setToken('--theme-accent', 'red } body { color: blue'), /may not contain/],
    ['a value with "</"', setToken('--qt-card-padding', '1px </style>'), /may not contain/],
    ['a value with "!important"', setToken('--theme-accent', 'red !important'), /may not contain/],
    ['a literal that is not a colour', setToken('--theme-accent', '12px'), /"12px" is not a colour/],
    ['a literal that is not a length', setToken('--qt-card-padding', 'red'), /"red" is not a length/],
    ['a remote url()', setToken('--qt-page-background-image', 'url(https://example.com/a.webp)'), /remote or absolute URL/],
    ['a protocol-relative url()', setToken('--qt-page-background-image', 'url(//example.com/a.webp)'), /protocol-relative/],
    ['a rooted url()', setToken('--qt-page-background-image', 'url(/images/a.webp)'), /rooted URL/],
    ['a url() to a missing file', setToken('--qt-page-background-image', 'url(textures/missing.webp)'), /not in the bundle/],
    ['a url() to a non-image', setToken('--qt-page-background-image', 'url(fonts/OFL.txt)'), /does not name an image/],
    ['a non-image data URI', setToken('--qt-page-background-image', 'url("data:text/html,<p>x")'), /only data:image/],
    ['a reference cycle', (t: any) => Object.assign(t.tokens, { '--qt-card-bg': 'var(--qt-card-fg)', '--qt-card-fg': 'var(--qt-card-bg)' }), /reference cycle \(light\): --qt-card-(bg|fg) -> --qt-card-(fg|bg) -> --qt-card-\1/],
    ['a cycle through a Tailwind name', setToken('--theme-primary', 'var(--qt-button-primary-bg)'), /reference cycle.*--color-primary/],
    ['a primitive of the wrong type', (t: any) => (t.primitives['line-thin'] = { type: 'length', value: 'blue' }), /primitives\.line-thin\.value: "blue" is not a length/],
  ])('%s', (_label, mutate, pattern) => {
    expectError(validate({ tokens: mutate }), pattern);
  });

  it('accepts a var() with a fallback, a data:image URI and values with functions', () => {
    const r = validate({
      tokens: (t) =>
        Object.assign(t.tokens, {
          '--theme-accent': 'var(--not-a-token, oklch(70% 0.1 200))',
          '--qt-card-bg': 'color-mix(in srgb, var(--color-card) 90%, transparent)',
          '--qt-page-background-image': 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'/>")',
        }),
    });
    expect(errorsOf(r)).toEqual([]);
  });

  it('takes the Tailwind names from the registry, matching theme-tokens.css', () => {
    const cssNames = new Set<string>();
    const themeTokens = readFileSync(path.join(REPO_ROOT, 'app/styles/theme-tokens.css'), 'utf8');
    for (const block of themeTokens.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)) for (const m of block[1].matchAll(/(--[\w-]+)\s*:/g)) cssNames.add(m[1]);
    expect([...tailwindTokenNames(THEME_REGISTRY_VIEW)].sort()).toEqual([...cssNames].sort());
  });
});

describe('custom CSS (3.3)', () => {
  const ctx = () => ({ id: 'v2-sample', version: '1.0.0', files });

  it.each([
    [':root', '[data-theme="v2-sample"]'],
    [':root .a', '[data-theme="v2-sample"] .a'],
    ['html.x .a', '[data-theme="v2-sample"].x .a'],
    ['.dark .a', '[data-theme="v2-sample"].dark .a'],
    ['.light', '[data-theme="v2-sample"].light'],
    ['.darker .a', '[data-theme="v2-sample"] .darker .a'],
    ['body .a', '[data-theme="v2-sample"] body .a'],
    ['.a::before', '[data-theme="v2-sample"] .a::before'],
    ['*', '[data-theme="v2-sample"] *'],
  ])('scopes %s', (selector, expected) => {
    expect(scopeSelector(selector, 'v2-sample')).toBe(expected);
  });

  it.each([
    ['@import', '@import "x.css";', /@import is not allowed/],
    ['@font-face', '@font-face { font-family: X; src: url(fonts/RethinkSans-latin-ext.woff2); }', /@font-face is not allowed/],
    ['@charset', '@charset "utf-8";', /@charset is not allowed/],
    ['@namespace', '@namespace svg url(http://www.w3.org/2000/svg);', /@namespace is not allowed/],
    ['another at-rule', '@page { margin: 0; }', /@page is not allowed/],
    ['unparseable CSS', '.a { color: red', /does not parse \(line 1\)/],
    ['"</" in the output', '.a::after { content: "</div>"; }', /may not contain "<\/"/],
    ['a remote url()', '.a { background: url("https://example.com/x.png"); }', /remote or absolute URL.*\(line 1\)/],
    ['a missing file', '.a {\n  background: url(textures/nope.png);\n}', /not in the bundle \(line 2\)/],
    ['a bare string in image-set()', '.a { background-image: image-set("textures/paper.webp" 1x); }', /image-set\(\) takes url\(\)/],
    ['a declaration outside a rule', 'color: red;', /outside a rule|does not parse/],
  ])('rejects %s', (_label, source, pattern) => {
    const r = scopeThemeCss(source, ctx());
    expect(r.css).toBe('');
    expect(r.errors.some((e) => pattern.test(e))).toBe(true);
  });

  it('never lets "</style" through: PostCSS escapes it when it re-serialises', () => {
    for (const source of ['.a::after { content: "</style><script>"; }', '.a::after { content: "</STYLE>"; }', '.a { --x: </style>; }']) {
      const r = scopeThemeCss(source, ctx());
      expect(r.css.toLowerCase()).not.toContain('</style');
    }
  });

  it('renames keyframes and the animations that use them, and keeps @media, @supports, @container and @layer', () => {
    const r = scopeThemeCss(
      '@keyframes pulse { to { opacity: 0; } }\n.a { animation: pulse 1s, other 2s; }\n@supports (display: grid) { .b { display: grid; } }\n@container (width > 1px) { .c { color: red; } }\n@layer theme-extras { .d { color: blue; } }',
      ctx()
    );
    expect(r.errors).toEqual([]);
    expect(r.css).toContain('@keyframes v2-sample-pulse');
    expect(r.css).toContain('animation: v2-sample-pulse 1s, other 2s');
    const flat = r.css.replace(/\s+/g, ' ');
    expect(flat).toContain('@supports (display: grid) { [data-theme="v2-sample"] .b');
    expect(flat).toContain('@container (width > 1px) { [data-theme="v2-sample"] .c');
    expect(flat).toContain('@layer theme-extras { [data-theme="v2-sample"] .d');
  });

  it('re-serialises without comments', () => {
    const r = scopeThemeCss('/* note */ .a { color: red; /* inner */ }', ctx());
    expect(r.css).not.toContain('note');
    expect(r.css).not.toContain('inner');
  });
});

describe('resolveTheme provenance (3.2)', () => {
  const resolved = () => resolveTheme(ThemeTokensDocumentSchema.parse(tokens()), THEME_REGISTRY_VIEW);

  it('says where every value came from', () => {
    const { light, dark, choices } = resolved();
    expect(light['--theme-primary']).toEqual({ value: 'var(--p-gold)', source: 'theme' });
    expect(dark['--theme-primary']).toEqual({ value: 'var(--p-gold)', source: 'theme' });
    expect(dark['--theme-background']).toEqual({ value: 'hsl(30 15% 9%)', source: 'theme-dark' });
    expect(light['--qt-card-padding']).toEqual({ value: '1.5rem', source: 'choice' });
    expect(light['--theme-muted'].source).toBe('default');
    expect(dark['--theme-muted'].source).toBe('default-dark');
    expect(dark['--p-gold']).toEqual({ value: '#F4BE34', source: 'theme-dark' });
    expect(choices).toEqual({ density: 'comfortable' });
  });

  it('lists an optional hook only when the theme sets it', () => {
    const { light } = resolved();
    expect(light['--qt-heading-letter-spacing']).toEqual({ value: '0.04em', source: 'theme' });
    expect(light['--qt-heading-font-weight']).toBeUndefined();
  });
});

describe('compiled CSS (3.2, 3.3)', () => {
  const compiled = () => {
    const r = validate();
    if (!r.valid) throw new Error(r.errors.join('\n'));
    return compileThemeV2(r.document, r.scopedCss, THEME_REGISTRY_VIEW);
  };

  it('emits only what the theme sets', () => {
    expect(compiled().css.tokens).toMatchSnapshot();
  });

  it('scopes the custom CSS', () => {
    expect(compiled().css.custom).toMatchSnapshot();
  });

  it('writes font faces and icons with escaped, versioned asset URLs', () => {
    const c = compiled();
    expect(c.css.fontFaces).toMatchSnapshot();
    expect(c.css.icons).toBe('[data-theme="v2-sample"] [data-icon="sun"] { --_qt-icon-mask: url("/api/themes/assets/bundle:v2-sample/icons/sun.svg?v=1.0.0"); --_qt-icon-bg: none; background-color: currentColor; }');
  });

  it('derives choices, features and the picker swatches', () => {
    const c = compiled();
    expect(c.choices).toEqual({ density: 'comfortable' });
    expect(c.features).toEqual({ pageBackground: true, focusRing: true, scrollbar: true });
    expect(c.previewColors.light.primary).toBe('#C19015');
    expect(c.previewColors.dark.background).toBe('hsl(30 15% 9%)');
    expect(c.headingFont).toBe('"Rethink Sans", system-ui, sans-serif');
  });

  it('escapes a manifest string wherever it reaches CSS', () => {
    const r = validate({ manifest: (m) => (m.fonts[0].family = 'Evil"; } body { display: none } </style>') });
    if (!r.valid) throw new Error(r.errors.join('\n'));
    const out = compiledThemeCss(compileThemeV2(r.document, r.scopedCss, THEME_REGISTRY_VIEW));
    expect(out).not.toContain('</style');
    expect(out).toContain('font-family: "Evil\\22 ; } body { display: none } \\3c /style>";');
    expect(cssString('a"b\\c\n<')).toBe('"a\\22 b\\5c c\\a \\3c "');
  });
});
