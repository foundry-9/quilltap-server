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
  | 'dangermouse'
  | 'calliope'
  | 'lantern'
  | 'pascal'
  | 'saquel';

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
 * The `foundry` entry is the hub page itself; the remaining 10 entries
 * are the child subsystem pages displayed as cards on the hub.
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
    description: 'Roleplay templates and prompt configuration',
    href: '/settings?tab=templates',
    thumbnail: '/images/thumbnails/aurora.webp',
    backgroundImage: '/images/aurora.webp',
  },
  forge: {
    id: 'forge',
    name: 'The Forge',
    description: 'API keys, connections, plugins, storage, and data management',
    href: '/settings?tab=providers',
    thumbnail: '/images/thumbnails/foundry.webp',
    backgroundImage: '/images/foundry.webp',
  },
  salon: {
    id: 'salon',
    name: 'The Salon',
    description: 'Chat behavior, avatars, compression, and automation settings',
    href: '/settings?tab=chat',
    thumbnail: '/images/thumbnails/salon.webp',
    backgroundImage: '/images/salon.webp',
  },
  'commonplace-book': {
    id: 'commonplace-book',
    name: 'The Commonplace Book',
    description: 'Embedding profiles and memory deduplication',
    href: '/settings?tab=memory',
    thumbnail: '/images/thumbnails/commonplace_book.webp',
    backgroundImage: '/images/commonplace_book.webp',
  },
  prospero: {
    id: 'prospero',
    name: 'Prospero',
    description: 'Task queue, capabilities report, and LLM logs',
    href: '/settings?tab=system',
    thumbnail: '/images/thumbnails/prospero.webp',
    backgroundImage: '/images/prospero.webp',
  },
  dangermouse: {
    id: 'dangermouse',
    name: 'Dangermouse',
    description: 'Dangerous content detection and routing settings',
    href: '/settings?tab=chat',
    thumbnail: '/images/thumbnails/dangermouse.webp',
    backgroundImage: '/images/dangermouse.webp',
  },
  calliope: {
    id: 'calliope',
    name: 'Calliope',
    description: 'Appearance, themes, and tag management',
    href: '/settings?tab=appearance',
    thumbnail: '/images/thumbnails/calliope.webp',
    backgroundImage: '/images/calliope.webp',
  },
  lantern: {
    id: 'lantern',
    name: 'The Lantern',
    description: 'Image profiles and story background settings',
    href: '/settings?tab=images',
    thumbnail: '/images/thumbnails/lantern.webp',
    backgroundImage: '/images/lantern.webp',
  },
  pascal: {
    id: 'pascal',
    name: 'Pascal the Croupier',
    description: 'Random number generation, dice, and game state tracking',
    href: '/settings?tab=chat',
    thumbnail: '/images/thumbnails/pascal.webp',
    backgroundImage: '/images/pascal.webp',
  },
  saquel: {
    id: 'saquel',
    name: 'Saquel Ytzama the Keeper of Secrets',
    description: 'API key management, encryption, and secrets',
    href: '/settings?tab=system',
    thumbnail: '/images/thumbnails/saquel.webp',
    backgroundImage: '/images/saquel.webp',
  },
};

/**
 * Ordered list of child subsystem IDs shown as settings tabs.
 * dangermouse, pascal, and saquel are still valid SubsystemIds
 * (for theme compatibility) but are merged into other tabs.
 */
export const CHILD_SUBSYSTEM_IDS: SubsystemId[] = [
  'forge',
  'salon',
  'calliope',
  'commonplace-book',
  'lantern',
  'aurora',
  'prospero',
];
