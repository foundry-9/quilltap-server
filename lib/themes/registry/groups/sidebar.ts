/**
 * Theme token registry — Sidebar.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const SIDEBAR_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-sidebar-width",
    tier: 'component',
    type: 'length',
    group: 'sidebar',
    label: "Sidebar width",
    default: "15rem",
    visibility: 'standard',
  },
  {
    name: "--qt-sidebar-bg",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar background",
    default: "var(--color-sidebar-background)",
    visibility: 'advanced',
  },
  {
    name: "--qt-sidebar-border",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar border",
    default: "var(--color-sidebar-border)",
    visibility: 'advanced',
  },
  {
    name: "--qt-sidebar-fg",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar text colour",
    description: "Read by nothing in the app (no stylesheet, no TS). Kept because bundled themes still set it; removal belongs to Calliope Live Spec C.",
    default: "var(--color-sidebar-foreground)",
    visibility: 'internal',
  },
  {
    name: "--qt-sidebar-muted",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar muted",
    description: "Read by nothing in the app (no stylesheet, no TS). Kept because bundled themes still set it; removal belongs to Calliope Live Spec C.",
    default: "var(--color-sidebar-muted)",
    visibility: 'internal',
  },
  {
    name: "--qt-sidebar-item-padding-x",
    tier: 'component',
    type: 'length',
    group: 'sidebar',
    label: "Sidebar item horizontal padding",
    default: "0.625rem",
    visibility: 'standard',
  },
  {
    name: "--qt-sidebar-item-padding-y",
    tier: 'component',
    type: 'length',
    group: 'sidebar',
    label: "Sidebar item vertical padding",
    default: "0.375rem",
    visibility: 'standard',
  },
  {
    name: "--qt-sidebar-item-radius",
    tier: 'component',
    type: 'radius',
    group: 'sidebar',
    label: "Sidebar item radius",
    default: "var(--radius-md)",
    visibility: 'advanced',
  },
  {
    name: "--qt-sidebar-item-hover-bg",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar item hover background",
    default: "var(--color-sidebar-accent)",
    visibility: 'standard',
  },
  {
    name: "--qt-sidebar-item-active-bg",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar item active background",
    default: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-sidebar-item-active-border",
    tier: 'component',
    type: 'color',
    group: 'sidebar',
    label: "Sidebar item active border",
    default: "var(--color-primary)",
    visibility: 'standard',
  },
];
