/**
 * Theme engine — the boundary a theme's rules stop at.
 *
 * A theme's tokens are declared on the element that carries
 * `data-theme="<id>"`, so a nested element wearing another theme
 * re-declares them and nothing leaks. Rules that style descendants (custom
 * CSS, icon overrides) are different: `[data-theme="<id>"] X` matches every
 * X below the root, inside a nested theme too. Calliope's Atelier is such a
 * nest — a panel in the house default inside an app wearing the draft — and
 * so is any future one.
 *
 * Every descendant rule therefore sits in a donut scope: rooted at the
 * theme's element, stopping at (and excluding) any element that wears a
 * different theme. Inside it, `:scope` stands where the `[data-theme]`
 * prefix stood; both are one attribute/pseudo-class, so specificity is
 * unchanged.
 *
 * Pure: no PostCSS, no DOM. Safe for the client.
 *
 * @module themes/engine/boundary
 */

/** The `@scope` prelude (without `@scope`) for a theme's descendant rules. */
export function themeScopePrelude(id: string): string {
  return `([data-theme="${id}"]) to ([data-theme]:not([data-theme="${id}"]))`;
}

/** Wrap already `:scope`-relative rules in the theme's boundary. */
export function wrapInThemeScope(id: string, rules: string): string {
  return `@scope ${themeScopePrelude(id)} {\n${rules}\n}`;
}
