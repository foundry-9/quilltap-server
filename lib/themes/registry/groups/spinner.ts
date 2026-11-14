/**
 * Theme token registry — Spinner.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const SPINNER_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-spinner-track",
    tier: 'component',
    type: 'color',
    group: 'spinner',
    label: "Spinner track",
    default: "color-mix(in srgb, var(--color-primary) 20%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-spinner-indicator",
    tier: 'component',
    type: 'color',
    group: 'spinner',
    label: "Spinner indicator",
    default: "var(--color-primary)",
    visibility: 'standard',
  },
];
