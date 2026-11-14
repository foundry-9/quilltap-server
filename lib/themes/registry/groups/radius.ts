/**
 * Theme token registry — Corner radii (semantic tier).
 *
 * Generated into app/styles/_theme-defaults.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const RADIUS_TOKENS: readonly TokenDef[] = [
  {
    name: "--theme-radius-lg",
    tier: 'semantic',
    type: 'radius',
    group: 'radius',
    label: "Radius large",
    description: "Radii - tighter for a precise look",
    default: "0.5rem",
    visibility: 'standard',
  },
  {
    name: "--theme-radius-md",
    tier: 'semantic',
    type: 'radius',
    group: 'radius',
    label: "Radius medium",
    default: "0.375rem",
    visibility: 'standard',
  },
  {
    name: "--theme-radius-sm",
    tier: 'semantic',
    type: 'radius',
    group: 'radius',
    label: "Radius small",
    default: "0.25rem",
    visibility: 'standard',
  },
  {
    name: "--theme-radius-xl",
    tier: 'semantic',
    type: 'radius',
    group: 'radius',
    label: "Radius extra large",
    description: "Emitted by a version 1 theme's tokens.json (themeTokensToCSS); nothing in the app reads it yet.",
    default: "0.625rem",
    visibility: 'internal',
  },
  {
    name: "--theme-radius-full",
    tier: 'semantic',
    type: 'radius',
    group: 'radius',
    label: "Radius full",
    description: "Emitted by a version 1 theme's tokens.json (themeTokensToCSS); nothing in the app reads it yet.",
    default: "9999px",
    visibility: 'internal',
  },
];
