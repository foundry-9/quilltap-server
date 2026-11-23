/**
 * Theme token registry — Overlay scrim (semantic tier).
 *
 * Generated into app/styles/_theme-defaults.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const OVERLAY_SCRIM_TOKENS: readonly TokenDef[] = [
  {
    name: "--theme-scrim",
    tier: 'semantic',
    type: 'color',
    group: 'overlay-scrim',
    label: "Scrim colour",
    default: "rgb(0 0 0)",
    visibility: 'standard',
  },
  {
    name: "--theme-scrim-strength",
    tier: 'semantic',
    type: 'opacity',
    group: 'overlay-scrim',
    label: "Scrim strength",
    description: "How opaque the full-screen overlay is. Lighter overlays (captions, dialog backdrop) use fixed shares of the scrim colour.",
    default: "85%",
    visibility: 'standard',
  },
  {
    name: "--theme-scrim-foreground",
    tier: 'semantic',
    type: 'color',
    group: 'overlay-scrim',
    label: "Text on the scrim",
    default: "rgb(255 255 255)",
    visibility: 'standard',
  },
];
