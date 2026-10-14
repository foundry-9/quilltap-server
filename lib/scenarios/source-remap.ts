/**
 * Scenario source remapping — carrying a chat's `scenarioSource` across an
 * import or a new-account restore, where mount-point ids change.
 *
 * A source is only worth keeping while its mount exists: one whose mount did
 * not come across (a chat-only export, say) is dropped to null rather than
 * left dangling, and the in-chat control then falls back to inferring the
 * preset by body, as it does for chats from before sources were recorded.
 *
 * Client-safe (no node imports).
 *
 * @module lib/scenarios/source-remap
 */

import { ScenarioSourceSchema, type ScenarioSource } from '@/lib/schemas/chat.types';

/**
 * Parse whatever a bundle carried in `scenarioSource` (an object, a JSON
 * string from a raw row, or nothing) into a valid source, or null.
 */
export function readScenarioSource(value: unknown): ScenarioSource | null {
  if (value === null || value === undefined || value === '') return null;
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = ScenarioSourceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Re-point a source at its mount's new id. `mapMount` answers the new id, or
 * null when the mount is not in this instance — in which case the source is
 * dropped.
 */
export function remapScenarioSource(
  value: unknown,
  mapMount: (mountPointId: string) => string | null,
): ScenarioSource | null {
  const source = readScenarioSource(value);
  if (!source) return null;
  const mountPointId = mapMount(source.mountPointId);
  return mountPointId ? { ...source, mountPointId } : null;
}
