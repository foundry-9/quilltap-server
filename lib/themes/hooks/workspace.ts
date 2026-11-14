/**
 * Theme hooks — the tabbed workspace (`components/workspace/`).
 *
 * The tab itself (`qt-tab`) is shared with the in-page entity tabs and is
 * catalogued once, under `common` (see `./common.ts`).
 *
 * @module lib/themes/hooks/workspace
 */

import { TAB_KINDS } from '@/lib/workspace/types'
import type { HookDef, HookVariant } from './types'

/** The two workspace panes, as written in `data-pane`. */
export const WORKSPACE_PANES = ['left', 'right'] as const

const PANE_VARIANT: HookVariant = {
  attribute: 'data-pane',
  values: WORKSPACE_PANES,
  description: 'Which pane: `left`, or `right` when the workspace is split.',
}

/** `data-tab-kind`: the workspace's tab kinds (`TAB_KINDS`, lib/workspace/types.ts). */
export const TAB_KIND_VARIANT: HookVariant = {
  attribute: 'data-tab-kind',
  values: TAB_KINDS,
  description: 'What the tab holds: one of the workspace tab kinds (`home`, `salon`, `character`, `settings`, …).',
}

export const WORKSPACE_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-workspace',
    surface: 'workspace',
    label: 'Workspace',
    description: 'The two-pane tab host: a grid of pane chrome on top, tab content beneath.',
    within: ['qt-app-scroll'],
    since: 1,
  },
  {
    className: 'qt-workspace-backdrop',
    surface: 'workspace',
    label: 'Workspace backdrop',
    description: 'The single story background behind both panes.',
    within: ['qt-workspace'],
    since: 1,
  },
  {
    className: 'qt-workspace-backdrop-layer',
    surface: 'workspace',
    label: 'Workspace backdrop layer',
    within: ['qt-workspace-backdrop'],
    since: 1,
  },
  {
    className: 'qt-workspace-pane-chrome',
    surface: 'workspace',
    label: 'Pane chrome',
    description: "A pane's tab strip area, above its content.",
    within: ['qt-workspace'],
    variants: [PANE_VARIANT],
    since: 1,
  },
  {
    className: 'qt-tab-strip',
    surface: 'workspace',
    label: 'Tab strip',
    within: ['qt-workspace-pane-chrome'],
    variants: [PANE_VARIANT],
    since: 1,
  },
  {
    className: 'qt-tab-select',
    surface: 'workspace',
    label: 'Tab button',
    description: 'The focusable part of a workspace tab (icon and title).',
    within: ['qt-tab'],
    states: [{ kind: 'aria', attribute: 'aria-selected', values: ['true', 'false'], label: 'The visible tab in its pane' }],
    since: 1,
  },
  {
    className: 'qt-tab-icon',
    surface: 'workspace',
    label: 'Tab icon',
    within: ['qt-tab'],
    since: 1,
  },
  {
    className: 'qt-tab-label',
    surface: 'workspace',
    label: 'Tab title',
    within: ['qt-tab-select'],
    since: 1,
  },
  {
    className: 'qt-tab-close',
    surface: 'workspace',
    label: 'Tab close button',
    within: ['qt-tab'],
    since: 1,
  },
  {
    className: 'qt-tab-pane',
    surface: 'workspace',
    label: 'Tab content',
    description: "One tab's view. Hidden tabs stay mounted (and carry `hidden`), so scope to the visible one with `:not(.hidden)`.",
    within: ['qt-workspace'],
    variants: [PANE_VARIANT, TAB_KIND_VARIANT],
    since: 1,
  },
  {
    className: 'qt-workspace-divider',
    surface: 'workspace',
    label: 'Split divider',
    description: 'The draggable bar between split panes.',
    within: ['qt-workspace'],
    since: 1,
  },
  {
    className: 'qt-workspace-divider-grip',
    surface: 'workspace',
    label: 'Split divider grip',
    within: ['qt-workspace-divider'],
    since: 1,
  },
  {
    className: 'qt-workspace-empty',
    surface: 'workspace',
    label: 'Empty pane',
    within: ['qt-workspace'],
    since: 1,
  },
  {
    className: 'qt-tab-drop-zone',
    surface: 'workspace',
    label: 'Split drop zone',
    description: 'Shown while a tab is dragged in an unsplit workspace.',
    within: ['qt-workspace'],
    since: 1,
  },
]
