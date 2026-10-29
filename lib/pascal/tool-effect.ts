/**
 * A custom tool's effect on the world, derived from its definition.
 *
 * A custom tool is `read` unless it carries effects — a `state` / `progress`
 * write, a wardrobe or inventory gesture, or a log line — in which case it is
 * `write`. Rolling, consulting an LLM and posting the outcome are reporting,
 * not side effects. No custom tool deletes anything, so none is `destroy`.
 *
 * Pure and client-safe: the Workbench shows the derived effect, the bid prompt
 * lists it, and `run_custom`'s computed effect and the trigger runner enforce it.
 *
 * @module pascal/tool-effect
 */

import type { ToolEffect } from '@/lib/tools/effect-types';
import {
  isInventoryEffect,
  isLogEffect,
  isWardrobeEffect,
  isWriteEffect,
  type QtapCustomTool,
} from './custom-tool.types';

export function customToolEffect(definition: Pick<QtapCustomTool, 'effects'>): ToolEffect {
  const writes = (definition.effects ?? []).some(
    (effect) => isWriteEffect(effect) || isWardrobeEffect(effect) || isInventoryEffect(effect) || isLogEffect(effect)
  );
  return writes ? 'write' : 'read';
}

/** Custom tool name → derived effect, for a resolved roster. */
export function customToolEffectMap(
  tools: Iterable<{ name: string; definition: Pick<QtapCustomTool, 'effects'> }>
): Map<string, ToolEffect> {
  const map = new Map<string, ToolEffect>();
  for (const tool of tools) map.set(tool.name, customToolEffect(tool.definition));
  return map;
}
