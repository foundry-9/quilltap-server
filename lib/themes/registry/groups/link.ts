/**
 * Theme token registry — Link.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const LINK_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-link-color",
    tier: 'component',
    type: 'color',
    group: 'link',
    label: "Link color",
    default: "var(--color-primary)",
    visibility: 'standard',
  },
  {
    name: "--qt-link-hover-color",
    tier: 'component',
    type: 'color',
    group: 'link',
    label: "Link hover color",
    default: "color-mix(in srgb, var(--color-primary) 80%, var(--theme-hover-shade))",
    visibility: 'standard',
  },
  {
    name: "--qt-link-decoration",
    tier: 'component',
    type: 'keyword',
    group: 'link',
    label: "Link decoration",
    default: "none",
    visibility: 'standard',
  },
  {
    name: "--qt-link-decoration-hover",
    tier: 'component',
    type: 'keyword',
    group: 'link',
    label: "Link decoration hover",
    default: "underline",
    visibility: 'advanced',
  },
];
