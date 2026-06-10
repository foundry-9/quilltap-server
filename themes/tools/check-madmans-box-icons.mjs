#!/usr/bin/env node
/**
 * Madman's Box icon contract lint (dev tooling, not shipped).
 *
 * Mechanically enforces the SVG technical contract from
 * docs/developer/features/madmans-box-icon-redesign.md §3 over every override
 * in themes/bundled/madmans-box/icons/, cross-checks filenames against the
 * canonical registry (components/ui/icons/icon-registry.ts), verifies the
 * contact sheet's name list matches the registry, and reports coverage.
 *
 * Usage: node themes/tools/check-madmans-box-icons.mjs
 * Exit codes: 0 = clean (warnings allowed), 1 = contract violations.
 *
 * What it cannot check: register purity, semantic anchors, optical centering,
 * and the four litmus tests — those belong to the contact-sheet review.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICONS_DIR = join(repoRoot, 'themes', 'bundled', 'madmans-box', 'icons');
const REGISTRY = join(repoRoot, 'components', 'ui', 'icons', 'icon-registry.ts');
const PREVIEW = join(repoRoot, 'themes', 'tools', 'madmans-box-icon-preview.html');

// ---------------------------------------------------------------- registry --
const registrySource = readFileSync(REGISTRY, 'utf8');
const registryBody = registrySource.match(/ICON_REGISTRY = \{([\s\S]*?)\} as const/);
if (!registryBody) {
  console.error('FATAL: could not locate ICON_REGISTRY in icon-registry.ts');
  process.exit(1);
}
const canonical = [...registryBody[1].matchAll(/^\s*'([a-z][a-z0-9-]*)':/gm)].map((m) => m[1]);
if (canonical.length === 0) {
  console.error('FATAL: parsed zero names from ICON_REGISTRY');
  process.exit(1);
}

// ------------------------------------------------------- preview name sync --
const errors = [];
const warnings = [];

if (existsSync(PREVIEW)) {
  const previewSource = readFileSync(PREVIEW, 'utf8');
  const arrayBody = previewSource.match(/const ICONS = \[([\s\S]*?)\];/);
  const previewNames = arrayBody
    ? [...arrayBody[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1])
    : [];
  const missingFromPreview = canonical.filter((n) => !previewNames.includes(n));
  const extraInPreview = previewNames.filter((n) => !canonical.includes(n));
  if (missingFromPreview.length) {
    errors.push(`preview.html ICONS array is missing: ${missingFromPreview.join(', ')}`);
  }
  if (extraInPreview.length) {
    errors.push(`preview.html ICONS array has unknown names: ${extraInPreview.join(', ')}`);
  }
} else {
  warnings.push('contact sheet (madmans-box-icon-preview.html) not found — skipping sync check');
}

// ------------------------------------------------------------ per-file lint --
const ROOT_REQUIRED = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
};
const FORBIDDEN = [
  [/<text[\s>]/, '<text> element'],
  [/<(linearGradient|radialGradient)[\s>]/, 'gradient'],
  [/<filter[\s>]/, '<filter> element'],
  [/<image[\s>]/, '<image> element'],
  [/<style[\s>]/, '<style> element'],
  [/<script[\s>]/, '<script> element'],
];
const MIN_STROKE = 1.25;
const MAX_STROKE = 2.0;

const files = existsSync(ICONS_DIR)
  ? readdirSync(ICONS_DIR).filter((f) => f.endsWith('.svg')).sort()
  : [];

for (const file of files) {
  const name = file.replace(/\.svg$/, '');
  const fail = (msg) => errors.push(`${file}: ${msg}`);
  const warn = (msg) => warnings.push(`${file}: ${msg}`);

  if (!canonical.includes(name)) {
    fail('filename is not a canonical registry icon name');
  }

  const svg = readFileSync(join(ICONS_DIR, file), 'utf8');
  const rootMatch = svg.match(/<svg\b([^>]*)>/);
  if (!rootMatch) {
    fail('no <svg> root element');
    continue;
  }
  const rootAttrs = {};
  for (const m of rootMatch[1].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
    rootAttrs[m[1]] = m[2];
  }

  for (const [attr, expected] of Object.entries(ROOT_REQUIRED)) {
    if (rootAttrs[attr] !== expected) {
      fail(`root ${attr}="${rootAttrs[attr] ?? '(absent)'}" — must be "${expected}"`);
    }
  }
  if (!rootAttrs.xmlns) fail('root missing xmlns');
  if ('transform' in rootAttrs) fail('root must not carry a transform');

  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(svg)) fail(`forbidden content: ${label}`);
  }

  // Element-level paint: only currentColor / none anywhere (no baked colour).
  for (const m of svg.matchAll(/(fill|stroke)="([^"]*)"/g)) {
    const [, attr, value] = m;
    if (value !== 'none' && value !== 'currentColor') {
      fail(`${attr}="${value}" — only "currentColor" or "none" allowed (no baked colour)`);
    }
  }

  // Sharpness: rx must not exceed 1; no element-level round caps/joins.
  for (const m of svg.matchAll(/\brx="([^"]*)"/g)) {
    if (parseFloat(m[1]) > 1) fail(`rx="${m[1]}" — must be <= 1`);
  }
  for (const m of svg.matchAll(/stroke-linecap="([^"]*)"/g)) {
    if (m[1] !== 'butt') fail(`stroke-linecap="${m[1]}" — must be "butt"`);
  }
  for (const m of svg.matchAll(/stroke-linejoin="([^"]*)"/g)) {
    if (m[1] !== 'miter') fail(`stroke-linejoin="${m[1]}" — must be "miter"`);
  }

  // Two-weight rule: every stroke-width in [1.25, 2.0].
  for (const m of svg.matchAll(/stroke-width="([^"]*)"/g)) {
    const w = parseFloat(m[1]);
    if (Number.isNaN(w) || w < MIN_STROKE || w > MAX_STROKE) {
      fail(`stroke-width="${m[1]}" — must be within [${MIN_STROKE}, ${MAX_STROKE}]`);
    }
  }

  // Engraving trick: partial alpha is deliberate and stays in the 0.5–0.7 band.
  for (const m of svg.matchAll(/stroke-opacity="([^"]*)"/g)) {
    const o = parseFloat(m[1]);
    if (Number.isNaN(o) || o <= 0 || o >= 1) {
      fail(`stroke-opacity="${m[1]}" — must be a partial alpha in (0, 1)`);
    } else if (o < 0.5 || o > 0.7) {
      warn(`stroke-opacity="${m[1]}" — outside the 0.5–0.7 engraving band`);
    }
  }
}

// ---------------------------------------------------------------- coverage --
const drawn = files.map((f) => f.replace(/\.svg$/, ''));
const remaining = canonical.filter((n) => !drawn.includes(n));

console.log(`registry: ${canonical.length} canonical icons`);
console.log(`drawn:    ${drawn.length}/${canonical.length}`);
if (remaining.length) {
  console.log(`missing:  ${remaining.join(', ')}`);
}
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} contract violation(s):`);
  for (const e of errors) console.log(`  FAIL  ${e}`);
  process.exit(1);
}
console.log('\ncontract: clean');
