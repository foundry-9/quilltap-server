/**
 * Theme token registry — Progress bar.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const PROGRESS_BAR_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-progress-track",
    tier: 'component',
    type: 'color',
    group: 'progress-bar',
    label: "Progress track",
    default: "var(--color-muted)",
    visibility: 'advanced',
  },
  {
    name: "--qt-progress-indicator",
    tier: 'component',
    type: 'color',
    group: 'progress-bar',
    label: "Progress indicator",
    default: "var(--color-primary)",
    visibility: 'advanced',
  },
  {
    name: "--qt-progress-indicator-success",
    tier: 'component',
    type: 'color',
    group: 'progress-bar',
    label: "Progress indicator success",
    default: "var(--color-success)",
    visibility: 'advanced',
  },
  {
    name: "--qt-progress-indicator-danger",
    tier: 'component',
    type: 'color',
    group: 'progress-bar',
    label: "Progress indicator danger",
    default: "var(--color-destructive)",
    visibility: 'advanced',
  },
];
