/**
 * Canonical Quilltap icon registry — the single source of truth.
 *
 * Every entry here simultaneously:
 *   1. extends the {@link IconName} union (via `keyof typeof ICON_REGISTRY`),
 *   2. declares the bundled default asset + render mode, and
 *   3. is the contract a `.qtap-theme` bundle targets when overriding an icon.
 *
 * Default monochrome icons live at `/images/icons/<name>.svg` and render as a
 * CSS `mask-image` tinted by `currentColor` (so they inherit the theme
 * foreground exactly like the old inline `stroke="currentColor"` SVGs did).
 * The lone `image`-mode default is `brand` — the full-colour quill at
 * `/quill.svg`, painted as a `background-image` with no tint.
 *
 * Theme bundles may replace any of these by name via the manifest `icons` map
 * (see `QtapThemeManifestSchema` in `lib/themes/types.ts`). An SVG override
 * keeps `currentColor` tinting (mask mode); a WebP override is pre-coloured
 * (image mode). The override format is resolved by extension at injection time
 * (see `generateIconOverridesCSS` in `lib/themes/utils.ts`).
 *
 * IMPORTANT: the icon NAME is a permanent public contract. Renaming an icon
 * after themes ship overrides for it is a breaking change. Add freely; rename
 * with care. When you add an entry, also drop the matching default asset into
 * `public/images/icons/` and regenerate the default CSS:
 *   `npm run generate:icon-css`
 *
 * @module components/ui/icons/icon-registry
 */

/** How an icon's glyph is painted. */
export type IconMode = 'mask' | 'image';

export interface IconDefinition {
  /** Public URL of the bundled default asset (served statically from /public). */
  defaultFile: string;
  /**
   * Default render mode.
   *   - `mask`  — monochrome SVG masked + tinted with `currentColor`.
   *   - `image` — full-colour asset painted as a background-image (no tint).
   */
  defaultMode: IconMode;
  /** Optional default accessible label. Most icons sit beside text and are decorative. */
  ariaLabel?: string;
}

/**
 * The canonical icon set. Keys are kebab-case and double as the theme-override
 * contract. `as const satisfies` keeps the literal keys for the {@link IconName}
 * union while type-checking each value against {@link IconDefinition}.
 *
 * NOTE: this is the initial set covering the shared icons + the left-sidebar
 * pilot. The full deduped catalogue (and the old→new consolidation mapping) is
 * tracked in `docs/developer/ICON_INVENTORY.md`; the app-wide migration extends
 * this list once the name contract is signed off.
 */
export const ICON_REGISTRY = {
  // --- shared general-purpose UI ---
  'close':        { defaultFile: '/images/icons/close.svg',        defaultMode: 'mask' },
  'pencil':       { defaultFile: '/images/icons/pencil.svg',       defaultMode: 'mask' },
  'refresh':      { defaultFile: '/images/icons/refresh.svg',      defaultMode: 'mask' },
  'check':        { defaultFile: '/images/icons/check.svg',        defaultMode: 'mask' },
  'chat':         { defaultFile: '/images/icons/chat.svg',         defaultMode: 'mask' },
  'chevron-down': { defaultFile: '/images/icons/chevron-down.svg', defaultMode: 'mask' },
  'info':         { defaultFile: '/images/icons/info.svg',         defaultMode: 'mask' },

  // --- left-sidebar primary navigation ---
  'projects':     { defaultFile: '/images/icons/projects.svg',     defaultMode: 'mask' },
  'files':        { defaultFile: '/images/icons/files.svg',        defaultMode: 'mask' },
  'characters':   { defaultFile: '/images/icons/characters.svg',   defaultMode: 'mask' },
  'scriptorium':  { defaultFile: '/images/icons/scriptorium.svg',  defaultMode: 'mask' },
  'photos':       { defaultFile: '/images/icons/photos.svg',       defaultMode: 'mask' },
  'scenarios':    { defaultFile: '/images/icons/scenarios.svg',    defaultMode: 'mask' },

  // --- left-sidebar footer + profile ---
  'settings':     { defaultFile: '/images/icons/settings.svg',     defaultMode: 'mask' },
  'themes':       { defaultFile: '/images/icons/themes.svg',       defaultMode: 'mask' },
  'wardrobe':     { defaultFile: '/images/icons/wardrobe.svg',     defaultMode: 'mask' },
  'help':         { defaultFile: '/images/icons/help.svg',         defaultMode: 'mask' },
  'profile':      { defaultFile: '/images/icons/profile.svg',      defaultMode: 'mask' },

  // --- brand mark (special: full-colour, image mode, still overridable) ---
  'brand':        { defaultFile: '/quill.svg', defaultMode: 'image', ariaLabel: 'Quilltap' },
} as const satisfies Record<string, IconDefinition>;

/** Union of every canonical icon name — derived from {@link ICON_REGISTRY}. */
export type IconName = keyof typeof ICON_REGISTRY;

/** Every canonical icon name as a runtime array (e.g. for storybook / soft validation). */
export const ICON_NAMES = Object.keys(ICON_REGISTRY) as IconName[];

/** Type guard: is `name` a known canonical icon? */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICON_REGISTRY, name);
}
