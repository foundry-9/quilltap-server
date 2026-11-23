/**
 * Theme token registry — Font stacks (semantic tier).
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const FONTS_TOKENS: readonly TokenDef[] = [
  {
    name: "--theme-font-sans",
    tier: 'semantic',
    type: 'font-family',
    group: 'fonts',
    label: "Font sans",
    default: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    visibility: 'standard',
  },
  {
    name: "--theme-font-serif",
    tier: 'semantic',
    type: 'font-family',
    group: 'fonts',
    label: "Font serif",
    default: "Georgia, Cambria, \"Times New Roman\", Times, serif",
    visibility: 'standard',
  },
  {
    name: "--theme-font-mono",
    tier: 'semantic',
    type: 'font-family',
    group: 'fonts',
    label: "Font mono",
    default: "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
    visibility: 'standard',
  },
  {
    name: "--theme-font-brand",
    tier: 'semantic',
    type: 'font-family',
    group: 'fonts',
    label: "Font brand",
    default: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    visibility: 'standard',
  },
  {
    name: "--theme-font-chat-user",
    tier: 'semantic',
    type: 'font-family',
    group: 'fonts',
    label: "Font chat user",
    default: "var(--theme-font-sans)",
    visibility: 'standard',
  },
];
