/**
 * Theme hook catalogue — the single source of truth for which elements a
 * theme's custom CSS may rely on.
 *
 * Conventions, versioning and the lint that holds the markup to this list:
 * docs/developer/THEME_HOOKS.md (generated from here) and
 * docs/developer/features/complete/calliope-live-spec-b-hook-catalogue.md.
 *
 * Versioning: `HOOK_CATALOGUE_VERSION` rises by one in any change that
 * removes a hook, removes a variant value or state, or changes what element a
 * hook names. Adding does not raise it. A removed hook moves to
 * `REMOVED_HOOKS`; it is never silently deleted.
 *
 * @module lib/themes/hooks
 */

import { APP_SHELL_HOOKS } from './app-shell'
import { CHARACTER_HOOKS } from './character'
import { COMMON_HOOKS } from './common'
import { DIALOG_HOOKS } from './dialog'
import { HOME_HOOKS } from './home'
import { SALON_HOOKS } from './salon'
import { SETTINGS_HOOKS } from './settings'
import { SIDEBAR_HOOKS } from './sidebar'
import type { HookCatalogue, HookDef, HookSurface, RemovedHook } from './types'
import { WORKSPACE_HOOKS } from './workspace'

export type * from './types'

export const HOOK_CATALOGUE_VERSION = 1

/** Surfaces in the order the reference document presents them. */
export const HOOK_SURFACES: readonly HookSurface[] = [
  'app-shell',
  'workspace',
  'home',
  'sidebar',
  'salon',
  'character',
  'dialog',
  'settings',
  'common',
]

export const HOOK_SURFACE_TITLES: Record<HookSurface, string> = {
  'app-shell': 'App shell',
  workspace: 'Workspace',
  home: 'Home',
  sidebar: 'Left rail',
  salon: 'The Salon',
  character: 'Character page',
  dialog: 'Dialogs',
  settings: 'Settings',
  common: 'Shared building blocks',
}

export const HOOKS: readonly HookDef[] = [
  ...APP_SHELL_HOOKS,
  ...WORKSPACE_HOOKS,
  ...HOME_HOOKS,
  ...SIDEBAR_HOOKS,
  ...SALON_HOOKS,
  ...CHARACTER_HOOKS,
  ...DIALOG_HOOKS,
  ...SETTINGS_HOOKS,
  ...COMMON_HOOKS,
]

/** Hooks taken out of the catalogue, kept so a theme written against an older one can be warned. */
export const REMOVED_HOOKS: readonly RemovedHook[] = []

/**
 * Selectors on the root element that the app sets and a theme may rely on:
 * `<html>` carries `data-theme`, `data-color-mode` and `.light` / `.dark`.
 */
export const ROOT_HOOKS = {
  classes: ['light', 'dark'],
  attributes: ['data-theme', 'data-color-mode'],
} as const

export const HOOK_CATALOGUE: HookCatalogue = {
  version: HOOK_CATALOGUE_VERSION,
  hooks: HOOKS,
  removed: REMOVED_HOOKS,
}

const BY_CLASS = new Map<string, HookDef>(HOOKS.map((hook) => [hook.className, hook]))

/** The hook a class names, if it is catalogued. */
export function getHook(className: string): HookDef | undefined {
  return BY_CLASS.get(className)
}

/** Every hook on one surface, in catalogue order. */
export function hooksForSurface(surface: HookSurface): HookDef[] {
  return HOOKS.filter((hook) => hook.surface === surface)
}

/**
 * Hooks removed after `version` — what a theme written against that catalogue
 * version may still target.
 */
export function hooksRemovedSince(version: number, removed: readonly RemovedHook[] = REMOVED_HOOKS): RemovedHook[] {
  return removed.filter((hook) => hook.removedIn > version)
}
