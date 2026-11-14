/**
 * Theme token registry — Range (slider).
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const RANGE_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-range-accent",
    tier: 'component',
    type: 'color',
    group: 'range',
    label: "Range accent",
    default: "var(--color-primary)",
    visibility: 'advanced',
  },
  {
    name: "--qt-range-focus-ring",
    tier: 'component',
    type: 'color',
    group: 'range',
    label: "Range focus ring",
    default: "var(--color-ring)",
    visibility: 'advanced',
  },
];
