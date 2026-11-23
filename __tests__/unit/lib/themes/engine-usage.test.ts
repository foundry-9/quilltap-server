/**
 * @jest-environment node
 *
 * The engine's "what uses what" (Calliope Live, Spec F §0.1): every bundle
 * path a manifest, a tokens document and custom CSS refer to, read with the
 * engine's own url() parser.
 */

import { bundleFileUsage, describeFileUse, urlTargetsIn, type ThemeTokensDocument } from '@/lib/themes/engine';

const tokens = (doc: Partial<ThemeTokensDocument>) => ({ primitives: {}, tokens: {}, choices: {}, ...doc }) as ThemeTokensDocument;

describe('urlTargetsIn', () => {
  it('reads bundle paths and skips data, remote and rooted URLs', () => {
    expect(urlTargetsIn('url(./a.png), url("b/c.webp") url(data:image/png;base64,AA==) url(https://x.test/y.png) url(/z.png)')).toEqual(['a.png', 'b/c.webp']);
    expect(urlTargetsIn('none')).toEqual([]);
  });
});

describe('bundleFileUsage', () => {
  const manifest = {
    tokensPath: 'tokens.json',
    stylesPath: 'styles.css',
    previewImage: 'images/preview.png',
    fonts: [
      { family: 'Lora', src: 'fonts/Lora.woff2', licenseFile: 'fonts/OFL.txt', license: 'OFL-1.1' },
      { family: 'Lora Italic', src: './fonts/Lora-Italic.woff2', licenseFile: 'fonts/OFL.txt', license: 'OFL-1.1' },
      'not an entry',
    ],
    icons: { sun: 'icons/sun.svg', moon: 42 },
    subsystems: { salon: { backgroundImage: 'images/paper.webp', thumbnail: 'none' }, lantern: 'nope' },
  };

  it('names every user of every file', () => {
    const usage = bundleFileUsage({
      manifest,
      tokens: tokens({
        primitives: { grain: { type: 'image', value: 'url(images/grain.png)', dark: 'url(images/grain-dark.png)' } },
        tokens: { '--theme-page-background': { value: 'url(images/paper.webp)', dark: 'url(images/paper.webp)' } } as never,
      }),
      css: '.x { background: url(images/paper.webp) } .y { background: url(images/paper.webp) }',
    });

    expect(usage.get('tokens.json')).toEqual([{ kind: 'tokens-file' }]);
    expect(usage.get('styles.css')).toEqual([{ kind: 'styles-file' }]);
    expect(usage.get('images/preview.png')).toEqual([{ kind: 'preview-image' }]);
    expect(usage.get('fonts/Lora-Italic.woff2')).toEqual([{ kind: 'font', index: 1, family: 'Lora Italic' }]);
    expect(usage.get('fonts/OFL.txt')).toEqual([
      { kind: 'licence-file', index: 0, family: 'Lora' },
      { kind: 'licence-file', index: 1, family: 'Lora Italic' },
    ]);
    expect(usage.get('icons/sun.svg')).toEqual([{ kind: 'icon', name: 'sun' }]);
    expect(usage.get('images/grain-dark.png')).toEqual([{ kind: 'primitive', name: 'grain', mode: 'dark' }]);
    // The custom CSS counts once however often it names a file.
    expect(usage.get('images/paper.webp')).toEqual([
      { kind: 'subsystem', subsystem: 'salon', field: 'backgroundImage' },
      { kind: 'token', key: '--theme-page-background', mode: 'light' },
      { kind: 'token', key: '--theme-page-background', mode: 'dark' },
      { kind: 'custom-css' },
    ]);
    expect(usage.has('none')).toBe(false);
  });

  it('takes a manifest that does not parse as referring to nothing but its default tokens file', () => {
    expect([...bundleFileUsage({ manifest: null, tokens: null, css: null }).keys()]).toEqual([]);
    expect([...bundleFileUsage({ manifest: {}, tokens: null, css: null }).keys()]).toEqual(['tokens.json']);
  });

  it('describes a use in words', () => {
    expect(describeFileUse({ kind: 'font', index: 0, family: 'Lora' })).toBe('the font Lora');
    expect(describeFileUse({ kind: 'icon', name: 'sun' })).toBe('the icon sun');
    expect(describeFileUse({ kind: 'token', key: '--theme-x', mode: 'dark' })).toBe('the token --theme-x (dark)');
    expect(describeFileUse({ kind: 'subsystem', subsystem: 'salon', field: 'thumbnail' })).toBe('the thumbnail of salon');
  });
});
