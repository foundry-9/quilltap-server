/**
 * generate-icon-css.ts
 *
 * Regenerates `app/styles/qt-components/_icons.css` from the canonical icon
 * registry (`components/ui/icons/icon-registry.ts`) — the single source of
 * truth for the default icon set.
 *
 * Run after adding, removing, or renaming an icon, or changing a default asset:
 *
 *   npm run generate:icon-css
 *
 * The output is committed and loaded as plain CSS in `<head>`; nothing
 * generates icon CSS at runtime, so there is no flash of unstyled icons.
 * Theme OVERRIDES are a separate, runtime concern handled by the theme-style
 * injector (see `generateIconOverridesCSS` in `lib/themes/utils.ts`).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_REGISTRY } from '../components/ui/icons/icon-registry';

const OUT_PATH = join(process.cwd(), 'app', 'styles', 'qt-components', '_icons.css');

const HEADER = `/**
 * Quilltap Icon System — DEFAULT icon styles.
 *
 * !!! GENERATED FILE — DO NOT EDIT BY HAND !!!
 * Source of truth: components/ui/icons/icon-registry.ts
 * Regenerate with: npm run generate:icon-css
 *
 * <Icon name="x" /> renders <span class="qt-icon" data-icon="x">. The glyph and
 * tint are pure CSS:
 *   - mask  mode: a mask-image of the default SVG, tinted by currentColor.
 *   - image mode: a full-colour background-image (the brand quill), no tint.
 *
 * The paint is driven by two derived custom properties, exactly one of which is
 * a URL: --_qt-icon-mask (mask mode) and --_qt-icon-bg (image mode). Theme
 * bundles override an icon by re-declaring its [data-icon="name"] rule in the
 * injected (UNLAYERED) theme <style> block, which beats these @layer rules and
 * wins.
 *
 * These rules live in @layer components (like every other qt- file) so the
 * .qt-icon size default loses to Tailwind w- / h- sizing utilities (@layer
 * utilities), which must drive each call site box size.
 */`;

const BASE = `
.qt-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em; /* match the optical baseline of the inline SVGs replaced */
  flex: none;               /* never shrink inside a flex row of [icon] [label] */
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

/* Shared paint mechanics. Per-icon rules below pick exactly one of the two
   derived vars (the other resolves to \`none\`), selecting mask vs image mode. */
[data-icon] {
  background-color: currentColor;
  -webkit-mask-image: var(--_qt-icon-mask, none);
  mask-image: var(--_qt-icon-mask, none);
  background-image: var(--_qt-icon-bg, none);
}
`;

function ruleFor(name: string, def: { defaultFile: string; defaultMode: string }): string {
  const url = `url("${def.defaultFile}")`;
  if (def.defaultMode === 'image') {
    // Full-colour: paint a background-image, no mask, no currentColor tint.
    return `[data-icon="${name}"] { --_qt-icon-mask: none; --_qt-icon-bg: ${url}; background-color: transparent; }`;
  }
  // Monochrome: mask the box and let currentColor show through.
  return `[data-icon="${name}"] { --_qt-icon-mask: ${url}; --_qt-icon-bg: none; }`;
}

const rules = Object.entries(ICON_REGISTRY)
  .map(([name, def]) => ruleFor(name, def))
  .join('\n');

const content = `${HEADER}\n\n@layer components {\n${BASE}\n/* ---- per-icon defaults (generated from icon-registry.ts) ---- */\n${rules}\n}\n`;

// Guard: a stray "*/" in the header/base prose closes a CSS comment early and
// breaks the whole stylesheet (e.g. writing "w-*/h-*" instead of "w- / h-").
// An unbalanced count means exactly that — fail loudly rather than emit broken CSS.
const opens = (content.match(/\/\*/g) ?? []).length;
const closes = (content.match(/\*\//g) ?? []).length;
if (opens !== closes) {
  throw new Error(
    `Refusing to write icon CSS: unbalanced comment markers (${opens} "/*" vs ${closes} "*/"). ` +
      `Check the HEADER/BASE prose for a stray "*/" sequence (e.g. "w-*/h-*").`,
  );
}

writeFileSync(OUT_PATH, content, 'utf8');
console.log(`Wrote ${Object.keys(ICON_REGISTRY).length} icon rules to ${OUT_PATH}`);
