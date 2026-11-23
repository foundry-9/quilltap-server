/**
 * Theme token registry — Highlight (search result highlighting).
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const HIGHLIGHT_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-highlight-bg",
    tier: 'component',
    type: 'color',
    group: 'highlight',
    label: "Highlight background",
    default: "hsl(48 100% 50%)",
    visibility: 'standard',
  },
  {
    name: "--qt-highlight-fg",
    tier: 'component',
    type: 'color',
    group: 'highlight',
    label: "Highlight text colour",
    default: "hsl(40 100% 10%)",
    visibility: 'standard',
  },
  {
    name: "--qt-highlight-radius",
    tier: 'component',
    type: 'radius',
    group: 'highlight',
    label: "Highlight radius",
    default: "0.125rem",
    visibility: 'advanced',
  },
  {
    name: "--qt-highlight-padding-x",
    tier: 'component',
    type: 'length',
    group: 'highlight',
    label: "Highlight horizontal padding",
    default: "0.125rem",
    visibility: 'advanced',
  },
  {
    name: "--qt-highlight-font-weight",
    tier: 'component',
    type: 'font-weight',
    group: 'highlight',
    label: "Highlight font weight",
    default: "500",
    visibility: 'advanced',
  },
];
