/**
 * Theme token registry — Input.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const INPUT_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-input-radius",
    tier: 'component',
    type: 'radius',
    group: 'input',
    label: "Input radius",
    default: "var(--radius-md)",
    visibility: 'advanced',
  },
  {
    name: "--qt-input-padding-x",
    tier: 'component',
    type: 'length',
    group: 'input',
    label: "Input horizontal padding",
    default: "0.75rem",
    visibility: 'advanced',
  },
  {
    name: "--qt-input-padding-y",
    tier: 'component',
    type: 'length',
    group: 'input',
    label: "Input vertical padding",
    default: "0.5rem",
    visibility: 'advanced',
  },
  {
    name: "--qt-input-bg",
    tier: 'component',
    type: 'color',
    group: 'input',
    label: "Input background",
    default: "var(--color-background)",
    visibility: 'standard',
  },
  {
    name: "--qt-input-fg",
    tier: 'component',
    type: 'color',
    group: 'input',
    label: "Input text colour",
    default: "var(--color-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-input-border",
    tier: 'component',
    type: 'color',
    group: 'input',
    label: "Input border",
    default: "var(--color-input)",
    visibility: 'advanced',
  },
  {
    name: "--qt-input-focus-ring",
    tier: 'component',
    type: 'color',
    group: 'input',
    label: "Input focus ring",
    default: "var(--color-ring)",
    visibility: 'advanced',
  },
  {
    name: "--qt-input-transition",
    tier: 'component',
    type: 'transition',
    group: 'input',
    label: "Input transition",
    default: "colors 150ms cubic-bezier(0.4, 0, 0.2, 1)",
    visibility: 'advanced',
  },
  {
    name: "--qt-select-arrow",
    tier: 'component',
    type: 'image',
    group: 'input',
    label: "Select arrow",
    description: "Select dropdown arrow — a full data URI so themes can swap the whole glyph.\nDefault stroke is a neutral slate that reads on light surfaces; the dark\nbaseline below lifts it. Themes override --qt-select-arrow wholesale.",
    descriptionDark: "Select arrow — lighter slate so the glyph reads on dark surfaces",
    default: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
    defaultDark: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
    visibility: 'standard',
  },
];
