'use client'

/**
 * Settings card bodies, keyed by registry card id.
 *
 * The registry (`lib/settings/registry.ts`) says what each card is called,
 * where it lives and whom it belongs to; this map says what renders inside it.
 * Bodies load lazily per group module, so opening one group does not pull in
 * the plugins manager or the Almanack. A registry-integrity test asserts that
 * every registered card has a body here (hosted kind cards render inside the
 * Providers card and are mapped there).
 *
 * @module components/settings/cards
 */

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

export interface SettingsCardBodyProps {
  /** The card a deep link or search asked for (used by cards that host others). */
  focusCard?: string | null
  /** A provider whose card to open inside the Providers card. */
  focusProvider?: string | null
  /** Active search terms, for cards that render nested titles. */
  highlight?: string[]
}

function Loading() {
  return <div className="qt-text-secondary py-4">Loading...</div>
}

type Loader<M> = () => Promise<M>

function lazyCard<M>(load: Loader<M>, pick: (m: M) => ComponentType<SettingsCardBodyProps>) {
  return dynamic(() => load().then(pick), { loading: Loading })
}

const connections = () => import('./cards/connections-cards')
const providers = () => import('./cards/providers-card')
const composer = () => import('./cards/composer-display-cards')
const memory = () => import('./cards/context-memory-cards')
const characters = () => import('./cards/characters-prompts-cards')
const images = () => import('./cards/images-cards')
const games = () => import('./cards/games-tools-cards')
const moderation = () => import('./cards/moderation-cards')
const appearance = () => import('./cards/appearance-cards')
const security = () => import('./cards/security-cards')
const data = () => import('./cards/data-maintenance-cards')

export const SETTINGS_CARD_COMPONENTS: Readonly<Record<string, ComponentType<SettingsCardBodyProps>>> = {
  // Connections
  'setup-wizard': lazyCard(connections, (m) => m.SetupWizardCard),
  providers: lazyCard(providers, (m) => m.ProvidersCard),
  'cheap-llm': lazyCard(connections, (m) => m.CheapLLMCard),
  // Hosted by Providers; mapped so a flattened search result can render them on their own.
  'api-keys': lazyCard(connections, (m) => m.ApiKeysCard),
  'connection-profiles': lazyCard(connections, (m) => m.ConnectionProfilesCard),
  'image-profiles': lazyCard(connections, (m) => m.ImageProfilesCard),
  'embedding-profiles': lazyCard(connections, (m) => m.EmbeddingProfilesCard),

  // Composer & Display
  'composition-mode': lazyCard(composer, (m) => m.CompositionModeCard),
  'composer-spellcheck': lazyCard(composer, (m) => m.ComposerCard),
  'composer-slash-commands': lazyCard(composer, (m) => m.SlashCommandsCard),
  'text-replacements': lazyCard(composer, (m) => m.TextReplacementCard),
  'smart-typography': lazyCard(composer, (m) => m.SmartTypographyCard),
  'auto-scroll': lazyCard(composer, (m) => m.AutoScrollCard),
  'token-display': lazyCard(composer, (m) => m.TokenDisplayCard),
  'thinking-display': lazyCard(composer, (m) => m.ThinkingDisplayCard),

  // Context & Memory
  'context-compression': lazyCard(memory, (m) => m.ContextCompressionCard),
  'memory-cascade': lazyCard(memory, (m) => m.MemoryCascadeCard),
  'data-retention': lazyCard(memory, (m) => m.DataRetentionCard),
  'memory-extraction-grain': lazyCard(memory, (m) => m.MemoryExtractionGrainCard),
  'memory-recall': lazyCard(memory, (m) => m.MemoryRecallCard),
  'memory-maintenance': lazyCard(memory, (m) => m.MemoryMaintenanceCard),
  'memory-backfill': lazyCard(memory, (m) => m.MemoryBackfillCard),
  'memory-regenerate': lazyCard(memory, (m) => m.MemoryRegenerateCard),
  'conversation-summaries-regenerate': lazyCard(memory, (m) => m.ConversationSummaryRegenerateCard),

  // Characters & Prompts
  'roleplay-templates': lazyCard(characters, (m) => m.RoleplayTemplatesCard),
  prompts: lazyCard(characters, (m) => m.PromptsCard),
  'core-whisper': lazyCard(characters, (m) => m.CoreWhisperCard),
  taboo: lazyCard(characters, (m) => m.TabooCard),

  // Images
  'story-backgrounds': lazyCard(images, (m) => m.StoryBackgroundsCard),
  'wardrobe-images': lazyCard(images, (m) => m.WardrobeImagesCard),
  'default-aesthetics': lazyCard(images, (m) => m.DefaultAestheticsCard),
  'image-description': lazyCard(images, (m) => m.ImageDescriptionCard),

  // Games & Tools
  automation: lazyCard(games, (m) => m.AutomationCard),
  'custom-tools': lazyCard(games, (m) => m.CustomToolsCard),
  'general-state': lazyCard(games, (m) => m.GeneralStateCard),
  'agent-mode': lazyCard(games, (m) => m.AgentModeCard),
  'answer-confirmation': lazyCard(games, (m) => m.AnswerConfirmationCard),
  'brahma-console': lazyCard(games, (m) => m.BrahmaConsoleCard),
  'autonomous-rooms': lazyCard(games, (m) => m.AutonomousRoomsCard),
  'autonomous-room-schedules': lazyCard(games, (m) => m.AutonomousRoomSchedulesCard),

  // Moderation
  'on-duty': lazyCard(moderation, (m) => m.OnDutyCard),
  'uncensored-desk': lazyCard(moderation, (m) => m.UncensoredDeskCard),
  refusals: lazyCard(moderation, (m) => m.RefusalsCard),
  display: lazyCard(moderation, (m) => m.DisplayCard),
  'pre-screening': lazyCard(moderation, (m) => m.PreScreeningCard),

  // Appearance
  appearance: lazyCard(appearance, (m) => m.AppearanceCard),
  'avatar-settings': lazyCard(appearance, (m) => m.AvatarSettingsCard),
  tags: lazyCard(appearance, (m) => m.TagsCard),

  // Security
  'encryption-passphrase': lazyCard(security, (m) => m.EncryptionPassphraseCard),
  'auto-lock': lazyCard(security, (m) => m.AutoLockCard),
  'delete-all-data': lazyCard(security, (m) => m.DeleteAllDataCard),

  // Data & Maintenance
  plugins: lazyCard(data, (m) => m.PluginsCard),
  'backup-restore': lazyCard(data, (m) => m.BackupRestoreCard),
  'import-export': lazyCard(data, (m) => m.ImportExportCard),
  'llm-logging': lazyCard(data, (m) => m.LLMLoggingCard),
  'llm-logs': lazyCard(data, (m) => m.LLMLogsCard),
  'tasks-queue': lazyCard(data, (m) => m.TasksQueueCard),
  'capabilities-report': lazyCard(data, (m) => m.CapabilitiesReportCard),
}
