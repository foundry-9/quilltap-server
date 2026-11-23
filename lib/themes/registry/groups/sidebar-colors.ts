/**
 * Theme token registry — Sidebar colours (semantic tier).
 *
 * Generated into app/styles/_theme-defaults.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const SIDEBAR_COLORS_TOKENS: readonly TokenDef[] = [
  {
    name: "--theme-sidebar-background",
    tier: 'semantic',
    type: 'color',
    group: 'sidebar-colors',
    label: "Sidebar background",
    description: "Sidebar",
    descriptionDark: "Sidebar - darker than main content",
    default: "hsl(225 14% 95%)",
    defaultDark: "hsl(225 18% 7%)",
    visibility: 'standard',
  },
  {
    name: "--theme-sidebar-foreground",
    tier: 'semantic',
    type: 'color',
    group: 'sidebar-colors',
    label: "Sidebar foreground",
    default: "hsl(225 18% 18%)",
    defaultDark: "hsl(225 10% 88%)",
    visibility: 'standard',
  },
  {
    name: "--theme-sidebar-border",
    tier: 'semantic',
    type: 'color',
    group: 'sidebar-colors',
    label: "Sidebar border",
    default: "hsl(225 10% 87%)",
    defaultDark: "hsl(225 12% 16%)",
    visibility: 'standard',
  },
  {
    name: "--theme-sidebar-muted",
    tier: 'semantic',
    type: 'color',
    group: 'sidebar-colors',
    label: "Sidebar muted",
    default: "hsl(225 8% 44.5%)",
    defaultDark: "hsl(225 8% 51%)",
    visibility: 'standard',
  },
  {
    name: "--theme-sidebar-accent",
    tier: 'semantic',
    type: 'color',
    group: 'sidebar-colors',
    label: "Sidebar accent",
    default: "hsl(225 10% 93%)",
    defaultDark: "hsl(225 14% 18%)",
    visibility: 'standard',
  },
  {
    name: "--theme-sidebar-accent-foreground",
    tier: 'semantic',
    type: 'color',
    group: 'sidebar-colors',
    label: "Sidebar accent foreground",
    default: "hsl(225 18% 22%)",
    defaultDark: "hsl(225 10% 85%)",
    visibility: 'standard',
  },
];
