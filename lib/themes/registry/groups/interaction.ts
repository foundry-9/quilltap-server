/**
 * Theme token registry — Interaction states (semantic tier).
 *
 * Generated into app/styles/_theme-defaults.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const INTERACTION_TOKENS: readonly TokenDef[] = [
  {
    name: "--theme-hover-shade",
    tier: 'semantic',
    type: 'color',
    group: 'interaction',
    label: "Hover shade",
    description: "The colour a solid fill mixes toward on hover. Black darkens; a dark theme may prefer white.",
    default: "black",
    visibility: 'standard',
  },
  {
    name: "--theme-hover-tint",
    tier: 'semantic',
    type: 'color',
    group: 'interaction',
    label: "Hover tint",
    description: "The colour a quiet surface takes a little of on hover.",
    default: "var(--theme-foreground)",
    visibility: 'standard',
  },
];
