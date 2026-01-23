/**
 * Plugin Configuration Type Definitions
 *
 * Contains schemas for per-user plugin configuration storage.
 * Used by TOOL_PROVIDER plugins and other plugins that need user settings.
 *
 * @module schemas/plugin-config.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// PLUGIN CONFIGURATION
// ============================================================================

/**
 * Schema for a single plugin configuration entry.
 * Stores per-user settings for a specific plugin.
 */
export const PluginConfigSchema = z.object({
  /** Unique ID for this config entry */
  id: UUIDSchema,

  /** User who owns this configuration */
  userId: z.string().min(1),

  /** Plugin name (e.g., "qtap-plugin-curl") */
  pluginName: z.string().min(1).max(200),

  /** Configuration values as key-value pairs */
  config: z.record(z.unknown()),

  /** Whether the plugin is enabled for this user (overrides global setting) */
  enabled: z.boolean().optional(),

  /** ISO-8601 timestamp when this config was created */
  createdAt: TimestampSchema,

  /** ISO-8601 timestamp when this config was last updated */
  updatedAt: TimestampSchema,
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

/**
 * Schema for creating or updating plugin configuration.
 * Does not include id, createdAt, updatedAt which are managed by the repository.
 */
export const PluginConfigInputSchema = PluginConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PluginConfigInput = z.infer<typeof PluginConfigInputSchema>;
