/**
 * Theme token registry — Avatar.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const AVATAR_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-avatar-radius",
    tier: 'component',
    type: 'radius',
    group: 'avatar',
    label: "Avatar radius",
    default: "9999px",
    visibility: 'standard',
  },
  {
    name: "--qt-avatar-size",
    tier: 'component',
    type: 'length',
    group: 'avatar',
    label: "Avatar size",
    default: "2.25rem",
    byChoice: {"density":{"comfortable":"2.5rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-avatar-size-sm",
    tier: 'component',
    type: 'length',
    group: 'avatar',
    label: "Avatar size small",
    default: "1.75rem",
    byChoice: {"density":{"comfortable":"2rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-avatar-size-lg",
    tier: 'component',
    type: 'length',
    group: 'avatar',
    label: "Avatar size large",
    default: "2.75rem",
    byChoice: {"density":{"comfortable":"3rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-avatar-size-xl",
    tier: 'component',
    type: 'length',
    group: 'avatar',
    label: "Avatar size extra large",
    default: "3.5rem",
    byChoice: {"density":{"comfortable":"4rem"}},
    visibility: 'standard',
  },
  {
    name: "--qt-avatar-bg",
    tier: 'component',
    type: 'color',
    group: 'avatar',
    label: "Avatar background",
    default: "var(--color-muted)",
    visibility: 'advanced',
  },
  {
    name: "--qt-avatar-fg",
    tier: 'component',
    type: 'color',
    group: 'avatar',
    label: "Avatar text colour",
    default: "var(--color-muted-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-avatar-border",
    tier: 'component',
    type: 'color',
    group: 'avatar',
    label: "Avatar border",
    default: "var(--color-border)",
    visibility: 'standard',
  },
];
