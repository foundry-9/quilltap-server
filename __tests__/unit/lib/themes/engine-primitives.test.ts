/**
 * @jest-environment node
 *
 * Primitive edits (Calliope Live, Spec E, Stage 0.4): add, set, rename
 * (rewriting every reference) and remove (writing the value into its users,
 * decision 3).
 */

import {
  addPrimitive,
  primitiveUsers,
  removePrimitive,
  renamePrimitive,
  setPrimitiveDark,
  setPrimitiveType,
  setPrimitiveValue,
  type ThemeTokensDocument,
} from '@/lib/themes/engine/client';

const doc = (): ThemeTokensDocument => ({
  primitives: {
    ink: { type: 'color', value: '#111', dark: '#eee' },
    'ink-2': { type: 'color', value: '#222' },
    paper: { type: 'color', value: '#fff' },
    halo: { type: 'shadow', value: '0 0 4px var(--p-ink)' },
  },
  tokens: {
    '--theme-foreground': 'var(--p-ink)',
    '--theme-muted-foreground': 'color-mix(in srgb, var(--p-ink) 60%, var(--p-paper))',
    '--theme-border': 'var(--p-ink-2)',
    '--theme-card': { value: 'var(--p-paper)', dark: 'var(--p-ink)' },
    '--theme-ring': 'var(--p-ink, red)',
  },
  choices: {},
});

describe('primitiveUsers', () => {
  it('finds tokens and primitives that refer to a primitive, not to a longer name', () => {
    expect(primitiveUsers(doc(), 'ink')).toEqual({
      tokens: ['--theme-foreground', '--theme-muted-foreground', '--theme-card', '--theme-ring'],
      primitives: ['halo'],
    });
    expect(primitiveUsers(doc(), 'ink-2')).toEqual({ tokens: ['--theme-border'], primitives: [] });
  });
});

describe('add and set', () => {
  it('adds a primitive and refuses a taken or malformed name', () => {
    const added = addPrimitive(doc(), 'brass', { type: 'color', value: '#b5a642' });
    expect(added.ok && added.document.primitives.brass).toEqual({ type: 'color', value: '#b5a642' });
    expect(addPrimitive(doc(), 'ink', { type: 'color', value: '#000' })).toMatchObject({ ok: false });
    expect(addPrimitive(doc(), 'Brass', { type: 'color', value: '#000' })).toMatchObject({ ok: false });
    expect(addPrimitive(doc(), '2nd', { type: 'color', value: '#000' })).toMatchObject({ ok: false });
  });

  it('sets value, dark and type without touching the rest', () => {
    const original = doc();
    let next = setPrimitiveValue(original, 'paper', '#fafafa');
    next = setPrimitiveDark(next, 'paper', '#101010');
    expect(next.primitives.paper).toEqual({ type: 'color', value: '#fafafa', dark: '#101010' });
    next = setPrimitiveDark(next, 'paper', undefined);
    expect(next.primitives.paper).toEqual({ type: 'color', value: '#fafafa' });
    expect(setPrimitiveType(next, 'paper', 'raw').primitives.paper.type).toBe('raw');
    expect(original).toEqual(doc());
    expect(setPrimitiveValue(original, 'nope', 'x')).toBe(original);
  });
});

describe('renamePrimitive', () => {
  it('rewrites every reference, inside longer values and fallbacks too', () => {
    const r = renamePrimitive(doc(), 'ink', 'soot');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.document;
    expect(Object.keys(d.primitives)).toEqual(['soot', 'ink-2', 'paper', 'halo']);
    expect(d.tokens['--theme-foreground']).toBe('var(--p-soot)');
    expect(d.tokens['--theme-muted-foreground']).toBe('color-mix(in srgb, var(--p-soot) 60%, var(--p-paper))');
    expect(d.tokens['--theme-card']).toEqual({ value: 'var(--p-paper)', dark: 'var(--p-soot)' });
    expect(d.tokens['--theme-ring']).toBe('var(--p-soot, red)');
    expect(d.tokens['--theme-border']).toBe('var(--p-ink-2)');
    expect(d.primitives.halo.value).toBe('0 0 4px var(--p-soot)');
  });

  it('refuses a taken or malformed name', () => {
    expect(renamePrimitive(doc(), 'ink', 'paper')).toMatchObject({ ok: false });
    expect(renamePrimitive(doc(), 'ink', 'Soot')).toMatchObject({ ok: false });
    expect(renamePrimitive(doc(), 'nope', 'x')).toMatchObject({ ok: false });
  });
});

describe('removePrimitive', () => {
  it('writes light into light and dark into dark, creating a dark value where needed', () => {
    const d = removePrimitive(doc(), 'ink');
    expect(d.primitives.ink).toBeUndefined();
    expect(d.tokens['--theme-foreground']).toEqual({ value: '#111', dark: '#eee' });
    expect(d.tokens['--theme-muted-foreground']).toEqual({
      value: 'color-mix(in srgb, #111 60%, var(--p-paper))',
      dark: 'color-mix(in srgb, #eee 60%, var(--p-paper))',
    });
    expect(d.tokens['--theme-card']).toEqual({ value: 'var(--p-paper)', dark: '#eee' });
    expect(d.tokens['--theme-ring']).toEqual({ value: '#111', dark: '#eee' });
    expect(d.primitives.halo).toEqual({ type: 'shadow', value: '0 0 4px #111', dark: '0 0 4px #eee' });
    expect(d.tokens['--theme-border']).toBe('var(--p-ink-2)');
  });

  it('keeps a single value when the primitive has no dark value', () => {
    const d = removePrimitive(doc(), 'paper');
    expect(d.tokens['--theme-card']).toEqual({ value: '#fff', dark: 'var(--p-ink)' });
    expect(d.tokens['--theme-muted-foreground']).toBe('color-mix(in srgb, var(--p-ink) 60%, #fff)');
  });
});
