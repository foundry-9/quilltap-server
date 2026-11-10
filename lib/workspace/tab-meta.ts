/**
 * Default titles and icons per tab kind.
 *
 * Used by the reducer when it has to mint a tab on its own (the home fallback)
 * and by the provider's `openTab` convenience when a caller does not supply an
 * explicit title/icon. User-facing titles are in the house voice.
 *
 * @module lib/workspace/tab-meta
 */

import type { SettingsTabPayload, TabKind } from './types'
import { getSettingsGroup, isSettingsPersona, resolveSettingsLink } from '@/lib/settings/registry'
import { DEFAULT_SUBSYSTEM_DEFINITIONS } from '@/lib/foundry/subsystem-defaults'

export interface TabMeta {
  title: string
  icon: string
}

/**
 * Per-kind defaults. Salon/terminal/document/settings/wardrobe titles are
 * usually overridden by the opener with a chat- or target-specific label; the
 * defaults here are the fallbacks.
 */
// Icon values must be canonical names from the icon registry
// (`components/ui/icons/icon-registry.ts`).
export const DEFAULT_TAB_META: Record<TabKind, TabMeta> = {
  home: { title: 'Home', icon: 'sparkles' },
  salon: { title: 'Conversation', icon: 'chat' },
  'salon-list': { title: 'Chats', icon: 'chat' },
  terminal: { title: 'Terminal', icon: 'code' },
  document: { title: 'Document', icon: 'file' },
  aurora: { title: 'Characters', icon: 'characters' },
  prospero: { title: 'Projects', icon: 'projects' },
  scriptorium: { title: 'The Scriptorium', icon: 'scriptorium' },
  settings: { title: 'The Foundry', icon: 'settings' },
  files: { title: 'Files', icon: 'files' },
  photos: { title: 'My Photos', icon: 'photos' },
  scenarios: { title: 'Scenarios', icon: 'scenarios' },
  brahma: { title: 'Brahma Console', icon: 'brahma-console' },
  wardrobe: { title: 'The Wardrobe', icon: 'wardrobe' },
  inventory: { title: 'The Inventory', icon: 'inventory' },
  atlas: { title: 'The Atlas', icon: 'atlas' },
  profile: { title: 'Profile', icon: 'profile' },
  about: { title: 'About', icon: 'info' },
  'generate-image': { title: 'Generate Image', icon: 'image' },
  'document-standalone': { title: 'Document', icon: 'file' },
  'character-new': { title: 'New Character', icon: 'user-plus' },
  character: { title: 'Character', icon: 'characters' },
  'settings-wizard': { title: 'Provider Setup', icon: 'wand' },
  'custom-tools': { title: "Pascal's Workbench", icon: 'wrench' },
}

/**
 * Defaults for a tab of `kind`. A settings tab with a deep link is titled by
 * where it points: the persona for a lens, else the resolved group.
 */
export function defaultTabMeta(kind: TabKind, payload?: unknown): TabMeta {
  const meta = DEFAULT_TAB_META[kind]
  if (kind !== 'settings' || !payload) return meta
  const title = settingsTabTitle(payload as SettingsTabPayload)
  return title ? { ...meta, title } : meta
}

/** `The Foundry · <group or persona>` for a settings deep link, or null when it names nowhere. */
export function settingsTabTitle(payload: SettingsTabPayload): string | null {
  const base = DEFAULT_TAB_META.settings.title
  if (isSettingsPersona(payload.persona)) {
    return `${base} · ${DEFAULT_SUBSYSTEM_DEFINITIONS[payload.persona].name}`
  }
  const link = resolveSettingsLink({
    get: (key: string) => {
      const value = payload[key as keyof SettingsTabPayload]
      return typeof value === 'string' ? value : null
    },
  })
  const group = link ? getSettingsGroup(link.group) : undefined
  return group ? `${base} · ${group.title}` : null
}
