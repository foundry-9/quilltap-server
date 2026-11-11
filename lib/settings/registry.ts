/**
 * Settings registry — the one list of what is on the Settings page (The Foundry).
 *
 * Every group and every card the page renders is declared here, and every
 * thing that addresses the page reads it: `SettingsView` renders the rail and
 * the column from it, `resolveSettingsLink` turns any settings URL (new or
 * legacy) into a group and card, the Foundry subsystem `href`s and the
 * help-guide categories derive from it, and the help-link test checks every
 * help document's `/settings` link against it.
 *
 * Client-safe and React-free: the card bodies are mapped to components in
 * `components/settings/cards.tsx`, keyed by `SettingsCard.id`.
 *
 * Design of record: docs/developer/features/complete/settings-redesign.md
 *
 * @module lib/settings/registry
 */

import type { IconName } from '@/components/ui/icons/icon-registry'
import { DEFAULT_SUBSYSTEM_DEFINITIONS, type SubsystemId } from '@/lib/foundry/subsystem-defaults'

/** A card's persona is a Foundry subsystem, so theme overrides and images apply to every badge. */
export type SettingsPersona = SubsystemId

export const SETTINGS_GROUP_IDS = [
  'connections',
  'composer-display',
  'context-memory',
  'characters-prompts',
  'images',
  'games-tools',
  'moderation',
  'appearance',
  'security',
  'data-maintenance',
] as const

export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number]

export interface SettingsGroup {
  id: SettingsGroupId
  title: string
  description: string
  icon: IconName
  /** Persona whose backdrop the group wears when none of its cards is focused. */
  persona: SettingsPersona
}

export interface SettingsCard {
  /** The card's sectionId — the deep-link anchor (`?section=`). Never renamed. */
  id: string
  group: SettingsGroupId
  title: string
  description: string
  persona: SettingsPersona
  /** Plain-speech synonyms for search ("password", "dice", "censor"). */
  keywords: readonly string[]
  /** Rendered below the "Advanced" divider, collapsed. */
  advanced?: true
  /** Opens expanded when nothing else asks for it. */
  defaultOpen?: true
  /** A card rendered inside another card's body; still a deep-link and search target. */
  hostedBy?: string
  /** Help document slug (`help/<slug>.md`) this card is documented in. */
  help: string
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'connections',
    title: 'Connections',
    description: 'Providers, their keys, and every profile that rides on them',
    icon: 'link',
    persona: 'forge',
  },
  {
    id: 'composer-display',
    title: 'Composer & Display',
    description: 'How you write in the Salon and how the conversation is laid before you',
    icon: 'chat',
    persona: 'salon',
  },
  {
    id: 'context-memory',
    title: 'Context & Memory',
    description: 'What the characters remember, and how much of the past they are handed each turn',
    icon: 'book',
    persona: 'commonplace-book',
  },
  {
    id: 'characters-prompts',
    title: 'Characters & Prompts',
    description: 'Templates, prompts, and the words no one in the house may say',
    icon: 'characters',
    persona: 'aurora',
  },
  {
    id: 'images',
    title: 'Images',
    description: 'Story backgrounds, wardrobe pictures, and the house style',
    icon: 'image',
    persona: 'lantern',
  },
  {
    id: 'games-tools',
    title: 'Games & Tools',
    description: 'Dice, custom tools, agent mode, the Console, and the autonomous rooms',
    icon: 'dice',
    persona: 'pascal',
  },
  {
    id: 'moderation',
    title: 'Moderation',
    description: 'Who is asked when the usual providers refuse, and how flagged content is shown',
    icon: 'shield',
    persona: 'concierge',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Themes, avatars, and tags',
    icon: 'themes',
    persona: 'calliope',
  },
  {
    id: 'security',
    title: 'Security',
    description: 'The passphrase, the lock, and the last resort',
    icon: 'eye-off',
    persona: 'saquel',
  },
  {
    id: 'data-maintenance',
    title: 'Data & Maintenance',
    description: 'Plugins, backups, logs, the task queue, and the Almanack',
    icon: 'database',
    persona: 'prospero',
  },
]

export const SETTINGS_CARDS: readonly SettingsCard[] = [
  // --- Connections -----------------------------------------------------------
  {
    id: 'setup-wizard',
    group: 'connections',
    title: 'AI Stack Setup Wizard',
    description: 'Re-run the guided setup to configure providers, API keys, models, and profiles all in one go',
    persona: 'forge',
    keywords: ['wizard', 'setup', 'getting started', 'onboarding', 'guided'],
    help: 'setup-wizard',
  },
  {
    id: 'providers',
    group: 'connections',
    title: 'Providers',
    description: 'Every provider you use, with its keys and every profile that relies on it',
    persona: 'forge',
    keywords: [
      'provider', 'key', 'model', 'endpoint', 'openai', 'anthropic', 'claude', 'grok', 'xai',
      'google', 'gemini', 'ollama', 'openrouter', 'local', 'llm',
    ],
    defaultOpen: true,
    help: 'api-keys-settings',
  },
  {
    id: 'api-keys',
    group: 'connections',
    title: 'API Keys',
    description: 'Manage API keys for LLM providers',
    persona: 'saquel',
    keywords: ['key', 'secret', 'token', 'credential', 'provider'],
    hostedBy: 'providers',
    help: 'api-keys-settings',
  },
  {
    id: 'connection-profiles',
    group: 'connections',
    title: 'Connection Profiles',
    description: 'Configure LLM connection profiles',
    persona: 'forge',
    keywords: ['model', 'llm', 'connection', 'profile', 'temperature', 'courier', 'endpoint'],
    hostedBy: 'providers',
    help: 'connection-profiles',
  },
  {
    id: 'image-profiles',
    group: 'connections',
    title: 'Image Profiles',
    description: 'Configure image generation providers and models',
    persona: 'lantern',
    keywords: ['image', 'picture', 'generation', 'dall-e', 'art', 'model'],
    hostedBy: 'providers',
    help: 'image-generation-profiles',
  },
  {
    id: 'embedding-profiles',
    group: 'connections',
    title: 'Embedding Profiles',
    description: 'Configure embedding models for semantic memory',
    persona: 'commonplace-book',
    keywords: ['embedding', 'vector', 'semantic', 'search', 'memory model'],
    hostedBy: 'providers',
    help: 'embedding-profiles',
  },
  {
    id: 'cheap-llm',
    group: 'connections',
    title: 'Cheap LLM Settings',
    description: 'Configure the lightweight LLM used for background tasks',
    persona: 'forge',
    keywords: ['cheap', 'background', 'summary', 'title', 'small model', 'inexpensive'],
    help: 'chat-settings-ai-services',
  },

  // --- Composer & Display ----------------------------------------------------
  {
    id: 'composition-mode',
    group: 'composer-display',
    title: 'Composition Mode',
    description: 'Whether new chats start in composition mode',
    persona: 'salon',
    keywords: ['composition', 'draft', 'compose', 'new chat'],
    help: 'chat-settings-composer',
  },
  {
    id: 'composer-spellcheck',
    group: 'composer-display',
    title: 'Composer',
    description: 'Composer behavior and input aids',
    persona: 'salon',
    keywords: ['spellcheck', 'spelling', 'emoji', 'unicode', 'impersonation', 'voice', 'typing'],
    help: 'chat-settings-composer',
  },
  {
    id: 'composer-slash-commands',
    group: 'composer-display',
    title: 'Slash Commands',
    description: 'Run tools and composer actions by typing / in the Salon composer',
    persona: 'salon',
    keywords: ['slash', 'command', 'shortcut', '/'],
    help: 'chat-settings-composer',
  },
  {
    id: 'text-replacements',
    group: 'composer-display',
    title: 'Text Replacement',
    description: 'Replace literal triggers with replacement text on word boundaries',
    persona: 'salon',
    keywords: ['replace', 'substitution', 'autocorrect', 'expansion', 'macro'],
    help: 'chat-settings-composer',
  },
  {
    id: 'smart-typography',
    group: 'composer-display',
    title: 'Smart Typography',
    description: 'Curly quotes when displaying messages; real dashes and ellipsis as you type',
    persona: 'salon',
    keywords: ['quotes', 'curly', 'dash', 'em dash', 'ellipsis', 'typography'],
    help: 'chat-settings-composer',
  },
  {
    id: 'auto-scroll',
    group: 'composer-display',
    title: 'Auto-Scroll',
    description: 'Whether the Salon follows new messages to the bottom',
    persona: 'salon',
    keywords: ['scroll', 'follow', 'jump', 'bottom'],
    help: 'chat-settings-composer',
  },
  {
    id: 'token-display',
    group: 'composer-display',
    title: 'Token Display',
    description: 'Configure token count and cost display',
    persona: 'salon',
    keywords: ['token', 'cost', 'price', 'usage', 'count', 'money'],
    help: 'chat-settings',
  },
  {
    id: 'thinking-display',
    group: 'composer-display',
    title: 'Thinking / Reasoning',
    description: "Show reasoning models' chain-of-thought in chat (display only)",
    persona: 'salon',
    keywords: ['thinking', 'reasoning', 'chain of thought', 'thoughts'],
    help: 'thinking-display',
  },

  // --- Context & Memory ------------------------------------------------------
  {
    id: 'context-compression',
    group: 'context-memory',
    title: 'Context Compression',
    description: 'Configure how older messages are compressed',
    persona: 'salon',
    keywords: ['context', 'compression', 'summary', 'history', 'window', 'tokens'],
    help: 'chat-settings-ai-services',
  },
  {
    id: 'memory-cascade',
    group: 'context-memory',
    title: 'Memory Cascade',
    description: 'Control how memories behave when messages change',
    persona: 'commonplace-book',
    keywords: ['cascade', 'edit', 'delete', 'swipe', 'memory'],
    help: 'chat-settings-ai-services',
  },
  {
    id: 'data-retention',
    group: 'context-memory',
    title: 'Data Retention',
    description: 'How long inactive chats keep their regenerable working data',
    persona: 'salon',
    keywords: ['retention', 'stale', 'cleanup', 'disk', 'space', 'old chats'],
    help: 'data-retention',
  },
  {
    id: 'memory-extraction-grain',
    group: 'context-memory',
    title: 'Extraction Grain',
    description: "Choose how often a character's observations of other characters are noted",
    persona: 'commonplace-book',
    keywords: ['extraction', 'grain', 'observation', 'memory', 'frequency'],
    help: 'memory-maintenance',
  },
  {
    id: 'memory-recall',
    group: 'context-memory',
    title: 'Recall Relevance',
    description: 'Keep project-specific memories from wandering into unrelated chats',
    persona: 'commonplace-book',
    keywords: ['recall', 'relevance', 'project', 'memory', 'remember'],
    help: 'memory-recall-relevance',
  },
  {
    id: 'memory-maintenance',
    group: 'context-memory',
    title: 'Maintenance',
    description: 'Fold repetitions, consolidate into digests, keep each character under the cap, and let old archive notes go',
    persona: 'commonplace-book',
    keywords: ['maintenance', 'housekeeping', 'consolidation', 'deduplication', 'duplicate', 'cap', 'memory'],
    help: 'memory-maintenance',
  },
  {
    id: 'memory-backfill',
    group: 'context-memory',
    title: 'Repair Missing Embeddings',
    description: 'Generate embeddings for legacy memories that predate the embedding-aware gate',
    persona: 'commonplace-book',
    keywords: ['backfill', 'embedding', 'repair', 'missing', 'memory'],
    advanced: true,
    help: 'memory-maintenance',
  },
  {
    id: 'memory-regenerate',
    group: 'context-memory',
    title: 'Regenerate Memories',
    description: 'Wipe and rebuild every chat-linked memory using the current extraction pipeline',
    persona: 'commonplace-book',
    keywords: ['regenerate', 'rebuild', 'wipe', 'memory', 'reset'],
    advanced: true,
    help: 'memory-regenerate',
  },
  {
    id: 'conversation-summaries-regenerate',
    group: 'context-memory',
    title: 'Regenerate Conversation Summaries',
    description: "Re-mirror every summarised chat into its characters' vaults for relevant-conversation recall",
    persona: 'commonplace-book',
    keywords: ['summary', 'summaries', 'regenerate', 'conversation', 'vault'],
    advanced: true,
    help: 'conversation-summary-regenerate',
  },

  // --- Characters & Prompts --------------------------------------------------
  {
    id: 'roleplay-templates',
    group: 'characters-prompts',
    title: 'Roleplay Templates',
    description: 'Manage templates that shape how characters interact',
    persona: 'aurora',
    keywords: ['template', 'roleplay', 'format', 'style', 'narration'],
    help: 'roleplay-templates',
  },
  {
    id: 'prompts',
    group: 'characters-prompts',
    title: 'Prompts',
    description: 'Configure system prompts and prompt blocks',
    persona: 'aurora',
    keywords: ['prompt', 'system prompt', 'instructions', 'block'],
    help: 'prompts',
  },
  {
    id: 'core-whisper',
    group: 'characters-prompts',
    title: "Aurora's Core Whisper",
    description: "Periodic re-offering of each character's own Core/ vault folder",
    persona: 'aurora',
    keywords: ['core', 'whisper', 'vault', 'reminder', 'identity'],
    help: 'core-whisper',
  },
  {
    id: 'taboo',
    group: 'characters-prompts',
    title: 'Taboo',
    description: 'Phrases no character may utter, anywhere in the house',
    persona: 'salon',
    keywords: ['taboo', 'banned', 'forbidden', 'phrase', 'blocklist', 'slop'],
    help: 'taboo',
  },

  // --- Images ----------------------------------------------------------------
  {
    id: 'story-backgrounds',
    group: 'images',
    title: 'Story Backgrounds',
    description: 'Configure automatic story background image generation',
    persona: 'lantern',
    keywords: ['background', 'scene', 'backdrop', 'lantern', 'picture'],
    help: 'story-backgrounds',
  },
  {
    id: 'wardrobe-images',
    group: 'images',
    title: 'Wardrobe Images',
    description: 'Choose the artist who draws pictures of garments and outfits',
    persona: 'lantern',
    keywords: ['wardrobe', 'outfit', 'clothing', 'garment', 'picture'],
    help: 'wardrobe-images',
  },
  {
    id: 'default-aesthetics',
    group: 'images',
    title: 'Default Aesthetics',
    description: 'Free-form house style woven into every avatar, story background, and ad-hoc image. Projects can override these per file',
    persona: 'lantern',
    keywords: ['aesthetic', 'style', 'look', 'art style', 'palette'],
    help: 'image-aesthetics',
  },
  {
    id: 'image-description',
    group: 'images',
    title: 'Image Description',
    description: 'Configure image description generation',
    persona: 'lantern',
    keywords: ['vision', 'describe', 'caption', 'alt text', 'image'],
    help: 'chat-settings-ai-services',
  },

  // --- Games & Tools ---------------------------------------------------------
  {
    id: 'automation',
    group: 'games-tools',
    title: 'Automation',
    description: 'Dice and detection: automatic rolls and custom-tool triggers',
    persona: 'pascal',
    keywords: ['dice', 'roll', 'random', 'rng', 'detection', 'trigger', 'automatic'],
    help: 'rng-tool',
  },
  {
    id: 'custom-tools',
    group: 'games-tools',
    title: 'Custom Tools',
    description: "Whether Pascal's custom tools are offered to models and the composer",
    persona: 'pascal',
    keywords: ['custom tool', 'workbench', 'pseudo-tool', 'game'],
    help: 'custom-tools',
  },
  {
    id: 'general-state',
    group: 'games-tools',
    title: 'General State',
    description: 'Instance-wide persistent state shared by every chat (bottom tier of the state cascade)',
    persona: 'pascal',
    keywords: ['state', 'variables', 'game state', 'global'],
    advanced: true,
    help: 'chat-state',
  },
  {
    id: 'agent-mode',
    group: 'games-tools',
    title: 'Agent Mode',
    description: 'Configure iterative tool use with self-correction',
    persona: 'prospero',
    keywords: ['agent', 'tool use', 'iterative', 'turns', 'loop'],
    help: 'agent-mode',
  },
  {
    id: 'answer-confirmation',
    group: 'games-tools',
    title: 'Answer Confirmation',
    description: 'Vet looked-up answers against what the character actually knew this turn',
    persona: 'prospero',
    keywords: ['confirm', 'verify', 'answer', 'fact check', 'lookup'],
    help: 'answer-confirmation',
  },
  {
    id: 'brahma-console',
    group: 'games-tools',
    title: 'Brahma Console',
    description: 'How many tool-use turns the Console may take before it must answer',
    persona: 'brahma',
    keywords: ['console', 'brahma', 'sql', 'tool turns', 'generic'],
    help: 'brahma-console',
  },
  {
    id: 'autonomous-rooms',
    group: 'games-tools',
    title: 'Autonomous Rooms',
    description: 'Defaults for private character-to-character rooms',
    persona: 'salon',
    keywords: ['autonomous', 'room', 'unattended', 'private', 'character to character', 'host'],
    help: 'autonomous-rooms',
  },
  {
    id: 'autonomous-room-schedules',
    group: 'games-tools',
    title: 'Scheduled Autonomous Rooms',
    description: 'Pause, resume, or stop scheduled rooms (and any ad-hoc room currently running)',
    persona: 'salon',
    keywords: ['schedule', 'autonomous', 'cron', 'pause', 'resume', 'stop'],
    help: 'autonomous-rooms',
  },

  // --- Moderation ------------------------------------------------------------
  {
    id: 'on-duty',
    group: 'moderation',
    title: 'On Duty',
    description: 'Whether the Concierge is at his post at all, or has gone off to see a man about a dog.',
    persona: 'concierge',
    keywords: ['enable', 'disable', 'moderation', 'off duty', 'censor'],
    defaultOpen: true,
    help: 'the-concierge',
  },
  {
    id: 'uncensored-desk',
    group: 'moderation',
    title: 'The Uncensored Desk',
    description: 'The less squeamish parties the Concierge sends for when the usual providers clutch their pearls.',
    persona: 'concierge',
    keywords: ['uncensored', 'nsfw', 'failover', 'refusal', 'censor', 'adult'],
    defaultOpen: true,
    help: 'the-concierge',
  },
  {
    id: 'refusals',
    group: 'moderation',
    title: 'When a Provider Refuses',
    description: 'How many polite refusals the Concierge endures before he moves a chat along, and how new chats begin.',
    persona: 'concierge',
    keywords: ['refusal', 'refuse', 'auto-switch', 'moderated', 'censor'],
    defaultOpen: true,
    help: 'the-concierge',
  },
  {
    id: 'display',
    group: 'moderation',
    title: 'Display',
    description: 'Whether flagged content is laid out on the table, draped in gauze, or tucked discreetly behind a curtain.',
    persona: 'concierge',
    keywords: ['blur', 'hide', 'flagged', 'nsfw', 'danger', 'censor'],
    defaultOpen: true,
    help: 'the-concierge',
  },
  {
    id: 'pre-screening',
    group: 'moderation',
    title: 'Pre-Screening (Advanced)',
    description: 'An optional doorman who reads every message before it goes in, at the price of a call apiece.',
    persona: 'concierge',
    keywords: ['classifier', 'pre-screen', 'screening', 'moderation', 'censor'],
    advanced: true,
    help: 'the-concierge',
  },

  // --- Appearance ------------------------------------------------------------
  {
    id: 'appearance',
    group: 'appearance',
    title: 'Appearance',
    description: 'Theme selection, color mode, and display options',
    persona: 'calliope',
    keywords: ['theme', 'dark mode', 'light mode', 'color', 'font', 'look'],
    help: 'appearance-settings',
  },
  {
    id: 'avatar-settings',
    group: 'appearance',
    title: 'Avatar Settings',
    description: 'Configure avatar display mode and style',
    persona: 'aurora',
    keywords: ['avatar', 'portrait', 'picture', 'icon'],
    help: 'appearance-settings',
  },
  {
    id: 'tags',
    group: 'appearance',
    title: 'Tags',
    description: 'Create and manage tags for organizing your content',
    persona: 'calliope',
    keywords: ['tag', 'label', 'organize', 'category'],
    help: 'tags-customization',
  },

  // --- Security --------------------------------------------------------------
  {
    id: 'encryption-passphrase',
    group: 'security',
    title: 'Encryption Passphrase',
    description: 'Change or remove the passphrase (the password) protecting your encryption key',
    persona: 'saquel',
    keywords: ['password', 'passphrase', 'encryption', 'lock', 'security'],
    help: 'database-protection',
  },
  {
    id: 'auto-lock',
    group: 'security',
    title: 'Auto-Lock',
    description: 'Automatically lock Quilltap after a period of inactivity',
    persona: 'saquel',
    keywords: ['lock', 'timeout', 'idle', 'inactivity', 'password'],
    help: 'database-protection',
  },
  {
    id: 'delete-all-data',
    group: 'security',
    title: 'Delete All Data',
    description: 'Permanently delete all application data',
    persona: 'saquel',
    keywords: ['delete', 'wipe', 'erase', 'reset', 'destroy'],
    advanced: true,
    help: 'system-delete-data',
  },

  // --- Data & Maintenance ----------------------------------------------------
  {
    id: 'plugins',
    group: 'data-maintenance',
    title: 'Plugins',
    description: 'Install and manage plugins',
    persona: 'forge',
    keywords: ['plugin', 'extension', 'install', 'npm', 'add-on'],
    help: 'plugins',
  },
  {
    id: 'backup-restore',
    group: 'data-maintenance',
    title: 'Backup & Restore',
    description: 'Create and restore backups of your data',
    persona: 'prospero',
    keywords: ['backup', 'restore', 'save', 'archive', 'recover'],
    help: 'system-backup-restore',
  },
  {
    id: 'import-export',
    group: 'data-maintenance',
    title: 'Import / Export',
    description: 'Import and export characters, chats, and settings',
    persona: 'prospero',
    keywords: ['import', 'export', 'qtap', 'sillytavern', 'transfer'],
    help: 'system-import-export',
  },
  {
    id: 'llm-logging',
    group: 'data-maintenance',
    title: 'LLM Logging',
    description: 'Configure LLM request logging',
    persona: 'prospero',
    keywords: ['logging', 'log', 'debug', 'request', 'record'],
    help: 'system-llm-logs',
  },
  {
    id: 'llm-logs',
    group: 'data-maintenance',
    title: 'LLM Logs',
    description: 'View detailed logs of LLM requests and responses',
    persona: 'prospero',
    keywords: ['logs', 'request', 'response', 'debug', 'history'],
    help: 'system-llm-logs',
  },
  {
    id: 'tasks-queue',
    group: 'data-maintenance',
    title: 'Tasks Queue',
    description: 'View and manage background tasks',
    persona: 'prospero',
    keywords: ['task', 'job', 'queue', 'background', 'failed'],
    help: 'system-tasks-queue',
  },
  {
    // `capabilities-report` is the historical anchor the help docs point at.
    id: 'capabilities-report',
    group: 'data-maintenance',
    title: 'The Almanack (System Report)',
    description: 'A compendium of the whole establishment — configuration, contents and condition',
    persona: 'prospero',
    keywords: ['almanack', 'report', 'capabilities', 'diagnostics', 'system info'],
    help: 'the-almanack',
  },
]

// ============================================================================
// Lookups
// ============================================================================

const GROUP_BY_ID = new Map<SettingsGroupId, SettingsGroup>(SETTINGS_GROUPS.map((g) => [g.id, g]))
const CARD_BY_ID = new Map<string, SettingsCard>(SETTINGS_CARDS.map((c) => [c.id, c]))

export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = 'connections'

export function getSettingsGroup(id: string | null | undefined): SettingsGroup | undefined {
  return id ? GROUP_BY_ID.get(id as SettingsGroupId) : undefined
}

export function getSettingsCard(id: string | null | undefined): SettingsCard | undefined {
  return id ? CARD_BY_ID.get(id) : undefined
}

export function isSettingsGroupId(id: string | null | undefined): id is SettingsGroupId {
  return !!id && GROUP_BY_ID.has(id as SettingsGroupId)
}

/** Cards hosted inside another card's body. */
export function hostedCardsOf(hostId: string): SettingsCard[] {
  return SETTINGS_CARDS.filter((c) => c.hostedBy === hostId)
}

/** Personas that own at least one card — the lens can be any of them. */
export function personasWithCards(): SettingsPersona[] {
  return Array.from(new Set(SETTINGS_CARDS.map((c) => c.persona)))
}

export function isSettingsPersona(id: string | null | undefined): id is SettingsPersona {
  return !!id && SETTINGS_CARDS.some((c) => c.persona === id)
}

// ============================================================================
// Legacy bridge — the eight-tab URLs (`?tab=&section=`) land forever
// ============================================================================

export type LegacyTabId =
  | 'providers'
  | 'chat'
  | 'concierge'
  | 'appearance'
  | 'memory'
  | 'images'
  | 'templates'
  | 'system'

export const LEGACY_TAB_TO_GROUP: Record<LegacyTabId, SettingsGroupId> = {
  providers: 'connections',
  chat: 'composer-display',
  concierge: 'moderation',
  appearance: 'appearance',
  memory: 'context-memory',
  images: 'images',
  templates: 'characters-prompts',
  system: 'data-maintenance',
}

/** Section ids that no longer exist as cards, mapped to the card that now holds them. */
export const LEGACY_SECTION_ALIASES: Readonly<Record<string, string>> = {
  // The Courier's settings live inside the connection-profile modal.
  'the-courier': 'connection-profiles',
  // The three cards the memory Maintenance card replaced.
  'memory-housekeeping': 'memory-maintenance',
  'memory-consolidation': 'memory-maintenance',
  'memory-deduplication': 'memory-maintenance',
}

export interface ResolvedSettingsLink {
  group: SettingsGroupId
  card?: string
}

type ParamsLike = Pick<URLSearchParams, 'get'>

/**
 * Resolve a settings URL's query to a group and (optionally) a card.
 *
 * - `section` (a card id, or a legacy alias) wins: its group is derived and a
 *   disagreeing `group=` / `tab=` is ignored.
 * - else `group=` names a group directly.
 * - else a legacy `tab=` resolves through `LEGACY_TAB_TO_GROUP`.
 *
 * Returns null when nothing names a place (bare `/settings`), leaving the
 * default-group rule to the caller.
 */
export function resolveSettingsLink(params: ParamsLike): ResolvedSettingsLink | null {
  const section = params.get('section')
  if (section) {
    const card = getSettingsCard(LEGACY_SECTION_ALIASES[section] ?? section)
    if (card) return { group: card.group, card: card.id }
  }
  const group = params.get('group')
  if (isSettingsGroupId(group)) return { group }
  const tab = params.get('tab')
  if (tab && tab in LEGACY_TAB_TO_GROUP) return { group: LEGACY_TAB_TO_GROUP[tab as LegacyTabId] }
  return null
}

/** Resolve a full `/settings…` href. Returns null for any other path or an unresolvable query. */
export function resolveSettingsHref(href: string): ResolvedSettingsLink | null {
  const [pathAndQuery] = href.split('#')
  const qIdx = pathAndQuery.indexOf('?')
  const path = qIdx < 0 ? pathAndQuery : pathAndQuery.slice(0, qIdx)
  if (path !== '/settings') return null
  return resolveSettingsLink(new URLSearchParams(qIdx < 0 ? '' : pathAndQuery.slice(qIdx + 1)))
}

// ============================================================================
// Building URLs
// ============================================================================

export { settingsGroupHref, settingsCardHref, settingsPersonaHref, settingsSearchHref } from './hrefs'

// ============================================================================
// Search
// ============================================================================

/** Lower-case and strip diacritics so "Saquel" and "saquél" meet. */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function searchTerms(query: string): string[] {
  return foldForSearch(query).split(/\s+/).map((t) => t.trim()).filter(Boolean)
}

/**
 * Cards matching every term of `query`. A term may match the card's title,
 * description, keywords, its group's title, or its persona's display name
 * (`personaName` returns the theme-resolved name, so a renamed Saquel still
 * matches). An empty query matches nothing.
 */
export function searchSettingsCards(
  query: string,
  personaName: (persona: SettingsPersona) => string = (p) => DEFAULT_SUBSYSTEM_DEFINITIONS[p].name,
): SettingsCard[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  return SETTINGS_CARDS.filter((card) => {
    const haystack = foldForSearch(
      [
        card.title,
        card.description,
        ...card.keywords,
        GROUP_BY_ID.get(card.group)?.title ?? '',
        personaName(card.persona),
      ].join('\n'),
    )
    return terms.every((term) => haystack.includes(term))
  })
}
