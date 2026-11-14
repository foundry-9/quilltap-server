/**
 * Theme token registry — Auth page.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const AUTH_PAGE_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-auth-page-bg",
    tier: 'component',
    type: 'image',
    group: 'auth-page',
    label: "Auth page background",
    description: "Read by nothing in the app (no stylesheet, no TS). Kept because bundled themes still set it; removal belongs to Calliope Live Spec C.",
    default: "linear-gradient(to bottom right, hsl(225 22% 8%), hsl(225 18% 14%))",
    visibility: 'internal',
  },
  {
    name: "--qt-auth-card-bg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth card background",
    default: "var(--color-card)",
    visibility: 'advanced',
  },
  {
    name: "--qt-auth-card-fg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth card text colour",
    default: "var(--color-card-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-auth-title-fg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth title text colour",
    default: "var(--color-foreground)",
    visibility: 'standard',
  },
  {
    name: "--qt-auth-subtitle-fg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth subtitle text colour",
    default: "var(--color-muted-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-auth-label-fg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth label text colour",
    default: "var(--color-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-auth-hint-fg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth hint text colour",
    default: "var(--color-muted-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-auth-footer-fg",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth footer text colour",
    default: "var(--color-muted-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-auth-divider-color",
    tier: 'component',
    type: 'color',
    group: 'auth-page',
    label: "Auth divider color",
    default: "var(--color-border)",
    visibility: 'advanced',
  },
];
