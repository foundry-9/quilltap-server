/**
 * Calliope Live, Spec A Stage 2.5 — the fit report's tables.
 *
 *   npx tsx scripts/theme-fit-report.ts > /tmp/fit-tables.md
 *
 * For each new semantic family, asks of each bundled theme: if the theme set
 * only the family's semantic tokens, how many of the component values it sets
 * today would the registry's derivations reproduce?
 *
 * Method.
 * - A theme's values are its resolved snapshot (__tests__/unit/lib/themes/
 *   fixtures/snapshots), light and dark. "Sets" means the theme declares the
 *   variable (audit CSV, docs/developer/features/complete/calliope-live-audit-matrix.csv).
 * - Each semantic token is anchored to the theme: read off the first
 *   component token whose registry formula can be inverted — `var(S)` gives S
 *   directly; `color-mix(in srgb, var(S) <p>, transparent)` gives S as that
 *   colour made opaque and, when <p> is `var(T)`, T as its alpha. Tokens with
 *   no inverting component take a stated anchor (the hover shade: black).
 * - Each component the theme sets is then evaluated from the registry
 *   formula with the anchored values (other references resolve to the theme's
 *   own values) and compared with what the theme renders: exact (renders alike,
 *   8-bit RGBA), near (ΔE_OK ≤ 0.02, composited over the theme's background),
 *   or override (still needs a component value).
 * - "Alternative" rows test the derivation the spec first proposed, where the
 *   registry chose differently, so the choice is visible.
 * - The 2.3 features are measured on the themes' hand-written rules: of the
 *   declarations a theme writes for a feature, how many the new tokens express.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss, { type Rule } from 'postcss';
import { deltaEOK, parseColor, renderAlike, type Rgba } from '../lib/themes/color';
import { THEME_TOKENS, getThemeToken, type TokenDef } from '../lib/themes/registry';
import { substituteVars } from '../lib/themes/snapshot/var-substitute';

const ROOT = path.resolve(__dirname, '..');
const THEMES = ['art-deco', 'earl-grey', 'great-estate', 'madmans-box', 'old-school', 'rains'] as const;
const MODES = ['light', 'dark'] as const;
type Mode = (typeof MODES)[number];
type Vals = Record<string, string>;
const NEAR = 0.02;

const fixtures: Record<string, Record<Mode, Vals>> = {};
for (const t of THEMES) {
  fixtures[t] = {} as Record<Mode, Vals>;
  for (const m of MODES) {
    fixtures[t][m] = JSON.parse(readFileSync(path.join(ROOT, `__tests__/unit/lib/themes/fixtures/snapshots/${t}.${m}.json`), 'utf8')).variables;
  }
}

/** Minimal CSV parsing (quoted fields with commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.trim().split('\n')) {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}
const csv = parseCsv(readFileSync(path.join(ROOT, 'docs/developer/features/complete/calliope-live-audit-matrix.csv'), 'utf8'));
const header = csv[0];
const setBy: Record<string, Set<string>> = Object.fromEntries(THEMES.map((t) => [t, new Set<string>()]));
for (const row of csv.slice(1)) for (const t of THEMES) if (row[header.indexOf(t)]) setBy[t].add(row[0]);

const valueFor = (t: TokenDef, mode: Mode) => (mode === 'dark' && t.defaultDark !== undefined ? t.defaultDark : t.default);
const fmt = (n: number) => Number(n.toFixed(6)).toString();
const opaque = (s: string | undefined): string | undefined => {
  const c = s ? parseColor(s) : null;
  return c ? `rgb(${fmt(c.r * 255)} ${fmt(c.g * 255)} ${fmt(c.b * 255)})` : undefined;
};
const alphaPct = (s: string | undefined): string | undefined => {
  const c = s ? parseColor(s) : null;
  return c ? `${fmt(c.a * 100)}%` : undefined;
};

interface Family {
  id: string;
  title: string;
  /** Component tokens measured. */
  components: string[];
  /** Fixed anchors for semantic tokens no component inverts. */
  fixed?: Record<string, (v: Vals) => string | undefined>;
  /** Formula overrides, for an alternative row: component → formula (light, dark). */
  formulas?: Record<string, string>;
}

const refs = (expr: string) => [...expr.matchAll(/var\(\s*(--theme-[\w-]+)/g)].map((m) => m[1]);
const semanticOf = (components: string[]) => [...new Set(components.flatMap((c) => refs(valueFor(getThemeToken(c)!, 'light')).concat(refs(valueFor(getThemeToken(c)!, 'dark')))))];

/** Read each semantic token off the theme's own component values. */
function anchors(family: Family, v: Vals, mode: Mode): Vals {
  const out: Vals = {};
  for (const [name, fn] of Object.entries(family.fixed ?? {})) {
    const value = fn(v);
    if (value !== undefined) out[name] = value;
  }
  const formula = (c: string) => family.formulas?.[c] ?? valueFor(getThemeToken(c)!, mode);
  // pass 1: var(S) exactly
  for (const c of family.components) {
    const m = /^var\((--theme-[\w-]+)\)$/.exec(formula(c));
    if (m && !(m[1] in out) && v[c] !== undefined) out[m[1]] = v[c];
  }
  // pass 2: colour at a share of transparent — components whose share is itself
  // a token first (the family's primary surface), then fixed shares
  const shareIsToken = (c: string) => /transparent\)$/.test(formula(c)) && /\) var\(--theme-[\w-]+\), transparent\)$/.test(formula(c));
  const ordered = [...family.components.filter(shareIsToken), ...family.components.filter((c) => !shareIsToken(c))];
  for (const c of ordered) {
    const m = /^color-mix\(in srgb, var\((--theme-[\w-]+)\) (var\((--theme-[\w-]+)\)|[\d.]+%), transparent\)$/.exec(formula(c));
    if (!m || v[c] === undefined) continue;
    if (!(m[1] in out)) {
      const base = opaque(v[c]);
      if (base) out[m[1]] = base;
    }
    if (m[3] && !(m[3] in out)) {
      const share = alphaPct(v[c]);
      if (share) out[m[3]] = share;
    }
  }
  return out;
}

type Verdict = 'exact' | 'near' | 'override';
function judge(derived: string | null, actual: string, backdrop: Rgba): Verdict {
  if (derived === null) return 'override';
  if (renderAlike(derived, actual)) return 'exact';
  const a = parseColor(derived);
  const b = parseColor(actual);
  if (a && b && deltaEOK(a, b, backdrop) <= NEAR) return 'near';
  return 'override';
}

interface Row {
  theme: string;
  set: number;
  exact: number;
  near: number;
  override: number;
}
function measure(family: Family): { rows: Row[]; misses: string[] } {
  const rows: Row[] = [];
  const misses: string[] = [];
  for (const t of THEMES) {
    const row: Row = { theme: t, set: 0, exact: 0, near: 0, override: 0 };
    for (const mode of MODES) {
      const v = fixtures[t][mode];
      const backdrop = parseColor(v['--theme-background'] ?? 'white') ?? { r: 1, g: 1, b: 1, a: 1 };
      const anchored = anchors(family, v, mode);
      const lookup = (n: string) => anchored[n] ?? v[n];
      for (const c of family.components) {
        if (!setBy[t].has(c)) continue;
        const formula = family.formulas?.[c] ?? valueFor(getThemeToken(c)!, mode);
        const verdict = judge(substituteVars(formula, lookup), v[c], backdrop);
        row.set++;
        row[verdict]++;
        if (verdict === 'override' && misses.length < 400) misses.push(`${t}.${mode} ${c}`);
      }
    }
    rows.push(row);
  }
  return { rows, misses };
}

function table(title: string, rows: Row[]): string {
  const total = rows.reduce((a, r) => ({ theme: 'all six', set: a.set + r.set, exact: a.exact + r.exact, near: a.near + r.near, override: a.override + r.override }), { theme: '', set: 0, exact: 0, near: 0, override: 0 });
  const pct = (r: Row) => (r.set ? `${Math.round(((r.exact + r.near) / r.set) * 100)}%` : '—');
  const line = (r: Row) => `| ${r.theme} | ${r.set} | ${r.exact} | ${r.near} | ${r.override} | ${pct(r)} |`;
  return [`**${title}**`, '', '| Theme | Values set (light + dark) | Exact | Near | Override | Reproduced |', '|---|---|---|---|---|---|', ...rows.map(line), line(total), ''].join('\n');
}

const componentsReferencing = (prefix: string) =>
  THEME_TOKENS.filter((t) => t.tier === 'component' && [t.default, t.defaultDark ?? ''].some((v) => v.includes(`var(${prefix}`))).map((t) => t.name);

const families: Array<{ family: Family; alternative?: Family; note?: string }> = [];

{
  const components = componentsReferencing('--theme-category-');
  const alternativeFormulas: Record<string, string> = {};
  for (const c of components.filter((c) => c.endsWith('-fg'))) {
    alternativeFormulas[c] = valueFor(getThemeToken(c)!, 'light').replace('-foreground)', ')');
  }
  families.push({
    family: { id: 'category', title: 'Category palette — registry: colour + foreground per category, one tint', components },
    alternative: { id: 'category-alt', title: 'Alternative — one colour per category (text = the category colour itself)', components, formulas: alternativeFormulas },
  });
}
{
  const components = componentsReferencing('--theme-status-');
  const action: Record<string, string> = { success: '--theme-success', warning: '--theme-warning', danger: '--theme-destructive', info: '--theme-info' };
  const fixed: Family['fixed'] = {};
  for (const [status, actionName] of Object.entries(action)) fixed[`--theme-status-${status}`] = (v) => v[actionName];
  families.push({
    family: { id: 'status', title: 'Status (alerts) — registry: alert colour + foreground per status, fill and edge strengths', components },
    alternative: { id: 'status-alt', title: 'Alternative — alert colour taken from the action colour (--theme-success, …)', components, fixed },
  });
}
families.push({
  family: {
    id: 'chat',
    title: 'Chat surfaces — registry: assistant surface/text, a Staff accent, and an accent + label per message kind',
    components: componentsReferencing('--theme-chat-').filter((c) => c !== '--qt-chat-user-bg' && c !== '--qt-chat-user-fg'),
    fixed: { '--theme-chat-system': (v) => v['--theme-muted'] },
  },
});
families.push({
  family: { id: 'roleplay', title: 'Roleplay text — registry: surface + text per annotation, colour + foreground per chip', components: componentsReferencing('--theme-roleplay-') },
  alternative: {
    id: 'roleplay-alt',
    title: 'Alternative — dialogue text from the page text colour (--theme-foreground)',
    components: ['--qt-rp-dialogue-color'],
    fixed: { '--theme-roleplay-dialogue-foreground': (v) => v['--theme-foreground'] },
  },
  note: 'one-to-one',
});
families.push({
  family: { id: 'terminal', title: 'Terminal — registry: one semantic token per terminal colour', components: componentsReferencing('--theme-terminal-') },
  note: 'one-to-one',
});
families.push({
  family: { id: 'overlay', title: 'Overlay — registry: scrim colour at fixed shares, scrim strength, text on the scrim', components: componentsReferencing('--theme-scrim') },
});
const solidHovers = componentsReferencing('--theme-hover-shade');
families.push({
  alternative: {
    id: 'interaction-alt',
    title: 'Alternative — one hover share for every solid fill, read from the theme\'s success-button hover',
    components: solidHovers,
    formulas: Object.fromEntries(solidHovers.map((c) => [c, valueFor(getThemeToken(c)!, 'light').replace(/ \d+%, var\(--theme-hover-shade\)\)$/, ' var(--alt-hover-share), var(--theme-hover-shade))')])),
    fixed: {
      '--theme-hover-shade': () => 'black',
      '--alt-hover-share': (v) => /(\d+(?:\.\d+)?)%, black\)$/.exec(v['--qt-button-success-hover-bg'] ?? '')?.[1]?.concat('%'),
    },
  },
  family: {
    id: 'interaction',
    title: 'Interaction states — registry: solid fills mix toward the shade (black), quiet surfaces take in the tint (page text), per-component shares',
    components: componentsReferencing('--theme-hover-'),
    fixed: { '--theme-hover-shade': () => 'black', '--theme-hover-tint': (v) => v['--theme-foreground'] },
  },
});

// ---------------------------------------------------------------- 2.3 features: the themes' hand-written rules
interface Feature {
  id: string;
  title: string;
  /** Does this rule belong to the feature? */
  matches: (selector: string, props: string[]) => boolean;
  /** Is this declaration expressible by the feature's tokens? */
  expressible: (selector: string, prop: string, value: string) => boolean;
  /** Which of a matching rule's declarations belong to the feature (default: all). */
  relevant?: (selector: string, prop: string) => boolean;
}
const root = (s: string) => /^\[data-theme="[\w-]+"\](\.(dark|light))?$/.test(s.trim());
const FEATURES: Feature[] = [
  {
    id: 'selection',
    title: 'Text selection',
    matches: (s) => s.includes('::selection'),
    expressible: (_s, p) => ['background', 'background-color', 'color'].includes(p),
  },
  {
    id: 'scrollbar',
    title: 'Scrollbar',
    matches: (s, props) => s.includes('::-webkit-scrollbar') || (s.split(',').every(root) && props.some((p) => p.startsWith('scrollbar-'))),
    relevant: (s, p) => s.includes('::-webkit-scrollbar') || p.startsWith('scrollbar-'),
    expressible: (s, p) =>
      p === 'scrollbar-width' || p === 'scrollbar-color' ||
      (s.includes('::-webkit-scrollbar-thumb') && ['background', 'background-color', 'border-radius'].includes(p)) ||
      (s.includes('::-webkit-scrollbar-track') && ['background', 'background-color'].includes(p)) ||
      (/::-webkit-scrollbar\s*$/.test(s.split(',')[0]) && ['width', 'height'].includes(p)),
  },
  {
    id: 'focus',
    title: 'Focus ring',
    matches: (s) => s.includes(':focus-visible') && !/\.qt-|textarea|input|button/.test(s),
    expressible: (_s, p, v) => (p === 'outline' && /\bsolid\b/.test(v)) || ['outline-color', 'outline-width', 'outline-offset', 'box-shadow'].includes(p) || (p === 'outline-style' && v === 'solid'),
  },
  {
    id: 'headings',
    title: 'Headings',
    matches: (s) => /(^|[\s,])h[1-6]\b/.test(s) || s.includes('qt-heading'),
    expressible: (_s, p) => ['font-family', 'letter-spacing', 'text-transform', 'font-weight', 'color'].includes(p),
  },
  {
    id: 'button-text',
    title: 'Button text',
    matches: (s) => /(^|[\s,])button\b|\.qt-button\b/.test(s) && !/:hover|:focus|::|\.qt-button-/.test(s),
    expressible: (_s, p) => ['letter-spacing', 'text-transform'].includes(p),
  },
  {
    id: 'form-radius',
    title: 'Form control radius',
    matches: (s) => /(^|[\s,])(input|textarea|select)\b/.test(s) && !/:focus|::/.test(s),
    expressible: (_s, p) => p === 'border-radius',
  },
  {
    id: 'borders',
    title: 'Card and dialog border',
    matches: (s) => s.includes('[class*="card"]') || s.includes('[class*="Card"]') || s.includes('[role="dialog"]'),
    expressible: (s, p, v) => (s.includes('dialog') ? (p === 'border' && /\bsolid\b/.test(v)) || ['border-color', 'border-width'].includes(p) : p === 'border-color'),
  },
  {
    id: 'color-scheme',
    title: 'Colour scheme',
    matches: (s, props) => s.split(',').every(root) && props.includes('color-scheme'),
    relevant: (_s, p) => p === 'color-scheme',
    expressible: (_s, p) => p === 'color-scheme',
  },
  {
    id: 'page-background',
    title: 'Page background (image on body, transparent surfaces, story-background undo)',
    matches: (s) =>
      /(^|\s)body\b/.test(s) ||
      /\.(bg-background|qt-app-layout|qt-app-main|qt-page|qt-page-with-navbar|qt-content|qt-content-scroll|qt-auth-page|qt-page-container)\s*$/.test(s.split(',')[0]),
    relevant: (s, p) => !/(^|\s)body\b/.test(s) || p.startsWith('background') || p === 'position' || p === 'min-height',
    expressible: (s, p) => (/body\s*$/.test(s.split(',')[0]) && p.startsWith('background')) || p === 'background' || p === 'background-color',
  },
];

function featureRows(feature: Feature): Array<{ theme: string; rules: number; decls: number; expressible: number }> {
  return THEMES.map((t) => {
    const css = readFileSync(path.join(ROOT, `themes/bundled/${t}/styles.css`), 'utf8');
    let rules = 0;
    let decls = 0;
    let expressible = 0;
    postcss.parse(css).walkRules((rule: Rule) => {
      if (rule.parent?.type === 'atrule' && (rule.parent as { name?: string }).name === 'keyframes') return;
      const props: string[] = [];
      rule.each((n) => {
        if (n.type === 'decl' && !n.prop.startsWith('--')) props.push(n.prop);
      });
      if (props.length === 0 || !feature.matches(rule.selector, props)) return;
      const relevant = (p: string) => feature.relevant?.(rule.selector, p) ?? true;
      if (!props.some(relevant)) return;
      rules++;
      rule.each((n) => {
        if (n.type !== 'decl' || n.prop.startsWith('--') || !relevant(n.prop)) return;
        decls++;
        if (feature.expressible(rule.selector, n.prop, n.value)) expressible++;
      });
    });
    return { theme: t, rules, decls, expressible };
  });
}

// ---------------------------------------------------------------- output
const out: string[] = [];
out.push(`<!-- Generated by scripts/theme-fit-report.ts; near = ΔE_OK ≤ ${NEAR} over the theme background. -->`, '');
for (const { family, alternative, note } of families) {
  out.push(`### ${family.id}`, '');
  out.push(`Semantic tokens: ${semanticOf(family.components).length}. Component tokens measured: ${family.components.length}.${note === 'one-to-one' ? ' Each component reads its own semantic token, so the fit is complete by construction.' : ''}`, '');
  const { rows, misses } = measure(family);
  out.push(table(family.title, rows));
  if (misses.length) {
    const byToken = new Map<string, number>();
    for (const m of misses) {
      const name = m.split(' ')[1];
      byToken.set(name, (byToken.get(name) ?? 0) + 1);
    }
    out.push(`Overrides by token: ${[...byToken.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `\`${n}\` ${c}`).join(', ')}`, '');
  }
  if (alternative) out.push(table(alternative.title, measure(alternative).rows));
}
out.push('### 2.3 features — the themes\' hand-written rules', '');
for (const feature of FEATURES) {
  const rows = featureRows(feature);
  const tot = rows.reduce((a, r) => ({ rules: a.rules + r.rules, decls: a.decls + r.decls, expressible: a.expressible + r.expressible }), { rules: 0, decls: 0, expressible: 0 });
  out.push(`**${feature.title}**`, '', '| Theme | Rules | Declarations | Expressible by the new tokens |', '|---|---|---|---|');
  for (const r of rows) out.push(`| ${r.theme} | ${r.rules} | ${r.decls} | ${r.expressible} |`);
  out.push(`| all six | ${tot.rules} | ${tot.decls} | ${tot.expressible}${tot.decls ? ` (${Math.round((tot.expressible / tot.decls) * 100)}%)` : ''} |`, '');
}
process.stdout.write(out.join('\n'));
