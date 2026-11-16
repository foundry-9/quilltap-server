/**
 * Theme hooks — shared building blocks used across every surface: cards,
 * buttons, form fields, badges, alerts, headings, avatars and tabs.
 *
 * Most of these are standalone classes (a `qt-button-primary` needs no
 * `qt-button` beside it), so each is catalogued as its own hook.
 *
 * @module lib/themes/hooks/common
 */

import type { HookDef, QtClass } from './types'
import { TAB_KIND_VARIANT } from './workspace'

function family(className: QtClass, label: string, description?: string): HookDef {
  return { className, surface: 'common', label, ...(description ? { description } : {}), since: 1 }
}

export const COMMON_HOOKS: readonly HookDef[] = [
  // Pages
  family('qt-page-container', 'Page container', 'The width-limited column most full pages (Settings, a character, the lists) sit in.'),

  // Cards
  family('qt-card', 'Card'),
  { ...family('qt-card-header', 'Card header'), within: ['qt-card'] },
  family('qt-card-title', 'Card title'),
  family('qt-card-subtitle', 'Card subtitle'),
  family('qt-card-description', 'Card description'),
  family('qt-card-interactive', 'Clickable card'),

  // Buttons
  family('qt-button', 'Button', 'The base button; usually paired with a variant class.'),
  family('qt-button-primary', 'Primary button'),
  family('qt-button-secondary', 'Secondary button'),
  family('qt-button-ghost', 'Ghost button'),
  family('qt-button-destructive', 'Destructive button'),
  family('qt-button-success', 'Success button'),
  family('qt-button-warning', 'Warning button'),
  family('qt-button-sm', 'Small button', 'A size modifier, beside a variant.'),
  family('qt-button-icon', 'Icon button'),

  // Form fields
  { ...family('qt-input', 'Text input'), states: [{ kind: 'class', className: 'qt-input-error', label: 'Invalid' }] },
  family('qt-textarea', 'Text area'),
  family('qt-select', 'Select'),
  family('qt-select-sm', 'Small select'),

  // Badges
  family('qt-badge', 'Badge'),
  family('qt-badge-primary', 'Primary badge'),
  family('qt-badge-secondary', 'Secondary badge'),
  family('qt-badge-success', 'Success badge'),
  family('qt-badge-warning', 'Warning badge'),
  family('qt-badge-info', 'Info badge'),
  family('qt-badge-destructive', 'Destructive badge'),
  family('qt-badge-outline', 'Outline badge'),
  family('qt-badge-character', 'Character badge'),
  family('qt-badge-user-character', 'Operator-character badge'),
  family('qt-badge-chat', 'Chat badge'),
  family('qt-badge-tag', 'Tag badge'),
  family('qt-badge-memory', 'Memory badge'),
  family('qt-badge-project', 'Project badge'),

  // Alerts
  family('qt-alert', 'Alert'),
  family('qt-alert-info', 'Info alert'),
  family('qt-alert-success', 'Success alert'),
  family('qt-alert-warning', 'Warning alert'),
  family('qt-alert-error', 'Error alert'),

  // Headings
  family('qt-heading-1', 'Heading, level 1 size'),
  family('qt-heading-2', 'Heading, level 2 size'),
  family('qt-heading-3', 'Heading, level 3 size'),
  family('qt-heading-4', 'Heading, level 4 size'),
  family('qt-page-title', 'Page title', 'The large title at the head of a page.'),
  family('qt-section-title', 'Section title', 'A heading over a card, panel or settings group.'),
  family('qt-text-section', 'Section heading text', 'A smaller section heading inside a form or panel.'),

  // Brand
  family('qt-text-brand', 'Brand-coloured text', 'Text in the brand colour: links, the active item, small accents.'),
  family('qt-font-brand', 'Brand name', 'The Quilltap name, set in the brand font.'),

  // Progress
  family('qt-spinner', 'Spinner', 'A loading spinner; `qt-spinner-sm` beside it for the small one.'),
  family('qt-thinking-indicator', 'Thinking mark', 'The mark shown while a model is thinking; it animates by --qt-thinking-duration and --qt-thinking-origin.'),

  // Empty states
  family('qt-empty-state-title', 'Empty-state title', 'The heading of the notice shown where a list has nothing in it.'),

  // Links and previews
  { ...family('qt-wikilink', 'Wiki link', 'A [[link]] between documents in rendered text.'), states: [{ kind: 'class', className: 'qt-wikilink-broken', label: 'Points at nothing' }] },
  family('qt-file-preview-panel', 'File preview panel', 'The panel a text file is previewed on.'),

  // Diagrams
  family('qt-diagram', 'Diagram', 'A rendered diagram in a message or document, with its toolbar.'),

  // Avatars (components/ui/Avatar.tsx)
  family('qt-avatar-image', 'Avatar picture box', 'The framed box holding an avatar picture or its initial.'),
  family('qt-avatar-labels', 'Avatar caption', 'Name and title beneath an avatar.'),
  { ...family('qt-avatar-name', 'Avatar name'), within: ['qt-avatar-labels'] },
  { ...family('qt-avatar-title', 'Avatar title'), within: ['qt-avatar-labels'] },

  // Tabs
  family('qt-tab-group', 'In-page tab group', 'Entity-page tabs (a character, a project) and small view switchers.'),
  {
    className: 'qt-tab',
    surface: 'common',
    label: 'Tab',
    description:
      'Shared by the workspace tab strip (`.qt-tab-strip .qt-tab`) and the in-page tabs (`.qt-tab-group .qt-tab`): scope by the parent. Only workspace tabs carry `data-tab-kind`.',
    within: ['qt-tab-strip', 'qt-tab-group'],
    variants: [TAB_KIND_VARIANT],
    states: [
      { kind: 'class', className: 'qt-tab-active', label: 'The selected tab' },
      { kind: 'class', className: 'qt-tab-dragging', label: 'Being dragged (workspace)' },
    ],
    since: 1,
  },

  // Added in Spec I (Calliope Live).
  {
    className: 'qt-empty-state',
    surface: 'common',
    label: 'Empty state',
    description: 'The "nothing here yet" block; its title is `qt-empty-state-title`.',
    since: 1,
  },
  {
    className: 'qt-empty-state-icon',
    surface: 'common',
    label: 'Empty state icon',
    within: ['qt-empty-state'],
    since: 1,
  },
  {
    className: 'qt-empty-state-description',
    surface: 'common',
    label: 'Empty state description',
    within: ['qt-empty-state'],
    since: 1,
  },
  {
    className: 'qt-empty-state-action',
    surface: 'common',
    label: 'Empty state action',
    description: 'The button or link under an empty state.',
    within: ['qt-empty-state'],
    since: 1,
  },
  {
    className: 'qt-loading-state',
    surface: 'common',
    label: 'Loading state',
    description: 'The block shown while a list or card is fetched.',
    since: 1,
  },
  {
    className: 'qt-tooltip',
    surface: 'common',
    label: 'Tooltip',
    since: 1,
  },
  {
    className: 'qt-popover',
    surface: 'common',
    label: 'Popover',
    description: 'A small anchored panel: a delete confirmation, the character picker.',
    since: 1,
  },
  {
    className: 'qt-entity-card',
    surface: 'common',
    label: 'Entity card',
    description: 'A character, chat, group or project in a list.',
    since: 1,
  },
  {
    className: 'qt-label',
    surface: 'common',
    label: 'Field label',
    description: "A form field's label.",
    since: 1,
  },
  {
    className: 'qt-link',
    surface: 'common',
    label: 'Link',
    description: 'An ordinary text link.',
    since: 1,
  },
  {
    className: 'qt-checkbox',
    surface: 'common',
    label: 'Checkbox',
    since: 1,
  },
  {
    className: 'qt-radio',
    surface: 'common',
    label: 'Radio button',
    since: 1,
  },
  {
    className: 'qt-range',
    surface: 'common',
    label: 'Slider',
    description: 'A range input.',
    since: 1,
  },
  {
    className: 'qt-prose',
    surface: 'common',
    label: 'Rendered Markdown',
    description: 'Markdown rendered as prose: messages, previews, help.',
    since: 1,
  },
  {
    className: 'qt-code-block',
    surface: 'common',
    label: 'Code block',
    description: 'A fenced code block in rendered Markdown.',
    since: 1,
  },
  {
    className: 'qt-code-inline',
    surface: 'common',
    label: 'Inline code',
    since: 1,
  },
  {
    className: 'qt-progress',
    surface: 'common',
    label: 'Progress bar',
    description: 'The track.',
    since: 1,
  },
  {
    className: 'qt-progress-fill',
    surface: 'common',
    label: 'Progress bar fill',
    description: 'The filled part of a progress bar.',
    within: ['qt-progress'],
    states: [
      { kind: 'class', className: 'qt-progress-fill-success', label: 'Finished well' },
      { kind: 'class', className: 'qt-progress-fill-danger', label: 'Failed' },
      { kind: 'class', className: 'qt-progress-fill-idle', label: 'Waiting' },
    ],
    since: 1,
  },
]
