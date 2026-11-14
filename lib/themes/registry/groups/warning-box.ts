/**
 * Theme token registry — Warning box.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const WARNING_BOX_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-warning-box-bg",
    tier: 'component',
    type: 'color',
    group: 'warning-box',
    label: "Warning box background",
    default: "color-mix(in srgb, var(--color-warning) 8%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-warning-box-border",
    tier: 'component',
    type: 'color',
    group: 'warning-box',
    label: "Warning box border",
    default: "color-mix(in srgb, var(--color-warning) 30%, transparent)",
    visibility: 'standard',
  },
  {
    name: "--qt-warning-box-fg",
    tier: 'component',
    type: 'color',
    group: 'warning-box',
    label: "Warning box text colour",
    default: "var(--color-warning)",
    visibility: 'standard',
  },
];
