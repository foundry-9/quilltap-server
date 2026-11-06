'use client'

/**
 * What every section of the character page shares: the row, the save model,
 * the reference data, and the few page-level commands (reload after an
 * outside write, jump to a section).
 *
 * @module app/aurora/[id]/CharacterPageContext
 */

import { createContext, useContext } from 'react'
import type { CharacterPageSection } from '@/lib/characters/page-sections'
import type { ConnectionProfileInfo } from '@/hooks/useConnectionProfiles'
import type { CharacterAutosave } from './hooks/useCharacterAutosave'
import type {
  Character,
  CharacterStats,
  CharacterVaultSummary,
  GroupBadge,
  UserControlledCharacter,
} from './types'

export interface CharacterPageContextValue {
  characterId: string
  character: Character
  autosave: CharacterAutosave
  /** True for an archived character: everything renders, nothing writes. */
  readOnly: boolean
  /** Bumped after a generator or bulk tool rewrote the row: editors remount. */
  externalToken: number
  /** Re-read the row (and its stats), then remount the editors. */
  reload: () => Promise<void>
  stats: CharacterStats | null
  groups: GroupBadge[]
  vault: CharacterVaultSummary | null
  profiles: ConnectionProfileInfo[]
  userControlledCharacters: UserControlledCharacter[]
  defaultPartnerId: string | null
  defaultPartnerName: string | null
  goToSection: (section: CharacterPageSection, anchor?: string) => void
}

export const CharacterPageContext = createContext<CharacterPageContextValue | null>(null)

export function useCharacterPage(): CharacterPageContextValue {
  const value = useContext(CharacterPageContext)
  if (!value) throw new Error('useCharacterPage must be used inside the character page')
  return value
}
