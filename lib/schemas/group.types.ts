/**
 * Group Type Definitions
 *
 * A "Group" is a cross-section of *characters*, parallel to how a Project is a
 * cross-section of files/chats. Each group owns an *official* document store
 * holding `description.md`, a `Scenarios/` folder, and a `Knowledge/` folder,
 * plus zero-or-more *additional linked* stores. Group Description / Scenarios /
 * Knowledge surface into chats, the Commonplace Book, and the search tool for
 * the *responding* character's group memberships.
 *
 * Mirrors the project-store cutover: a group's substantive content does not live
 * in `groups` columns. The DB row is the slim `GroupRowSchema`
 * (id/name/officialMountPointId/timestamps); everything else lives in the
 * group's official document store as files:
 *   - description  → description.md
 *   - instructions → instructions.md
 *   - state        → state.json
 *   - the settings bag (GroupPropertiesSchema) → properties.json
 *
 * `GroupSchema` below is the *hydrated*, app-facing shape — the read overlay
 * (`lib/groups/group-store/read-overlay.ts`) re-assembles it from the slim row
 * plus the store files.
 *
 * @module schemas/group.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  HexColorSchema,
  JsonSchema,
} from './common.types';

// ============================================================================
// GROUP
// ============================================================================

/**
 * The "everything else" bag persisted as `properties.json` in the group's
 * official document store. All fields optional/defaulted so a partial or absent
 * file still parses. Kept minimal; add fields only as the UI needs them.
 */
export const GroupPropertiesSchema = z.object({
  // Display customization
  color: HexColorSchema.nullable().optional(), // Accent color for sidebar/UI
  icon: z.string().max(50).nullable().optional(), // Icon identifier (emoji or icon name)
});

export type GroupProperties = z.infer<typeof GroupPropertiesSchema>;

/**
 * The slim DB row — the only thing persisted as `groups` columns. A composition
 * building block for `GroupSchema`; the repository validates the full hydrated
 * schema and strips the store-resident fields (`GROUP_STORE_MANAGED_FIELDS`)
 * before writing the row.
 */
export const GroupRowSchema = z.object({
  id: UUIDSchema,

  // The one content field that stays a real column.
  name: z.string().min(1).max(100),

  /**
   * The group's canonical "group-official" document store, holding
   * `description.md`, the `Scenarios/` folder, and the `Knowledge/` folder.
   * Auto-populated for new groups at creation time and re-ensured on startup.
   * Null only briefly during creation transitions; reads block (throw/drop)
   * when it is null or unreadable.
   */
  officialMountPointId: UUIDSchema.nullable().optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GroupRow = z.infer<typeof GroupRowSchema>;

export const GroupSchema = GroupRowSchema.extend({
  // Core content (store-resident: description.md / instructions.md / state.json)
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(), // System prompt for group chats
  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  // Settings bag (store-resident: properties.json)
  ...GroupPropertiesSchema.shape,
});

export type Group = z.infer<typeof GroupSchema>;

// Input type for creating groups - makes fields with defaults optional
export type GroupInput = z.input<typeof GroupSchema>;

/**
 * Top-level Group keys whose persistence is routed to the official document
 * store rather than to DB columns. The repository strips these from the row
 * before INSERT/UPDATE; the read overlay re-populates them from the store
 * files.
 *
 * `officialMountPointId` and `name` are intentionally absent — they stay real
 * columns.
 */
export const GROUP_STORE_MANAGED_FIELDS: ReadonlySet<keyof Group> = new Set<keyof Group>([
  // description.md / instructions.md / state.json
  'description',
  'instructions',
  'state',
  // properties.json
  'color',
  'icon',
]);
