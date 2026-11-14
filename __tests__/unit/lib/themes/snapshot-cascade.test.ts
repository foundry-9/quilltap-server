/**
 * @jest-environment node
 *
 * Unit tests for the root-element cascade behind the theme snapshot.
 */

import { resolveRootVariables } from '@/lib/themes/snapshot/cascade';
import { matchRootSelector, type RootElementState } from '@/lib/themes/snapshot/selector-match';

const ROOT: RootElementState = {
  attributes: { lang: 'en', 'data-theme': 'deco', 'data-color-mode': 'dark' },
  classes: ['dark'],
};

const resolve = (...css: string[]) =>
  resolveRootVariables(
    css.map((c, i) => ({ origin: `sheet${i}`, css: c })),
    ROOT
  );

describe('matchRootSelector', () => {
  it.each([
    [':root', true, [0, 1, 0]],
    ['html', true, [0, 0, 1]],
    ['*', true, [0, 0, 0]],
    ['[data-theme]', true, [0, 1, 0]],
    ['[data-theme="deco"].dark', true, [0, 2, 0]],
    ['[data-theme="deco"].light', false, [0, 2, 0]],
    ['[data-theme="other"]', false, [0, 1, 0]],
    ['.dark', true, [0, 1, 0]],
    [':where(.dark)', true, [0, 0, 0]],
    [':is(.light, [data-theme])', true, [0, 1, 0]],
    [':not(.light)', true, [0, 1, 0]],
    ['html:lang(en)', true, [0, 1, 1]],
    ['[data-theme] body', false, [0, 0, 0]],
    ['.dark > .x', false, [0, 0, 0]],
    [':root::selection', false, [0, 1, 1]],
    ['html:hover', false, [0, 1, 1]],
    ['#app', false, [1, 0, 0]],
  ] as const)('%s → %s', (selector, matches, specificity) => {
    const m = matchRootSelector(selector, ROOT);
    expect(m.matches).toBe(matches);
    if (matches) expect(m.specificity).toEqual(specificity);
  });

  it('takes the specificity of the most specific matching branch', () => {
    expect(matchRootSelector(':root, [data-theme].dark, .light.light.light', ROOT).specificity).toEqual([0, 2, 0]);
  });
});

describe('resolveRootVariables', () => {
  it('picks by specificity, then order', () => {
    const r = resolve(':root { --a: 1; --b: 1; } [data-theme] { --a: 2; } :root { --b: 2; }');
    expect(r.values).toEqual({ '--a': '2', '--b': '2' });
  });

  it('lets unlayered beat layered, and later layers beat earlier', () => {
    const r = resolve(
      '@layer one, two; @layer two { [data-theme].dark { --a: two; } } @layer one { [data-theme].dark.dark { --a: one; } } :root { --a: plain; --b: plain; } @layer two { :root { --b: layered; } }'
    );
    expect(r.values['--a']).toBe('plain');
    expect(r.values['--b']).toBe('plain');
  });

  it('reverses layer order for !important', () => {
    const r = resolve('@layer one, two; @layer one { :root { --a: one !important; } } @layer two { :root { --a: two !important; } } :root { --a: plain !important; }');
    expect(r.values['--a']).toBe('one');
  });

  it('substitutes var() recursively and honours fallbacks', () => {
    const r = resolve(':root { --a: var(--b); --b: var(--c, 4px) solid; --d: var(--nope, var(--b)); }');
    expect(r.values).toEqual({ '--a': '4px solid', '--b': '4px solid', '--d': '4px solid' });
  });

  it('reports cycles and unresolvable references', () => {
    const r = resolve(':root { --a: var(--b); --b: var(--a); --c: var(--missing); --d: var(--a, ok); }');
    expect(r.values).toEqual({ '--d': 'ok' });
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^cycle: /),
        'unresolvable: --c references --missing, which nothing declares, with no fallback',
      ])
    );
  });

  it('applies later sheets after earlier ones', () => {
    const r = resolve(':root { --a: app; }', ':root { --a: theme; }');
    expect(r.values['--a']).toBe('theme');
  });

  it('applies declarations nested in a rule, through known @supports, and skips @media', () => {
    const r = resolve(
      ':root { --a: fallback; @supports (color: color-mix(in lab, red, red)) { --a: color-mix(in srgb, red 50%, blue); } } @media (min-width: 1px) { :root { --b: wide; } }'
    );
    expect(r.values).toEqual({ '--a': 'color-mix(in srgb, red 50%, blue)' });
  });

  it('reports an unknown @supports condition', () => {
    const r = resolve('@supports (display: grid) { :root { --a: 1; } }');
    expect(r.values).toEqual({});
    expect(r.errors).toEqual(['sheet0: unknown @supports condition, skipped: (display: grid)']);
  });

  it('ignores rules that target descendants', () => {
    const r = resolve('[data-theme="deco"] .qt-card { --a: 1; } [data-theme="deco"] { --b: 2; }');
    expect(r.values).toEqual({ '--b': '2' });
  });

  it('uses @property initial values when nothing declares the property', () => {
    const r = resolve('@property --a { syntax: "*"; inherits: false; initial-value: 0px; } :root { --b: var(--a); }');
    expect(r.values).toEqual({ '--a': '0px', '--b': '0px' });
  });

  it('records a CSS-wide keyword as written but treats a reference to it as invalid', () => {
    const r = resolve(':root { --a: inherit; --b: var(--a, fine); }');
    expect(r.values).toEqual({ '--a': 'inherit', '--b': 'fine' });
  });
});
