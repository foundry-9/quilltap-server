import {
  IMAGE_EXTENSIONS,
  bundleAssetUrl,
  bundleFontUrl,
  cssString,
  hasImageExtension,
  imageMimeType,
  isSafeBundlePath,
  normaliseBundlePath,
} from '@/lib/themes/engine/css-text';

describe('cssString', () => {
  it('quotes plain text', () => {
    expect(cssString('hello')).toBe('"hello"');
    expect(cssString('')).toBe('""');
  });

  it('escapes quotes and backslashes as hex escapes', () => {
    expect(cssString('a"b')).toBe('"a\\22 b"');
    expect(cssString('a\\b')).toBe('"a\\5c b"');
  });

  it('escapes < so a style element cannot be closed', () => {
    const out = cssString('</style><script>');
    expect(out).not.toContain('<');
    expect(out).toBe('"\\3c /style>\\3c script>"');
  });

  it('escapes control characters and DEL, including newlines', () => {
    expect(cssString('a\nb')).toBe('"a\\a b"');
    expect(cssString('\t')).toBe('"\\9 "');
    expect(cssString('\x7f')).toBe('"\\7f "');
  });

  it('leaves non-ASCII text and astral characters alone', () => {
    expect(cssString('café 🎩')).toBe('"café 🎩"');
  });
});

describe('isSafeBundlePath', () => {
  it.each(['a.png', 'images/a-b_c.webp', 'x/y/z.css'])('accepts %p', (p) => {
    expect(isSafeBundlePath(p)).toBe(true);
  });

  it.each([
    'a b.png',
    'a(1).png',
    'a"b.png',
    'a%20b.png',
    'a?b.png',
    'a#b.png',
    '/abs.png',
    '../up.png',
    'a/../b.png',
    'a//b.png',
    'a/./b.png',
    './a.png',
    'a/',
    '',
    'C:/x.png',
    'ünï.png',
  ])('refuses %p', (p) => {
    expect(isSafeBundlePath(p)).toBe(false);
  });
});

describe('normaliseBundlePath', () => {
  it('strips leading ./ repeatedly', () => {
    expect(normaliseBundlePath('./a/b.webp')).toBe('a/b.webp');
    expect(normaliseBundlePath('././a.webp')).toBe('a.webp');
  });

  it('leaves other paths untouched', () => {
    expect(normaliseBundlePath('a/./b')).toBe('a/./b');
    expect(normaliseBundlePath('a.webp')).toBe('a.webp');
    expect(normaliseBundlePath('../a')).toBe('../a');
  });
});

describe('bundle URLs', () => {
  it('builds the asset URL with a normalised path and encoded version', () => {
    expect(bundleAssetUrl('earl-grey', '1.2.0', './img/a.webp')).toBe(
      '/api/themes/assets/bundle:earl-grey/img/a.webp?v=1.2.0',
    );
    expect(bundleAssetUrl('t', '1.0.0+b 1', 'a.png')).toBe('/api/themes/assets/bundle:t/a.png?v=1.0.0%2Bb%201');
  });

  it('builds the font URL', () => {
    expect(bundleFontUrl('t', '2', './f/x.woff2')).toBe('/api/themes/fonts/bundle:t/f/x.woff2?v=2');
  });
});

describe('image extensions', () => {
  it('hasImageExtension is case-insensitive and checks the suffix', () => {
    expect(hasImageExtension('A.PNG')).toBe(true);
    expect(hasImageExtension('x/y.avif')).toBe(true);
    expect(hasImageExtension('x.png.txt')).toBe(false);
    expect(hasImageExtension('png')).toBe(false);
    expect(hasImageExtension('a.woff2')).toBe(false);
  });

  it('imageMimeType maps every listed extension', () => {
    expect(imageMimeType('a.png')).toBe('image/png');
    expect(imageMimeType('a.jpg')).toBe('image/jpeg');
    expect(imageMimeType('a.JPEG')).toBe('image/jpeg');
    expect(imageMimeType('a.gif')).toBe('image/gif');
    expect(imageMimeType('a.svg')).toBe('image/svg+xml');
    expect(imageMimeType('a.webp')).toBe('image/webp');
    expect(imageMimeType('a.avif')).toBe('image/avif');
    for (const ext of IMAGE_EXTENSIONS) expect(imageMimeType(`f${ext}`)).not.toBeNull();
  });

  it('imageMimeType returns null for non-images', () => {
    expect(imageMimeType('a.css')).toBeNull();
    expect(imageMimeType('a.png.bak')).toBeNull();
  });
});
