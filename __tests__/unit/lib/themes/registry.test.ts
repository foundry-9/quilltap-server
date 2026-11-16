/**
 * @jest-environment node
 *
 * The theme token registry's invariants (Calliope Live, Spec A): unique
 * names, resolvable references, no cycles, tiers respected, and the
 * generated sheets in step.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GENERATED_THEME_SHEETS,
  THEME_TOKENS,
  TOKEN_GROUPS,
  getThemeChoice,
  getThemeToken,
  getTokenGroup,
  getTokensInGroup,
  isThemeToken,
  renderThemeVariablesCss,
} from '@/lib/themes/registry';
import type { TokenDef } from '@/lib/themes/registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Names the app's Tailwind token map (`@theme inline`) declares. */
function tailwindTokenNames(): Set<string> {
  const css = readFileSync(path.join(REPO_ROOT, 'app/styles/theme-tokens.css'), 'utf8');
  const names = new Set<string>();
  for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)) {
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
  }
  return names;
}

/** Each var() reference in a value, with whether it carries a fallback. */
function references(value: string): Array<{ name: string; hasFallback: boolean }> {
  return [...value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].map((m) => ({ name: m[1], hasFallback: m[2] === ',' }));
}

function values(token: TokenDef): string[] {
  return token.defaultDark === undefined ? [token.default] : [token.default, token.defaultDark];
}

/** The internal tokens nothing read, removed once no theme set them (Spec C 3.1). */
const RETIRED_UNREAD_TOKENS = [
  '--qt-auth-page-bg',
  '--qt-footer-bg',
  '--qt-input-placeholder',
  '--qt-left-sidebar-footer-height',
  '--qt-left-sidebar-item-gap',
  '--qt-left-sidebar-max-width',
  '--qt-left-sidebar-min-width',
  '--qt-left-sidebar-overlay-bg',
  '--qt-left-sidebar-overlay-z',
  '--qt-sidebar-fg',
  '--qt-sidebar-muted',
  '--qt-tab-gap',
];

describe('theme token registry', () => {
  it('holds every variable _variables.css declared when the registry was built (audit CSV)', () => {
    const csv = readFileSync(path.join(REPO_ROOT, 'docs/developer/features/complete/calliope-live-audit-matrix.csv'), 'utf8').trim().split('\n');
    const audited = csv
      .slice(1)
      .map((line) => line.split(','))
      .filter((cells) => ['most', 'some', 'few', 'never'].includes(cells[2]))
      .map((cells) => cells[0]);
    expect(audited).toHaveLength(505);
    expect(audited.filter((name) => !isThemeToken(name)).sort()).toEqual(RETIRED_UNREAD_TOKENS);
  });

  it('has unique token names and group ids', () => {
    const names = THEME_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const ids = TOKEN_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every token under the group that lists it', () => {
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) expect(token.group).toBe(group.id);
    }
  });

  it('names custom properties and writes values free of statement breaks', () => {
    for (const token of THEME_TOKENS) {
      expect(token.name).toMatch(/^--(qt|theme)-[a-z0-9-]+$/);
      for (const v of values(token)) {
        expect(v.trim()).not.toBe('');
        expect(v.replace(/"[^"]*"|'[^']*'/g, '')).not.toMatch(/[;{}]|<\//);
      }
      for (const text of [token.description, token.descriptionDark, token.label]) {
        if (text) expect(text).not.toContain('*/');
      }
    }
  });

  it('only references registry tokens, Tailwind tokens, or hooks with a fallback', () => {
    const tailwind = tailwindTokenNames();
    const bad: string[] = [];
    for (const token of THEME_TOKENS) {
      for (const v of values(token)) {
        for (const ref of references(v)) {
          if (!isThemeToken(ref.name) && !tailwind.has(ref.name) && !ref.hasFallback) bad.push(`${token.name} -> ${ref.name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('has no reference cycles (%s)', (mode) => {
    const valueOf = (t: TokenDef) => (mode === 'dark' && t.defaultDark !== undefined ? t.defaultDark : t.default);
    const state = new Map<string, 'visiting' | 'done'>();
    const cycles: string[] = [];
    const visit = (name: string, trail: string[]) => {
      const token = getThemeToken(name);
      if (!token) return;
      if (state.get(name) === 'done') return;
      if (state.get(name) === 'visiting') {
        cycles.push([...trail, name].join(' -> '));
        return;
      }
      state.set(name, 'visiting');
      for (const ref of references(valueOf(token))) visit(ref.name, [...trail, name]);
      state.set(name, 'done');
    };
    for (const token of THEME_TOKENS) visit(token.name, []);
    expect(cycles).toEqual([]);
  });

  it('never lets a semantic default reference a component token', () => {
    const bad: string[] = [];
    for (const token of THEME_TOKENS.filter((t) => t.tier === 'semantic')) {
      for (const v of values(token)) {
        for (const ref of references(v)) {
          if (getThemeToken(ref.name)?.tier === 'component') bad.push(`${token.name} -> ${ref.name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('records a dark value only when it differs from the shared one', () => {
    for (const token of THEME_TOKENS) {
      if (token.defaultDark !== undefined) expect(token.defaultDark.replace(/\s+/g, ' ')).not.toBe(token.default.replace(/\s+/g, ' '));
    }
  });

  it('puts every --theme-* token in the semantic tier and every --qt-* token in the component tier', () => {
    for (const token of THEME_TOKENS) {
      expect([token.name, token.tier]).toEqual([token.name, token.name.startsWith('--theme-') ? 'semantic' : 'component']);
    }
  });

  it('writes the semantic tier to _theme-defaults.css, apart from the font stacks', () => {
    for (const group of TOKEN_GROUPS) {
      const semantic = group.tokens.some((t) => t.tier === 'semantic');
      if (group.id === 'fonts') expect(group.sheet ?? 'variables').toBe('variables');
      else expect([group.id, group.sheet ?? 'variables']).toEqual([group.id, semantic ? 'theme-defaults' : 'variables']);
    }
  });

  it('resets every optional token on nested theme containers, at specificity 0 and never on the root', () => {
    // An optional token is not declared by the defaults, so without the reset a
    // house-default panel inside a page wearing another theme inherits that
    // theme's value (Calliope Live, Spec H).
    const css = readFileSync(path.join(REPO_ROOT, 'app/styles/_theme-defaults.css'), 'utf8');
    const block = /:where\(\[data-theme\]:not\(:root\)\) \{([^}]*)\}/.exec(css);
    expect(block).not.toBeNull();
    const reset = [...block![1].matchAll(/(--[\w-]+): initial;/g)].map((m) => m[1]).sort();
    expect(reset).toEqual(THEME_TOKENS.filter((t) => t.optional).map((t) => t.name).sort());
  });

  it('explains every internal token', () => {
    for (const token of THEME_TOKENS.filter((t) => t.visibility === 'internal')) expect([token.name, token.description]).toEqual([token.name, expect.any(String)]);
  });

  it('gives choice values only for declared choices and their non-default options', () => {
    for (const token of THEME_TOKENS) {
      for (const [name, options] of Object.entries(token.byChoice ?? {})) {
        const choice = getThemeChoice(name);
        expect([token.name, choice?.name]).toEqual([token.name, name]);
        for (const option of Object.keys(options)) {
          expect(choice!.options).toContain(option);
          expect(option).not.toBe(choice!.default);
        }
      }
    }
    // Density is the sizing tokens: 28 at Spec C decision 7, less the three
    // unread ones retired in Stage 3; transitions and the header blur left it.
    expect(THEME_TOKENS.filter((t) => t.byChoice?.density?.comfortable !== undefined)).toHaveLength(25);
    for (const name of ['--qt-button-transition', '--qt-card-transition', '--qt-app-header-blur']) {
      expect([name, THEME_TOKENS.find((t) => t.name === name)?.byChoice]).toEqual([name, undefined]);
    }
  });

  it('never gives an optional hook a value (the nested-container reset to `initial` is not one)', () => {
    for (const sheet of GENERATED_THEME_SHEETS) {
      const css = sheet.render(TOKEN_GROUPS);
      for (const token of THEME_TOKENS.filter((t) => t.optional)) {
        expect(css).not.toMatch(new RegExp(`^\\s*${token.name}:(?!\\s*initial;)`, 'm'));
      }
    }
  });

  it('looks tokens up by name and by group', () => {
    expect(getThemeToken('--qt-card-padding')?.default).toBe('1.25rem');
    expect(getThemeToken('--nope')).toBeUndefined();
    expect(getTokenGroup('terminal')?.label).toBe('Terminal');
    expect(getTokensInGroup('workspace').map((t) => t.name)).toEqual(['--qt-workspace-accent', '--qt-workspace-tab-active-fg']);
    expect(getTokensInGroup('nope')).toEqual([]);
  });

  it.each(GENERATED_THEME_SHEETS.map((s) => [s.path, s] as const))('generates the committed %s', (file, sheet) => {
    expect(sheet.render(TOKEN_GROUPS)).toBe(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  });

  it('refuses text that would break the generated CSS', () => {
    const token: TokenDef = { name: '--qt-x', tier: 'component', type: 'raw', group: 'x', label: 'X', default: '1', visibility: 'advanced' };
    expect(() => renderThemeVariablesCss([{ id: 'x', label: 'X', tokens: [{ ...token, description: 'a */ b' }] }])).toThrow(/\*\//);
    expect(() => renderThemeVariablesCss([{ id: 'x', label: 'X', tokens: [{ ...token, default: '1; color: red' }] }])).toThrow(/";"/);
  });
});
