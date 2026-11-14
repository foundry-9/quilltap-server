/**
 * Foundry Subsystem Defaults
 *
 * Single source of truth for all subsystem identifiers, display names,
 * descriptions, thumbnails, and background images. Theme plugins can
 * override names, descriptions, and images via the `subsystems` field
 * in the ThemePlugin interface.
 *
 * @module lib/foundry/subsystem-defaults
 */

import { settingsPersonaHref } from '@/lib/settings/hrefs';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Unique identifier for each Foundry subsystem.
 */
export type SubsystemId =
  | 'foundry'
  | 'aurora'
  | 'forge'
  | 'salon'
  | 'commonplace-book'
  | 'prospero'
  | 'concierge'
  | 'calliope'
  | 'lantern'
  | 'pascal'
  | 'saquel'
  | 'brahma'
  | 'scriptorium';

/**
 * Static definition of a Foundry subsystem.
 */
export interface SubsystemDefinition {
  /** Unique subsystem identifier */
  id: SubsystemId;
  /** Display name shown in the UI */
  name: string;
  /** Short description of the subsystem */
  description: string;
  /** Navigation path */
  href: string;
  /** Thumbnail image shown on the Foundry hub card */
  thumbnail: string;
  /** Full-page background image used on the subsystem page */
  backgroundImage: string;
}

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Default definitions for all Foundry subsystems.
 *
 * The `foundry` entry is the Settings page itself; `scriptorium` has its own
 * page; the rest are the personas whose badges the settings cards wear.
 */
export const DEFAULT_SUBSYSTEM_DEFINITIONS: Record<SubsystemId, SubsystemDefinition> = {
  foundry: {
    id: 'foundry',
    name: 'The Foundry',
    description: 'Configure and manage every aspect of your workspace',
    href: '/settings',
    thumbnail: '/images/thumbnails/foundry.webp',
    backgroundImage: '/images/foundry.webp',
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Roleplay templates, prompts, the Core whisper, and avatars',
    href: settingsPersonaHref('aurora'),
    thumbnail: '/images/thumbnails/aurora.webp',
    backgroundImage: '/images/aurora.webp',
  },
  forge: {
    id: 'forge',
    name: 'The Forge',
    description: 'Providers, connection profiles, the cheap LLM, and plugins',
    href: settingsPersonaHref('forge'),
    thumbnail: '/images/thumbnails/foundry.webp',
    backgroundImage: '/images/foundry.webp',
  },
  salon: {
    id: 'salon',
    name: 'The Salon',
    description: 'The composer, how the conversation is shown, context, Taboo, and the autonomous rooms',
    href: settingsPersonaHref('salon'),
    thumbnail: '/images/thumbnails/salon.webp',
    backgroundImage: '/images/salon.webp',
  },
  'commonplace-book': {
    id: 'commonplace-book',
    name: 'The Commonplace Book',
    description: 'Memory: embeddings, extraction, recall, and maintenance',
    href: settingsPersonaHref('commonplace-book'),
    thumbnail: '/images/thumbnails/commonplace_book.webp',
    backgroundImage: '/images/commonplace_book.webp',
  },
  prospero: {
    id: 'prospero',
    name: 'Prospero',
    description: 'Agent mode, backups, logs, the task queue, and the Almanack',
    href: settingsPersonaHref('prospero'),
    thumbnail: '/images/thumbnails/prospero.webp',
    backgroundImage: '/images/prospero.webp',
  },
  concierge: {
    id: 'concierge',
    name: 'The Concierge',
    description: 'Who gets asked when the usual providers refuse, and how flagged content is shown',
    href: settingsPersonaHref('concierge'),
    thumbnail: '/images/thumbnails/concierge.webp',
    backgroundImage: '/images/concierge.webp',
  },
  calliope: {
    id: 'calliope',
    name: 'Calliope',
    description: 'Themes, appearance, and tags',
    href: settingsPersonaHref('calliope'),
    thumbnail: '/images/thumbnails/calliope.webp',
    backgroundImage: '/images/calliope.webp',
  },
  lantern: {
    id: 'lantern',
    name: 'The Lantern',
    description: 'Image profiles, story backgrounds, wardrobe pictures, and image description',
    href: settingsPersonaHref('lantern'),
    thumbnail: '/images/thumbnails/lantern.webp',
    backgroundImage: '/images/lantern.webp',
  },
  pascal: {
    id: 'pascal',
    name: 'Pascal the Croupier',
    description: 'Random number generation, dice, and game state tracking',
    href: settingsPersonaHref('pascal'),
    thumbnail: '/images/thumbnails/pascal.webp',
    backgroundImage: '/images/pascal.webp',
  },
  saquel: {
    id: 'saquel',
    name: 'Saquel Ytzama the Keeper of Secrets',
    description: 'API keys, the encryption passphrase, and the auto-lock',
    href: settingsPersonaHref('saquel'),
    thumbnail: '/images/thumbnails/saquel.webp',
    backgroundImage: '/images/saquel.webp',
  },
  brahma: {
    id: 'brahma',
    name: 'Brahma',
    description: 'The Console — a plain model surface with no character and no memory',
    href: settingsPersonaHref('brahma'),
    thumbnail: '/images/thumbnails/brahma.webp',
    backgroundImage: '/images/brahma.webp',
  },
  scriptorium: {
    id: 'scriptorium',
    name: 'The Scriptorium',
    description: 'Document stores and external knowledge sources',
    href: '/scriptorium',
    thumbnail: '/images/thumbnails/scriptorium.webp',
    backgroundImage: '/images/scriptorium.webp',
  },
};

/**
 * Ordered list of the personas shown in the Foundry's persona row on
 * `/settings`. Each one is a lens over the whole page (`?persona=<id>`):
 * choosing it filters every group to that persona's cards, wherever they live.
 * Every id here must own at least one card in `lib/settings/registry.ts`.
 */
export const CHILD_SUBSYSTEM_IDS: SubsystemId[] = [
  'forge',
  'saquel',
  'salon',
  'commonplace-book',
  'aurora',
  'lantern',
  'pascal',
  'prospero',
  'brahma',
  'concierge',
  'calliope',
];
