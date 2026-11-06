/**
 * Types for the one character page (`/aurora/[id]`).
 *
 * The client's view of a character row, as `GET /api/v1/characters/[id]`
 * returns it, plus the header's stats read.
 */

import type { TimestampConfig } from '@/lib/schemas/types'
import type { DiagramStyle } from '@/lib/markdown/diagrams'
import type { CharacterKind } from '@/lib/characters/kind'
import type { CharacterScenario } from '@/lib/schemas/character.types'

export interface Tag {
  id: string
  name: string
}

export interface ConnectionProfile {
  id: string
  name: string
}

export interface UserControlledCharacter {
  id: string
  name: string
  title: string | null
}

export interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

export interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Re-exported from the schema rather than redeclared, so `archived` and
 * `description` are never dropped by a narrower local shape.
 */
export type { CharacterScenario }

export interface CharacterPhysicalDescription {
  id: string
  headAndShouldersPrompt?: string | null
  shortPrompt?: string | null
  mediumPrompt?: string | null
  longPrompt?: string | null
  completePrompt?: string | null
  fullDescription?: string | null
  /** Absent means true; false = no humanoid body for the image pipelines. */
  humanoid?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface Character {
  id: string
  name: string
  title?: string | null
  identity?: string | null
  description?: string | null
  manifesto?: string | null
  personality?: string | null
  scenarios?: CharacterScenario[]
  firstMessage?: string | null
  exampleDialogues?: string | null
  systemPrompts?: CharacterSystemPrompt[]
  physicalDescription?: CharacterPhysicalDescription | null
  avatarUrl?: string
  defaultImageId?: string
  defaultConnectionProfileId?: string
  defaultImageProfileId?: string | null
  defaultPartnerId?: string | null
  controlledBy?: 'llm' | 'user'
  isFavorite?: boolean
  canBeCarina?: boolean | null
  systemTransparency?: boolean | null
  coreWhisperEnabled?: boolean | null
  npc?: boolean
  defaultAgentModeEnabled?: boolean | null
  defaultHelpToolsEnabled?: boolean | null
  canDressThemselves?: boolean | null
  canCreateOutfits?: boolean | null
  canManageInventory?: boolean | null
  canChooseOutfit?: boolean
  canDrawDiagrams?: boolean
  diagramStyle?: DiagramStyle
  kind?: CharacterKind
  defaultTimestampConfig?: TimestampConfig | null
  defaultScenarioId?: string | null
  defaultSystemPromptId?: string | null
  aliases?: string[]
  pronouns?: { subject: string; object: string; possessive: string } | null
  birthday?: string | null
  characterDocumentMountPointId?: string | null
  /** The vault `metadata.json` fact sheet (freeform keys plus the reserved `progressions`). */
  metadata?: unknown
  /** Set when the character is archived (tombstone with a pruned vault). */
  archivedAt?: string | null
  archiveFileId?: string | null
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  }
  tags?: string[]
}

export interface TemplateCounts {
  charCount: number
  userCount: number
  fieldCounts: Record<string, { char: number; user: number }>
}

/** Aggregate per-character counts shown in the header card. */
export interface CharacterStats {
  memories: number
  conversations: number
  wardrobeItems: number
  /** The character's own Inventory shelf, live objects only. */
  inventory?: {
    /** Non-archetype single objects. */
    objects: number
    /** Archetypes: classes of object, never carried. */
    archetypes: number
    /** Kits: lists of objects equipped as one. */
    kits: number
    /** Objects and kits flagged `equippedByDefault`. */
    carriedByDefault: number
  }
  photos: number
  scenarios: number
  knowledge: number
  /** Files in the vault `Core/` packet folder. */
  core: number
  /** Canonical managed vault files present (the numerator of `N/total`). */
  characterFiles: number
  /** Total canonical managed vault files expected (the denominator). */
  characterFilesTotal: number
  /** Canonical managed vault files that are absent, by vault path. */
  missingCharacterFiles?: string[]
  /** Files in the vault `Subprompts/` folder. */
  subprompts?: number
  /** Files in the vault `Mail/` folder. */
  mail?: number
  /** Files in the vault `Scenarios/` folder. */
  scenarioFiles?: number
}

/** The character's vault, as the stats read names it. */
export interface CharacterVaultSummary {
  mountPointId: string
  name: string
}

/** Lightweight group descriptor for the header badges (color + emoji). */
export interface GroupBadge {
  id: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
}
