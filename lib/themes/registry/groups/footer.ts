/**
 * Theme token registry — Footer.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const FOOTER_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-footer-bg",
    tier: 'component',
    type: 'color',
    group: 'footer',
    label: "Footer background",
    description: "Read by nothing in the app (no stylesheet, no TS). Kept because bundled themes still set it; removal belongs to Calliope Live Spec C.",
    default: "var(--color-background)",
    visibility: 'internal',
  },
  {
    name: "--qt-footer-border",
    tier: 'component',
    type: 'color',
    group: 'footer',
    label: "Footer border",
    default: "var(--color-border)",
    visibility: 'advanced',
  },
  {
    name: "--qt-footer-fg",
    tier: 'component',
    type: 'color',
    group: 'footer',
    label: "Footer text colour",
    default: "var(--color-muted-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-footer-link-hover",
    tier: 'component',
    type: 'color',
    group: 'footer',
    label: "Footer link hover",
    default: "var(--color-primary)",
    visibility: 'standard',
  },
];
