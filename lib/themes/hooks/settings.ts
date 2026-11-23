/**
 * Theme hooks — the Settings page (`app/settings/SettingsView.tsx`).
 *
 * @module lib/themes/hooks/settings
 */

import { SETTINGS_CARDS, SETTINGS_GROUP_IDS } from '@/lib/settings/registry'
import type { HookDef } from './types'

export const SETTINGS_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-settings-header',
    surface: 'settings',
    label: 'Settings title block',
    since: 1,
  },
  {
    className: 'qt-settings-persona-row',
    surface: 'settings',
    label: 'Staff lens row',
    since: 1,
  },
  {
    className: 'qt-settings-persona-chip',
    surface: 'settings',
    label: 'Staff lens button',
    within: ['qt-settings-persona-row'],
    states: [{ kind: 'aria', attribute: 'aria-pressed', values: ['true', 'false'], label: 'The lens in use' }],
    since: 1,
  },
  {
    className: 'qt-settings-search',
    surface: 'settings',
    label: 'Settings search',
    since: 1,
  },
  {
    className: 'qt-settings-lens-banner',
    surface: 'settings',
    label: 'Lens banner',
    description: "Shown while one member of staff's settings are singled out.",
    since: 1,
  },
  {
    className: 'qt-settings-layout',
    surface: 'settings',
    label: 'Settings layout',
    description: 'The rail beside the panel.',
    since: 1,
  },
  {
    className: 'qt-settings-rail',
    surface: 'settings',
    label: 'Settings rail',
    within: ['qt-settings-layout'],
    since: 1,
  },
  {
    className: 'qt-settings-rail-item',
    surface: 'settings',
    label: 'Settings rail item',
    within: ['qt-settings-rail'],
    variants: [{ attribute: 'data-group', values: SETTINGS_GROUP_IDS, description: 'Which group, by its registry id.' }],
    states: [{ kind: 'aria', attribute: 'aria-current', values: ['page'], label: 'The group on show' }],
    since: 1,
  },
  {
    className: 'qt-settings-rail-count',
    surface: 'settings',
    label: 'Rail match count',
    description: 'While searching: how many settings in the group match.',
    within: ['qt-settings-rail-item'],
    since: 1,
  },
  {
    className: 'qt-settings-panel',
    surface: 'settings',
    label: 'Settings panel',
    description: "The selected group's cards.",
    within: ['qt-settings-layout'],
    since: 1,
  },
  {
    className: 'qt-settings-advanced-divider',
    surface: 'settings',
    label: 'Advanced divider',
    within: ['qt-settings-panel'],
    since: 1,
  },
  {
    className: 'qt-collapsible-card',
    surface: 'settings',
    label: 'Settings card',
    description:
      'A collapsible card. On the Settings page it carries `data-card`; the same component appears without it elsewhere, so scope by `.qt-settings-panel` or `[data-card]`.',
    variants: [
      { attribute: 'data-card', values: SETTINGS_CARDS.map((card) => card.id), description: 'Which card, by its registry id.' },
    ],
    since: 1,
  },
  {
    className: 'qt-collapsible-card-header',
    surface: 'settings',
    label: 'Settings card header',
    description: 'The disclosure button.',
    within: ['qt-collapsible-card'],
    states: [{ kind: 'aria', attribute: 'aria-expanded', values: ['true', 'false'], label: 'Open' }],
    since: 1,
  },
  {
    className: 'qt-collapsible-card-icon',
    surface: 'settings',
    label: 'Settings card icon',
    within: ['qt-collapsible-card-header'],
    since: 1,
  },
  {
    className: 'qt-collapsible-card-chevron',
    surface: 'settings',
    label: 'Settings card chevron',
    within: ['qt-collapsible-card-header'],
    states: [{ kind: 'class', className: 'qt-collapsible-card-chevron-open', label: 'Open' }],
    since: 1,
  },
  {
    className: 'qt-collapsible-card-body',
    surface: 'settings',
    label: 'Settings card body',
    within: ['qt-collapsible-card'],
    since: 1,
  },
]
