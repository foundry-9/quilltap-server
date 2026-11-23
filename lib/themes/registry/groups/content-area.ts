/**
 * Theme token registry — Content area.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const CONTENT_AREA_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-content-bg",
    tier: 'component',
    type: 'color',
    group: 'content-area',
    label: "Content background",
    default: "var(--color-card)",
    visibility: 'advanced',
  },
  {
    name: "--qt-content-fg",
    tier: 'component',
    type: 'color',
    group: 'content-area',
    label: "Content text colour",
    default: "var(--color-card-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-content-scroll-bg",
    tier: 'component',
    type: 'color',
    group: 'content-area',
    label: "Content scroll background",
    default: "var(--color-background)",
    visibility: 'advanced',
  },
];
