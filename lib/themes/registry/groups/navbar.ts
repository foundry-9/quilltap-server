/**
 * Theme token registry — Navbar.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const NAVBAR_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-navbar-height",
    tier: 'component',
    type: 'length',
    group: 'navbar',
    label: "Navbar height",
    default: "3.5rem",
    byChoice: {"density":{"comfortable":"4rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-navbar-bg",
    tier: 'component',
    type: 'color',
    group: 'navbar',
    label: "Navbar background",
    default: "var(--color-background)",
    visibility: 'advanced',
  },
  {
    name: "--qt-navbar-border",
    tier: 'component',
    type: 'color',
    group: 'navbar',
    label: "Navbar border",
    default: "var(--color-border)",
    visibility: 'advanced',
  },
  {
    name: "--qt-navbar-blur",
    tier: 'component',
    type: 'blur',
    group: 'navbar',
    label: "Navbar blur",
    default: "blur(12px)",
    visibility: 'standard',
  },
  {
    name: "--qt-navbar-shadow",
    tier: 'component',
    type: 'shadow',
    group: 'navbar',
    label: "Navbar shadow",
    default: "none",
    visibility: 'advanced',
  },
  {
    name: "--qt-navbar-link-padding-x",
    tier: 'component',
    type: 'length',
    group: 'navbar',
    label: "Navbar link horizontal padding",
    default: "0.625rem",
    byChoice: {"density":{"comfortable":"0.75rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-navbar-link-padding-y",
    tier: 'component',
    type: 'length',
    group: 'navbar',
    label: "Navbar link vertical padding",
    default: "0.375rem",
    visibility: 'standard',
  },
  {
    name: "--qt-navbar-link-radius",
    tier: 'component',
    type: 'radius',
    group: 'navbar',
    label: "Navbar link radius",
    default: "var(--radius-md)",
    visibility: 'advanced',
  },
  {
    name: "--qt-navbar-link-fg",
    tier: 'component',
    type: 'color',
    group: 'navbar',
    label: "Navbar link text colour",
    default: "var(--color-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-navbar-link-hover-bg",
    tier: 'component',
    type: 'color',
    group: 'navbar',
    label: "Navbar link hover background",
    default: "var(--color-muted)",
    visibility: 'advanced',
  },
  {
    name: "--qt-navbar-link-active-bg",
    tier: 'component',
    type: 'color',
    group: 'navbar',
    label: "Navbar link active background",
    default: "var(--color-muted)",
    visibility: 'advanced',
  },
];
