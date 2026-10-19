/**
 * What every `inventory_*` tool handler shares: the context they run in, the
 * one context load per call, the object summary every mutation returns, the
 * failure envelope and the read-only refusal for shared objects. Mirrors
 * `wardrobe-handler-shared.ts`.
 *
 * Every reference resolves through `resolveInventoryRef`
 * (`lib/inventory/refs.ts`); nothing here re-derives id-or-title-or-name.
 *
 * @module tools/handlers/inventory-handler-shared
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { InventoryOffRosterError, InventoryRefusal } from '@/lib/inventory/errors';
import { loadInventoryContext, type LoadedInventoryContext } from '@/lib/inventory/context';
import type { EquipChat, InventoryChangeContext } from '@/lib/inventory/equip';
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve';
import { resolveInventoryRef, type InventoryRefMatch, type InventoryState } from '@/lib/inventory/refs';
import type { WardrobeTurnContainers } from '@/lib/wardrobe/turn-containers';
import type { InventoryToolTier } from '../inventory-list-tool';

/**
 * The context every `inventory_*` tool runs in. The executor builds it once
 * from the tool-execution context, so the turn's pending Inventory
 * announcements reach every tool that changes what a character carries.
 */
export interface InventoryToolContext extends Pick<WardrobeTurnContainers, 'pendingInventoryAnnouncements'> {
  userId: string;
  chatId: string;
  /** The calling character — the one whose bag every read and write uses. */
  characterId: string;
}

/** The full repository container the handlers operate on. */
export type InventoryRepos = ReturnType<typeof getRepositories>;

/** An object as every mutation reports it, so the model can chain calls without a list. */
export interface InventoryObjectSummary {
  id: string;
  name: string;
  title: string | null;
  /** Null for an archetype. */
  state: InventoryState | null;
  tier: InventoryToolTier;
  kind: 'item' | 'kit' | 'archetype';
}

/** Where an object lives, from the caller's side. */
export function tierOf(item: Pick<ResolvedInventoryItem, 'origin'>, own: boolean): InventoryToolTier {
  if (own) return 'own';
  const scope = item.origin?.scope;
  if (scope === 'group' || scope === 'general') return scope;
  return 'project';
}

export function kindOf(item: Pick<ResolvedInventoryItem, 'isArchetype' | 'kind'>): InventoryObjectSummary['kind'] {
  if (item.isArchetype) return 'archetype';
  return item.kind === 'kit' ? 'kit' : 'item';
}

/** An object's state from what the caller knows: equipped, own, archetype. */
export function stateFor(item: Pick<ResolvedInventoryItem, 'isArchetype'>, own: boolean, equipped: boolean): InventoryState | null {
  if (item.isArchetype) return null;
  if (equipped) return 'equipped';
  return own ? 'carried' : 'reachable';
}

export function summarize(item: ResolvedInventoryItem, own: boolean, equipped: boolean): InventoryObjectSummary {
  return {
    id: item.id,
    name: item.name,
    title: item.title?.trim() || null,
    state: stateFor(item, own, equipped),
    tier: tierOf(item, own),
    kind: kindOf(item),
  };
}

export function summarizeMatch(match: InventoryRefMatch): InventoryObjectSummary {
  return summarize(match.item, match.own, match.equipped);
}

/** One line naming an object for the model: `Excalibur (sword) [id] — equipped, own`. */
export function formatSummary(summary: InventoryObjectSummary): string {
  const label = inventoryDisplayName({ name: summary.name, title: summary.title });
  const state = summary.state ?? 'archetype';
  return `${label} [${summary.id}] — ${state}, ${summary.tier}`;
}

/** The context load a tool call does once. */
export function loadToolInventory(repos: InventoryRepos, context: InventoryToolContext): Promise<LoadedInventoryContext> {
  return loadInventoryContext(repos, context.characterId, context.chatId);
}

/** The chat as the equip chokepoints take it, or null. */
export async function loadToolChat(repos: InventoryRepos, chatId: string): Promise<EquipChat | null> {
  return ((await repos.chats.findById(chatId)) as EquipChat | null) ?? null;
}

/** The change context for a character's own gesture: announced, joined to the turn. */
export function characterChangeContext(context: InventoryToolContext): InventoryChangeContext {
  return {
    userId: context.userId,
    provenance: 'character',
    announce: true,
    ...(context.pendingInventoryAnnouncements ? { pendingInventoryAnnouncements: context.pendingInventoryAnnouncements } : {}),
  };
}

/** Resolve a ref over the call's context. */
export function resolveToolRef(
  ctx: LoadedInventoryContext,
  ref: string,
  opts: { includeArchetypes?: boolean; includeArchived?: boolean } = {},
): InventoryRefMatch[] {
  return resolveInventoryRef(ref, ctx.pool, ctx.equippedIds, opts);
}

/**
 * When a ref names an object on a project shelf the roster has closed to this
 * character (`roster-gate.ts`), Pascal's refusal saying so; null otherwise.
 * `archetypesOnly` asks only after archetypes (a pick-up).
 */
export function closedShelfMessage(ctx: LoadedInventoryContext, ref: string, opts: { archetypesOnly?: boolean } = {}): string | null {
  if (ctx.closedShelf.length === 0) return null;
  const matches = resolveInventoryRef(ref, { items: ctx.closedShelf, owns: () => false }, ctx.equippedIds, { includeArchetypes: true })
    .filter((m) => !opts.archetypesOnly || m.item.isArchetype);
  if (matches.length === 0) return null;
  return new InventoryOffRosterError([inventoryLabel(matches[0].item)]).message;
}

/** The refusal for an object that resolved to nothing. */
export function inventoryNotFoundMessage(ref: string): string {
  return `No object "${ref}" is in your inventory or within reach. Use inventory_list to see what there is.`;
}

/** The refusal for a change to an object in a shared store. */
export function sharedInventoryItemReadOnlyMessage(item: Pick<ResolvedInventoryItem, 'name' | 'title'>, verb: 'changed' | 'archived' | 'given'): string {
  return (
    `"${inventoryLabel(item)}" lives in a shared store — you can carry it but not edit, archive or give it. ` +
    `Only objects in your own vault can be ${verb}.`
  );
}

/** A refusal's own words, or a generic message for anything else. */
export function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof InventoryRefusal) return error.message;
  return error instanceof Error ? error.message : fallback;
}

/** The one debug line every handler writes (refusals log at info). */
export function logInventoryTool(
  tool: string,
  context: InventoryToolContext,
  data: { refs?: readonly string[]; resolved?: readonly string[]; outcome: string; [key: string]: unknown },
  level: 'debug' | 'info' = 'debug',
): void {
  logger[level](`[InventoryTools] ${tool}`, {
    context: 'inventory-tools',
    chatId: context.chatId,
    characterId: context.characterId,
    tool,
    ...data,
  });
}
