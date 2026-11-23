/**
 * Theme token registry — App header.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const APP_HEADER_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-app-header-height",
    tier: 'component',
    type: 'length',
    group: 'app-header',
    label: "App header height",
    default: "3.5rem",
    byChoice: {"density":{"comfortable":"4rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-app-header-bg",
    tier: 'component',
    type: 'color',
    group: 'app-header',
    label: "App header background",
    default: "var(--color-background)",
    visibility: 'advanced',
  },
  {
    name: "--qt-app-header-border",
    tier: 'component',
    type: 'color',
    group: 'app-header',
    label: "App header border",
    default: "var(--color-border)",
    visibility: 'advanced',
  },
  {
    name: "--qt-app-header-blur",
    tier: 'component',
    type: 'blur',
    group: 'app-header',
    label: "App header blur",
    default: "blur(12px)",
    visibility: 'standard',
  },
];
