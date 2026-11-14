/**
 * Theme token registry — Typography.
 *
 * Generated into app/styles/qt-components/_variables.css by
 * `npm run generate:theme-variables`; edit here, not there.
 */

import type { TokenDef } from '../types';

export const TYPOGRAPHY_TOKENS: readonly TokenDef[] = [
  {
    name: "--qt-heading-font",
    tier: 'component',
    type: 'font-family',
    group: 'typography',
    label: "Heading font",
    default: "var(--font-sans)",
    visibility: 'standard',
  },
  {
    name: "--qt-text-secondary-fg",
    tier: 'component',
    type: 'color',
    group: 'typography',
    label: "Text secondary text colour",
    default: "var(--color-muted-foreground)",
    visibility: 'advanced',
  },
  {
    name: "--qt-heading-font-weight",
    tier: 'component',
    type: 'font-weight',
    group: 'typography',
    label: "Heading weight",
    description: "Read by the .qt-heading-* classes; unset, each level keeps its own weight (bold for .qt-heading-1, semibold for the rest).",
    default: "600",
    optional: true,
    visibility: 'standard',
  },
  {
    name: "--qt-heading-letter-spacing",
    tier: 'component',
    type: 'length',
    group: 'typography',
    label: "Heading letter spacing",
    description: "Read by the .qt-heading-* classes; unset, each level keeps its own spacing (tight for -1, -2 and -lg, normal for the rest).",
    default: "normal",
    optional: true,
    visibility: 'standard',
  },
  {
    name: "--qt-heading-text-transform",
    tier: 'component',
    type: 'keyword',
    group: 'typography',
    label: "Heading text transform",
    description: "Read by the .qt-heading-* classes; unset, each level keeps its own inherited transform.",
    default: "none",
    optional: true,
    visibility: 'standard',
  },
  {
    name: "--qt-heading-color",
    tier: 'component',
    type: 'color',
    group: 'typography',
    label: "Heading colour",
    description: "Read by the .qt-heading-* classes; unset, each level keeps its own inherited colour.",
    default: "inherit",
    optional: true,
    visibility: 'standard',
  },
];
