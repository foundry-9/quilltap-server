/**
 * Theme token registry — Overlay.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const OVERLAY_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-overlay-bg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay background",
    default: "color-mix(in srgb, var(--theme-scrim) var(--theme-scrim-strength), transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-medium-bg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay medium background",
    default: "color-mix(in srgb, var(--theme-scrim) 60%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-light-bg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay light background",
    default: "color-mix(in srgb, var(--theme-scrim) 20%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-caption-bg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay caption background",
    default: "color-mix(in srgb, var(--theme-scrim) 50%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-btn-bg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay button background",
    default: "color-mix(in srgb, var(--theme-scrim-foreground) 10%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-btn-hover-bg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay button hover background",
    default: "color-mix(in srgb, var(--theme-scrim-foreground) 20%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-fg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay text colour",
    default: "var(--theme-scrim-foreground)",
    visibility: 'standard',
  },
  {
    name: "--qt-overlay-muted-fg",
    tier: 'component',
    type: 'color',
    group: 'overlay',
    label: "Overlay muted text colour",
    default: "color-mix(in srgb, var(--theme-scrim-foreground) 70%, transparent)",
    visibility: 'standard',
  },
];
