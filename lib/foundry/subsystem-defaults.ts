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
  | 'lantern';

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
 * The `foundry` entry is the hub page itself; the remaining 8 entries
 * are the child subsystem pages displayed as cards on the hub.
 */
export const DEFAULT_SUBSYSTEM_DEFINITIONS: Record<SubsystemId, SubsystemDefinition> = {
  foundry: {
    id: 'foundry',
    name: 'The Foundry',
    description: 'Configure and manage every aspect of your workspace',
    href: '/foundry',
    thumbnail: '/images/thumbnails/foundry.webp',
    backgroundImage: '/images/foundry.webp',
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Roleplay templates and prompt configuration',
    href: '/foundry/aurora',
    thumbnail: '/images/thumbnails/aurora.webp',
    backgroundImage: '/images/aurora.webp',
  },
  forge: {
    id: 'forge',
    name: 'The Forge',
    description: 'API keys, connections, plugins, storage, and data management',
    href: '/foundry/forge',
    thumbnail: '/images/thumbnails/foundry.webp',
    backgroundImage: '/images/foundry.webp',
  },
  salon: {
    id: 'salon',
    name: 'The Salon',
    description: 'Chat behavior, avatars, compression, and automation settings',
    href: '/foundry/salon',
    thumbnail: '/images/thumbnails/salon.webp',
    backgroundImage: '/images/salon.webp',
  },
  'commonplace-book': {
    id: 'commonplace-book',
    name: 'The Commonplace Book',
    description: 'Embedding profiles and memory deduplication',
    href: '/foundry/commonplace-book',
    thumbnail: '/images/thumbnails/commonplace_book.webp',
    backgroundImage: '/images/commonplace_book.webp',
  },
  prospero: {
    id: 'prospero',
    name: 'Prospero',
    description: 'Task queue, capabilities report, and LLM logs',
    href: '/foundry/prospero',
    thumbnail: '/images/thumbnails/prospero.webp',
    backgroundImage: '/images/prospero.webp',
  },
  dangermouse: {
    id: 'dangermouse',
    name: 'Dangermouse',
    description: 'Dangerous content detection and routing settings',
    href: '/foundry/dangermouse',
    thumbnail: '/images/thumbnails/dangermouse.webp',
    backgroundImage: '/images/dangermouse.webp',
  },
  calliope: {
    id: 'calliope',
    name: 'Calliope',
    description: 'Appearance, themes, and tag management',
    href: '/foundry/calliope',
    thumbnail: '/images/thumbnails/calliope.webp',
    backgroundImage: '/images/calliope.webp',
  },
  lantern: {
    id: 'lantern',
    name: 'The Lantern',
    description: 'Image profiles and story background settings',
    href: '/foundry/lantern',
    thumbnail: '/images/thumbnails/lantern.webp',
    backgroundImage: '/images/lantern.webp',
  },
};

/**
 * Ordered list of child subsystem IDs (excluding the hub itself).
 * This controls the display order on the Foundry hub page.
 */
export const CHILD_SUBSYSTEM_IDS: SubsystemId[] = [
  'aurora',
  'forge',
  'salon',
  'commonplace-book',
  'prospero',
  'dangermouse',
  'calliope',
  'lantern',
];
