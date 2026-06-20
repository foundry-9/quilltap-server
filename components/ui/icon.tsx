/**
 * Icon — the single, theme-replaceable icon primitive.
 *
 * Renders a `<span class="qt-icon" data-icon="<name>">` whose glyph and colour
 * are driven entirely by CSS (see `app/styles/qt-components/_icons.css`):
 *
 *   - Default monochrome icons are a CSS `mask-image` of
 *     `/images/icons/<name>.svg`, tinted by `background-color: currentColor` —
 *     so they inherit the surrounding text colour exactly like the inline
 *     `stroke="currentColor"` SVGs they replace.
 *   - The `brand` icon paints the full-colour quill as a `background-image`.
 *   - A `.qtap-theme` bundle can override any icon by name; the override CSS is
 *     injected into the same `<style>` block as the theme tokens, so it swaps
 *     live on theme change with no flash and no extra render.
 *
 * Because the component itself is just a deterministic `<span>` (no theme
 * context read, no client state), it is SSR-safe and never flips after
 * hydration — the default glyph is present in the server-rendered stylesheet
 * and any theme override rides the same atomic token injection.
 *
 * Sizing and colour come from `className` (Tailwind `w-5 h-5`, `text-*`, etc.),
 * matching how the old inline `<svg className="w-5 h-5">` icons were sized.
 *
 * @example
 * ```tsx
 * <Icon name="settings" className="w-5 h-5" />            // decorative
 * <Icon name="close" className="w-4 h-4" title="Close" /> // labelled
 * ```
 *
 * @module components/ui/icon
 */

import type { CSSProperties } from 'react';
import type { IconName } from '@/components/ui/icons/icon-registry';

export type { IconName };

export interface IconProps {
  /** Canonical, theme-overridable icon name (see {@link IconName}). */
  name: IconName;
  /** Tailwind sizing/colour classes, e.g. `"w-5 h-5 text-muted-foreground"`. */
  className?: string;
  /**
   * Accessible label. When provided, the icon is exposed to assistive tech as
   * `role="img"` with this label. When omitted, the icon is treated as
   * decorative (`aria-hidden`), which is correct whenever a visible text label
   * or an `aria-label` on the parent control already names the action.
   */
  title?: string;
  /** Inline style passthrough (rarely needed; sizing should prefer `className`). */
  style?: CSSProperties;
}

export function Icon({ name, className, title, style }: IconProps) {
  const decorative = !title;
  return (
    <span
      data-icon={name}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      title={title}
      className={className ? `qt-icon ${className}` : 'qt-icon'}
      style={style}
    />
  );
}
