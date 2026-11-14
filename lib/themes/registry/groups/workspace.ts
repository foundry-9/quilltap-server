/**
 * Theme token registry — Workspace.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const WORKSPACE_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-workspace-accent",
    tier: 'component',
    type: 'color',
    group: 'workspace',
    label: "Workspace accent",
    description: "Hook: _workspace.css reads it as var(--qt-workspace-accent, var(--color-primary)); the default is that fallback.",
    default: "var(--color-primary)",
    visibility: 'standard',
  },
  {
    name: "--qt-workspace-tab-active-fg",
    tier: 'component',
    type: 'color',
    group: 'workspace',
    label: "Workspace tab active text colour",
    description: "Hook: _workspace.css reads it as var(--qt-workspace-tab-active-fg, var(--color-foreground)); the default is that fallback.",
    default: "var(--color-foreground)",
    visibility: 'advanced',
  },
];
