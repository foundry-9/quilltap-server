/**
 * Tests for the standalone CLI theme validator's `icons` override block.
 *
 * The validator lives in the published `quilltap` CLI package
 * (packages/quilltap/lib/theme-validation.js) and runs without Zod or the
 * Next.js app, so it soft-validates icon overrides: structure, asset extension,
 * and path-traversal safety only. The canonical icon-name list lives in the app
 * and cannot be imported here, so bad names warn rather than error.
 */

import path from 'node:path';

const { validateManifest } = require(
  path.join(process.cwd(), 'packages/quilltap/lib/theme-validation.js')
);

const REQUIRED_COLOR_KEYS = [
  'background', 'foreground', 'primary', 'primaryForeground',
  'secondary', 'secondaryForeground', 'muted', 'mutedForeground',
  'accent', 'accentForeground', 'destructive', 'destructiveForeground',
  'card', 'cardForeground', 'popover', 'popoverForeground',
  'border', 'input', 'ring',
];

function makePalette(): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const key of REQUIRED_COLOR_KEYS) palette[key] = '#000000';
  return palette;
}

function makeManifest(icons?: unknown): Record<string, unknown> {
  return {
    format: 'qtap-theme',
    formatVersion: 1,
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    author: 'tester',
    supportsDarkMode: true,
    tokens: { colors: { light: makePalette(), dark: makePalette() } },
    ...(icons !== undefined ? { icons } : {}),
  };
}

const iconErrors = (r: { errors: string[] }) => r.errors.filter(e => /icon/i.test(e));
const iconWarnings = (r: { warnings: string[] }) => r.warnings.filter(w => /icon/i.test(w));

describe('CLI theme validator — icons block', () => {
  it('accepts a valid icons map of .svg and .webp overrides', () => {
    const r = validateManifest(makeManifest({
      chat: 'icons/chat.svg',
      prospero: 'icons/prospero.webp',
    }));
    expect(r.valid).toBe(true);
    expect(iconErrors(r)).toEqual([]);
    expect(iconWarnings(r)).toEqual([]);
  });

  it('rejects asset paths that are not .svg or .webp', () => {
    const r = validateManifest(makeManifest({ chat: 'icons/chat.png' }));
    expect(r.valid).toBe(false);
    expect(iconErrors(r).join(' ')).toContain('.svg or .webp');
  });

  it('rejects path traversal in asset paths', () => {
    const r = validateManifest(makeManifest({ chat: '../../../etc/passwd.svg' }));
    expect(r.valid).toBe(false);
    expect(iconErrors(r).join(' ')).toContain('unsafe asset path');
  });

  it('rejects absolute asset paths', () => {
    const r = validateManifest(makeManifest({ chat: '/etc/passwd.svg' }));
    expect(r.valid).toBe(false);
    expect(iconErrors(r).join(' ')).toContain('unsafe asset path');
  });

  it('rejects empty asset path values', () => {
    const r = validateManifest(makeManifest({ chat: '' }));
    expect(r.valid).toBe(false);
    expect(iconErrors(r).join(' ')).toContain('non-empty string');
  });

  it('warns (but does not error) on malformed icon names', () => {
    const r = validateManifest(makeManifest({ Chat_Bad: 'icons/x.svg' }));
    expect(r.valid).toBe(true);
    expect(iconWarnings(r).join(' ')).toContain('not a valid icon name');
  });

  it('rejects a non-object icons value', () => {
    const r = validateManifest(makeManifest(['icons/x.svg']));
    expect(r.valid).toBe(false);
    expect(iconErrors(r).join(' ')).toContain('must be an object');
  });

  it('accepts a manifest with no icons block', () => {
    const r = validateManifest(makeManifest(undefined));
    expect(iconErrors(r)).toEqual([]);
  });
});
