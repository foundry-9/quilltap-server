/**
 * Theme token registry — types.
 *
 * The registry is the single source of truth for every `--qt-*` and
 * `--theme-*` default the app declares. `app/styles/qt-components/_variables.css`
 * is generated from it (`npm run generate:theme-variables`). Framework-free:
 * importable by the server, the client and scripts.
 *
 * @module themes/registry/types
 */

export type TokenType =
  | 'color'
  | 'length'
  | 'radius'
  | 'shadow'
  | 'font-family'
  | 'font-weight'
  | 'font-style'
  | 'duration'
  | 'easing'
  | 'transition'
  | 'opacity'
  | 'image'
  | 'border'
  | 'blur'
  | 'z-index'
  | 'number'
  | 'keyword'
  | 'raw';

export type TokenTier = 'semantic' | 'component';

/**
 * `standard` — shown by default in a future editor (themes set it often).
 * `advanced` — behind an "advanced" disclosure (themes rarely or never set it).
 * `internal` — not for theme authors (read by nothing in the app, or app plumbing).
 */
export type TokenVisibility = 'standard' | 'advanced' | 'internal';

export interface TokenDef {
  /** The CSS custom property. */
  name: `--${string}`;
  tier: TokenTier;
  type: TokenType;
  /** Id of the group (see `TOKEN_GROUPS`) this token belongs to. */
  group: string;
  /** Plain English, for a future editor. */
  label: string;
  /**
   * Notes for authors. In the generated CSS it is written as a comment before
   * the token's declaration in the shared block.
   */
  description?: string;
  /** Notes about the dark value; written before its declaration in the dark block. */
  descriptionDark?: string;
  /** CSS value; may reference other tokens with `var()`. */
  default: string;
  /** Only when the dark value differs from `default`. */
  defaultDark?: string;
  /**
   * An optional hook: the registry lists it but the generated CSS does not
   * declare it. Each place the app reads it writes `var(<name>, <fallback>)`
   * with what that place did before the hook existed, so leaving it unset
   * changes nothing — the way to add a knob whose "unset" behaviour differs
   * per call site (a heading weight that is bold on one level and semibold on
   * the next) or cannot be written as a value. `default` then records what an
   * editor shows for "unset", and `description` says where it is read.
   */
  optional?: true;
  /**
   * Values for a choice's non-default options (see ./choices.ts), e.g.
   * `{ density: { comfortable: '1.5rem' } }`. Written as
   * `[data-theme][data-qt-density="comfortable"] { … }`, which a theme's own
   * value (same specificity, injected later) still overrides.
   */
  byChoice?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  visibility: TokenVisibility;
}

/**
 * Which generated stylesheet a group is written to.
 * `theme-defaults` — app/styles/_theme-defaults.css, `:root` and `.dark`
 *   (specificity 0,1,0, so a version 1 theme's injected `:root` / `.dark` wins);
 * `variables` — app/styles/qt-components/_variables.css, `:root, [data-theme], …`
 *   (0,2,0).
 */
export type TokenSheet = 'theme-defaults' | 'variables';

export interface TokenGroupDef {
  /** Kebab-case id, matching every member's `group`. */
  id: string;
  /** Generated stylesheet; `variables` when absent. */
  sheet?: TokenSheet;
  /** Plain-English heading. */
  label: string;
  /** The section's notes, written under its heading in the generated CSS. */
  description?: string;
  tokens: readonly TokenDef[];
}
