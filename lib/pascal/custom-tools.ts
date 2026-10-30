/**
 * Custom Tools — discovery, tier shadowing, and the shared execution core.
 *
 * Pascal deals from a roster of user-authored pseudo-tools: `Tools/*.tool.json`
 * documents living at the root of any document store. This module finds them,
 * resolves which definition wins when several stores name the same tool, and
 * runs one — validating parameters, drawing the roll, evaluating the outcome
 * table, and rendering the message.
 *
 * Two entrances share this core: the `run_custom` tool (a model rolls) and the
 * composer popup (the human rolls). Both land on {@link executeCustomTool} so a
 * roll means the same thing whoever asked for it.
 *
 * ## Freshness
 *
 * The roster is re-resolved at every assembly point and never cached across
 * turns. A `.tool.json` added, edited, or deleted mid-chat takes effect on the
 * next LLM call and the next popup open, with no "reload tools" step. This is
 * affordable — one folder listing per mount, against the local index — and it
 * is the only correct choice: edits to a document inside a mount don't reliably
 * touch the mount index, so an index-invalidated cache would miss exactly the
 * changes users most expect to see.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { listDatabaseFiles, DatabaseStoreError } from '@/lib/mount-index/database-store';
import { readMountFileBytes } from '@/lib/mount-index/read-file';
import { FileOpError } from '@/lib/mount-index/file-op-error';
import {
  resolveTieredMountPool,
  type MountTier,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool';
import { getErrorMessage } from '@/lib/error-utils';
import { parsePath, getAtPath } from '@/lib/state/state-paths';
import {
  QtapCustomToolSchema,
  classifyPlaceholder,
  collectUnknownKeys,
  formatDefinitionIssues,
  isInventoryRef,
  isParamRef,
  isStateRef,
  parseEffectTarget,
  isWardrobeEffect,
  isInventoryEffect,
  isLogEffect,
  type CustomToolInventoryGesture,
  type InventoryEffectAction,
  type PlaceholderRef,
  type CustomToolWardrobeGesture,
  type WardrobeEffectAction,
  type WardrobeEffectMode,
  type WardrobeItemType,
  MAX_LLM_OUTPUT_LENGTH,
  MAX_ROSTER_SIZE,
  TOOLS_FOLDER,
  TOOL_FILE_SUFFIX,
  type CustomToolLlm,
  type CustomToolParameter,
  type InventoryRef,
  type EffectTarget,
  type EffectWhen,
  type LlmComparator,
  type MetadataComparator,
  type NumberOrParamRef,
  type NumericComparator,
  type OutcomeState,
  type ParamComparator,
  type ParamRef,
  type QtapCustomTool,
  type RollRange,
  type StateRef,
  type Visibility,
  type When,
  type WhenObject,
  type EffectCondition,
  effectWhenGroups,
  gateGroups,
  outcomeTableTestsLlm,
  whenGroups,
} from './custom-tool.types';
import { evaluateExpression, formatValue, parseExpression, type ExprValue } from './expressions';

export { formatValue };
import { compareOrdered, isPrimitive, metadataComparatorHolds } from './metadata-match';
import { flattenProgressions, type ProgressPrimitive } from '@/lib/progressions/engine';
import { evaluateToolGate, gateNamesProgress, hasToolGate } from './tool-gate';
import { describeAggregateValue, inventoryAggregateHolds } from './inventory-aggregate';
import {
  gateNamesInventory,
  inventoryCountHolds,
  inventoryStateHolds,
  resolveInventoryValue,
  type InventoryContext,
} from './inventory-subjects';
import { loadInventoryContext } from '@/lib/inventory/context';

/**
 * The persistent-state view a run resolves `$state` references against — the
 * merged cascade (chat → project → group → general). Always an object; an
 * entrance that has no state to offer passes `{}`.
 */
export type CustomToolState = Record<string, unknown>;

/**
 * Resolve a `$state` reference against the merged state. Pure and total: it
 * returns the value at the path when present AND of the fallback's type, and
 * the fallback otherwise. It never throws — the required fallback is exactly
 * what makes a run always dealable.
 */
export function resolveStateValue(ref: StateRef, state: CustomToolState): number | string | boolean {
  const found = getAtPath(state ?? {}, parsePath(ref.$state));
  if (typeof found === typeof ref.fallback) {
    if (typeof found === 'number') return Number.isFinite(found) ? found : ref.fallback;
    if (typeof found === 'string' || typeof found === 'boolean') return found;
  }
  return ref.fallback;
}
import { formatDiceBreakdown, parseDiceNotation, rollNotation, type DiceNotation, type DiceRollResult } from './dice';

const CONTEXT = 'pascal.custom-tools';

/**
 * Tier precedence, nearest first. A nearer tier shadows a farther one.
 *
 * There is deliberately no 'participant' tier: a tool in a character's vault
 * is that character's alone, and sharing a room with them does not deal it to
 * anybody else. Shared tools belong in a group, project, or General store.
 */
const TIER_ORDER: MountTier[] = ['character', 'group', 'project', 'global'];

/**
 * A definition found in a store, with the provenance needed to resolve
 * shadowing and to record what actually ran in `pascalMeta`.
 */
export interface DiscoveredCustomTool {
  definition: QtapCustomTool;
  tier: MountTier;
  mountPointId: string;
  mountName: string;
  /** Vault-relative path, so the UI can link to the file the user wrote. */
  definitionPath: string;
}

/** A `.tool.json` that failed to load — surfaced as a badge rather than hidden. */
export interface CustomToolLoadError {
  definitionPath: string;
  mountPointId: string;
  mountName: string;
  tier: MountTier;
  reason: string;
  /** Where loading stopped: the bytes, the JSON, the schema, or a same-store name clash. */
  stage?: 'read' | 'json' | 'schema' | 'duplicate';
  /** The clashing tool name, on a `duplicate` error. */
  name?: string;
}

/**
 * Something a mount's discovery could not look at: the `Tools/` listing
 * itself failed, or a file the listing named was gone on open. The roster
 * skips these quietly (a race, not a defect); a caller that must know every
 * definition — the inventory title lint — refuses on them instead.
 */
export interface CustomToolUnread {
  mountPointId: string;
  mountName: string;
  /** The file, or `Tools/` when the listing failed. */
  definitionPath: string;
  reason: string;
}

/** The resolved roster for one invoker's perspective. */
export interface CustomToolRoster {
  /** Runnable tools, keyed by name, after shadowing and `disabled` suppression. */
  tools: Map<string, DiscoveredCustomTool>;
  /** Definitions that could not be loaded. */
  errors: CustomToolLoadError[];
  /** Names dropped because the roster hit {@link MAX_ROSTER_SIZE}. */
  droppedForCap: string[];
}

/** Who is asking, and from where. */
export interface RosterContext {
  userId: string;
  chatId: string;
  /** The invoking character — their vault is the 'character' tier. */
  characterId?: string | null;
  characterMountPointId?: string | null;
  projectId?: string | null;
  /**
   * The invoking character's hydrated fact sheet, which availability gates are
   * answered against. Optional: a caller that already holds it (every one of
   * them does — the popup hydrates perspectives, the turn resolves a responding
   * character) passes it to spare a read, and one that doesn't leaves the
   * roster to fetch it, but only if some definition turns out to be gated.
   */
  metadata?: Record<string, unknown> | null;
  /**
   * The invoking character's Inventory context for this chat, which gates on
   * `inventory` / `inventoryCount` are answered against. Omitted → loaded
   * lazily, once, and only when a gated definition names either subject; a
   * context without a chat or character (the Workbench library), or a vault
   * that cannot be read, degrades to null — and a null context declines every
   * inventory comparator.
   */
  inventory?: InventoryContext | null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * True for a file directly inside `Tools/`.
 *
 * `listDatabaseFiles({ folder })` filters by PREFIX, so it happily returns
 * `Tools/nested/deep/x.tool.json`. Definitions and presets are a flat
 * root-level convention; a nested file is somebody's archive, not a live one.
 */
function isRootOfToolsFolder(relativePath: string): boolean {
  const rest = relativePath.slice(TOOLS_FOLDER.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

/**
 * Every file directly inside a store's `Tools/` folder, as vault-relative
 * paths. The one listing shared by definition discovery (`*.tool.json`) and
 * the preset walk (`*.settings.json`, `lib/pascal/tool-preset-pool.ts`), so
 * both read a store's folder the same way.
 *
 * A missing `Tools/` folder is the normal case — it is a lazy convention like
 * Suparṇā's `Mail/`, never scaffolded — so an on-disk ENOENT yields [] rather
 * than an error. Anything else throws, and the caller records the store as
 * unread.
 */
export async function listToolsFolderFiles(mount: {
  id: string;
  mountType: string;
  basePath: string;
}): Promise<string[]> {
  if (mount.mountType === 'database') {
    const entries = await listDatabaseFiles(mount.id, { folder: TOOLS_FOLDER });
    return entries
      .filter((e) => e.kind !== 'folder' && isRootOfToolsFolder(e.relativePath))
      .map((e) => e.relativePath);
  }

  // On-disk store (filesystem or obsidian).
  const folder = path.join(mount.basePath, TOOLS_FOLDER);
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => `${TOOLS_FOLDER}/${e.name}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }
}

/**
 * Read one definition's bytes, whichever kind of store holds it.
 *
 * Delegates to the canonical mount reader rather than reaching for the disk
 * itself: that one helper already knows every storage shape (filesystem,
 * Obsidian, database documents, database blobs) and enforces the mount-boundary
 * check, so a definition path can never wander outside its own store.
 */
async function readToolFile(
  mount: { id: string },
  relativePath: string
): Promise<string> {
  const { bytes } = await readMountFileBytes(mount.id, relativePath);
  return bytes.toString('utf-8');
}

/** A definition file's text, judged exactly as load time judges it. */
export type ToolDefinitionValidation =
  | { ok: true; definition: QtapCustomTool }
  | { ok: false; stage: 'json' | 'schema'; reason: string };

/**
 * Parse and schema-check one definition file's text. The single judgement
 * shared by discovery ({@link loadToolsFromMount}) and the `edit_custom_tool`
 * save gate, so a file the editor accepts is a file the roster loads. Unknown
 * keys are tolerated, never rejected — future keys ship under this tolerance
 * (as `effects` did) and an older build must not choke on a newer file.
 * Never throws. `where` only labels the debug logs.
 */
export function validateToolDefinitionText(
  raw: string,
  where: { mountPointId?: string; definitionPath?: string } = {}
): ToolDefinitionValidation {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return { ok: false, stage: 'json', reason: `is not valid JSON: ${getErrorMessage(error)}` };
  }

  const unknownKeys = collectUnknownKeys(parsedJson);
  if (unknownKeys.length > 0) {
    logger.debug('Custom tool carries keys this build does not know', {
      context: CONTEXT,
      ...where,
      unknownKeys,
    });
  }

  const result = QtapCustomToolSchema.safeParse(parsedJson);
  if (!result.success) {
    const reason = formatDefinitionIssues(result.error);
    logger.debug('Custom tool definition failed schema validation', {
      context: CONTEXT,
      ...where,
      reason,
    });
    return { ok: false, stage: 'schema', reason };
  }

  return { ok: true, definition: result.data };
}

/**
 * Normalise a caller's name for a definition file to its store-relative path,
 * `Tools/<stem>.tool.json`. Accepts the bare stem (`unlock`), the file name
 * (`unlock.tool.json`, suffix case-insensitive) or that file name under a
 * leading `Tools/`. Anything that would land outside the top level of `Tools/`
 * — another folder, a nested path, an empty stem — returns null: definitions
 * are a flat root-level convention (see {@link isRootOfToolsFolder}).
 */
export function toolDefinitionPathFor(file: string): string | null {
  let name = file.trim().replace(/\\/g, '/');
  const folderPrefix = `${TOOLS_FOLDER.toLowerCase()}/`;
  if (name.toLowerCase().startsWith(folderPrefix)) name = name.slice(folderPrefix.length);
  if (name.toLowerCase().endsWith(TOOL_FILE_SUFFIX)) name = name.slice(0, -TOOL_FILE_SUFFIX.length);
  if (name.length === 0 || name.includes('/') || name === '.' || name === '..') return null;
  return `${TOOLS_FOLDER}/${name}${TOOL_FILE_SUFFIX}`;
}

/**
 * Load every definition in one mount. Never throws: a broken file becomes an
 * error entry, because one malformed `.tool.json` must not take the whole
 * roster down with it.
 *
 * Exported for Pascal's Workbench, whose library view lists every store's
 * definitions — valid and broken alike — through this same read → parse →
 * validate sequence rather than a second copy of it.
 */
export async function loadToolsFromMount(
  mountPointId: string,
  tier: MountTier
): Promise<{ found: DiscoveredCustomTool[]; errors: CustomToolLoadError[]; unread: CustomToolUnread[] }> {
  const found: DiscoveredCustomTool[] = [];
  const errors: CustomToolLoadError[] = [];
  const unread: CustomToolUnread[] = [];

  const repos = getRepositories();
  const mount = await repos.docMountPoints.findById(mountPointId);
  if (!mount || !mount.enabled) return { found, errors, unread };

  const mountName = mount.name;

  let paths: string[];
  try {
    paths = (await listToolsFolderFiles(mount)).filter((p) =>
      p.toLowerCase().endsWith(TOOL_FILE_SUFFIX),
    );
  } catch (error) {
    logger.warn('Custom-tool listing failed for mount', {
      context: CONTEXT,
      mountPointId,
      mountName,
      error: getErrorMessage(error),
    });
    unread.push({ mountPointId, mountName, definitionPath: `${TOOLS_FOLDER}/`, reason: `listing failed: ${getErrorMessage(error)}` });
    return { found, errors, unread };
  }

  // Same-mount duplicate `name` is a rejection (the spec's rule 5): within one
  // store there is no tier to break the tie, so neither file can be trusted to
  // be the one the author meant.
  const nameToPath = new Map<string, string>();

  for (const relativePath of paths) {
    let raw: string;
    try {
      raw = await readToolFile(mount, relativePath);
    } catch (error) {
      // Deleted between list and read — a race, not a defect. Skip quietly,
      // but note it: a file that is listed and never opens looks just the same.
      if (
        (error instanceof FileOpError && error.code === 'SOURCE_NOT_FOUND') ||
        (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') ||
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        unread.push({ mountPointId, mountName, definitionPath: relativePath, reason: 'listed but not found on open' });
        continue;
      }
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason: `could not be read: ${getErrorMessage(error)}`, stage: 'read' });
      continue;
    }

    const validated = validateToolDefinitionText(raw, { mountPointId, definitionPath: relativePath });
    if (!validated.ok) {
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason: validated.reason, stage: validated.stage });
      continue;
    }

    const definition = validated.definition;
    const priorPath = nameToPath.get(definition.name);
    if (priorPath) {
      errors.push({
        definitionPath: relativePath,
        mountPointId,
        mountName,
        tier,
        reason: `defines "${definition.name}", which ${priorPath} in this same store already defines`,
        stage: 'duplicate',
        name: definition.name,
      });
      continue;
    }
    nameToPath.set(definition.name, relativePath);

    found.push({ definition, tier, mountPointId, mountName, definitionPath: relativePath });
  }

  return { found, errors, unread };
}

/**
 * Bucket the pool into (tier, mountPointId) pairs in precedence order.
 *
 * Exported so run presets walk the stores in exactly the order definitions do
 * (`lib/pascal/tool-preset-pool.ts`) — one precedence, not two copies of it.
 */
export function orderedMounts(pool: TieredMountPool): Array<{ tier: MountTier; mountPointId: string }> {
  const byTier: Record<MountTier, string[]> = {
    character: pool.characterMountPointId ? [pool.characterMountPointId] : [],
    // Never resolved for custom tools (see TIER_ORDER); present only because
    // the record is keyed by every MountTier.
    participant: [],
    group: pool.groupMountPointIds,
    project: pool.projectMountPointIds,
    global: pool.globalMountPointId ? [pool.globalMountPointId] : [],
  };

  const ordered: Array<{ tier: MountTier; mountPointId: string }> = [];
  for (const tier of TIER_ORDER) {
    // Same-tier collisions resolve by mount id, lexicographically — arbitrary
    // but stable, so a roster never flickers between two equally-close stores.
    for (const mountPointId of [...byTier[tier]].sort()) {
      ordered.push({ tier, mountPointId });
    }
  }
  return ordered;
}

/**
 * The invoking character's fact sheet, for the availability gates.
 *
 * Fail-soft to `{}`: a vault that cannot be read is not a reason to abandon the
 * whole roster, and an empty sheet has a defined meaning at the gate (nothing
 * qualifies, nothing is disqualified — see `lib/pascal/tool-gate.ts`).
 */
async function loadInvokerMetadata(ctx: RosterContext): Promise<Record<string, unknown>> {
  if (ctx.metadata) return ctx.metadata;
  if (!ctx.characterId) return {};

  try {
    const character = await getRepositories().characters.findById(ctx.characterId);
    return character?.metadata ?? {};
  } catch (error) {
    logger.debug('Custom-tool gates: the invoker’s fact sheet could not be read, treating it as empty', {
      context: CONTEXT,
      chatId: ctx.chatId,
      characterId: ctx.characterId,
      error: getErrorMessage(error),
    });
    return {};
  }
}

/**
 * The invoking character's Inventory, for the availability gates. Null when
 * there is no character or chat to read it for, or it cannot be read.
 */
async function loadInvokerInventory(ctx: RosterContext): Promise<InventoryContext | null> {
  if (ctx.inventory !== undefined) return ctx.inventory;
  if (!ctx.characterId || !ctx.chatId) {
    logger.debug('Custom-tool gates: no character or chat to read an inventory for; inventory tests decline', {
      context: CONTEXT,
      chatId: ctx.chatId || null,
      characterId: ctx.characterId ?? null,
    });
    return null;
  }
  try {
    const loaded = await loadInventoryContext(getRepositories(), ctx.characterId, ctx.chatId);
    logger.debug('Custom-tool gates: loaded the invoker’s inventory', {
      context: CONTEXT,
      chatId: ctx.chatId,
      characterId: ctx.characterId,
      reachable: loaded.pool.items.length,
      equipped: loaded.equippedIds.size,
    });
    return loaded;
  } catch (error) {
    logger.debug('Custom-tool gates: the invoker’s inventory could not be read; inventory tests decline', {
      context: CONTEXT,
      chatId: ctx.chatId,
      characterId: ctx.characterId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Resolve the roster for one invoker.
 *
 * Iterates tier buckets explicitly rather than flattening the pool: flattening
 * dedups into a Set and throws away the tier attribution that shadowing and
 * `pascalMeta.definitionTier` both depend on.
 */
export async function resolveCustomToolRoster(ctx: RosterContext): Promise<CustomToolRoster> {
  // No `includeParticipants`: other characters' vaults are not a tier here.
  const pool = await resolveTieredMountPool({
    userId: ctx.userId,
    characterId: ctx.characterId ?? null,
    characterMountPointId: ctx.characterMountPointId ?? null,
    projectId: ctx.projectId ?? null,
  });

  const tools = new Map<string, DiscoveredCustomTool>();
  const errors: CustomToolLoadError[] = [];
  const droppedForCap: string[] = [];
  /** Names switched off by a nearer tier. They must stay off further out. */
  const suppressed = new Set<string>();

  // Fetched at most once, and only if a gated definition actually turns up:
  // most rosters carry none, and none of them should pay for a vault read.
  let sheet: Promise<Record<string, unknown>> | null = null;
  const invokerMetadata = (): Promise<Record<string, unknown>> => {
    sheet ??= loadInvokerMetadata(ctx);
    return sheet;
  };

  // The invoker's progressions, derived from that same sheet. One clock
  // reading for the whole roster resolution, so two gates cannot disagree
  // about whether the cannon has finished charging.
  const rosterNowMs = Date.now();
  const invokerProgress = async (): Promise<Record<string, ProgressPrimitive>> =>
    flattenProgressions(await invokerMetadata(), rosterNowMs);

  // Likewise the invoker's Inventory: read at most once, and only when a gate
  // names `inventory` or `inventoryCount`.
  let bag: Promise<InventoryContext | null> | null = null;
  const invokerInventory = (): Promise<InventoryContext | null> => {
    bag ??= loadInvokerInventory(ctx);
    return bag;
  };

  for (const { tier, mountPointId } of orderedMounts(pool)) {
    const { found, errors: mountErrors } = await loadToolsFromMount(mountPointId, tier);
    errors.push(...mountErrors);

    for (const entry of found) {
      const { name } = entry.definition;

      // Nearest tier wins. Once a name is decided — by a live definition or by
      // a `disabled` tombstone — farther tiers cannot revive it.
      if (tools.has(name) || suppressed.has(name)) continue;

      // The availability gate, and it runs BEFORE `disabled` on purpose. A
      // gated-out definition makes no claim on the name at all — not even a
      // tombstone — so a farther tier may still deal one. That is the useful
      // arrangement: a character's own vault holds the variant written for
      // characters like them, and the General store holds the plain one
      // everybody else gets. `disabled`, by contrast, stays absolute; a gated
      // tombstone ("suppress this name for novices") is simply both keys at
      // once, and reads exactly as it says.
      if (hasToolGate(entry.definition)) {
        const verdict = evaluateToolGate(
          entry.definition,
          await invokerMetadata(),
          gateNamesProgress(entry.definition.availableWhen) || gateNamesProgress(entry.definition.withheldWhen)
            ? await invokerProgress()
            : undefined,
          gateNamesInventory(entry.definition.availableWhen) || gateNamesInventory(entry.definition.withheldWhen)
            ? await invokerInventory()
            : undefined
        );
        if (!verdict.available) {
          logger.debug('Custom tool withheld by its availability gate', {
            context: CONTEXT,
            name,
            tier,
            mountPointId,
            characterId: ctx.characterId ?? null,
            withheldBy: verdict.withheldBy,
            groups: gateGroups((entry.definition.availableWhen ?? entry.definition.withheldWhen)!).length,
            heldGroup: verdict.heldGroup ?? null,
          });
          continue;
        }
      }

      if (entry.definition.disabled) {
        suppressed.add(name);
        logger.debug('Custom tool suppressed by a disabled definition', {
          context: CONTEXT,
          name,
          tier,
          mountPointId,
        });
        continue;
      }

      if (tools.size >= MAX_ROSTER_SIZE) {
        droppedForCap.push(name);
        continue;
      }

      tools.set(name, entry);
    }
  }

  if (droppedForCap.length > 0) {
    // Never truncate silently — a missing tool with no explanation reads as a
    // bug in the feature rather than a cap the user can act on.
    logger.warn('Custom-tool roster hit its cap; tools were dropped', {
      context: CONTEXT,
      chatId: ctx.chatId,
      cap: MAX_ROSTER_SIZE,
      dropped: droppedForCap,
    });
  }


  return { tools, errors, droppedForCap };
}

/** Everything the Workbench library shows: every definition in every enabled store. */
export interface CustomToolLibrary {
  entries: DiscoveredCustomTool[];
  errors: CustomToolLoadError[];
  /** What discovery could not look at (see {@link CustomToolUnread}). */
  unread: CustomToolUnread[];
  /** The names of the enabled stores that were looked in. */
  storesConsulted: string[];
}

/**
 * Enumerate every definition in every enabled store — the Workbench library.
 *
 * Deliberately NOT the tiered roster: no shadowing, no `disabled` suppression,
 * no per-invoker perspective, no cap. The library is the authoring surface, so
 * it shows the whole table face up; which definition would win a given chat
 * depends on the invoker and is not this function's question to answer.
 *
 * Tier attribution is meaningless without an invoker, so every entry carries
 * `'global'` — callers should not read anything into it.
 */
export async function listAllCustomTools(): Promise<CustomToolLibrary> {
  const repos = getRepositories();
  const mounts = await repos.docMountPoints.findEnabled();

  const entries: DiscoveredCustomTool[] = [];
  const errors: CustomToolLoadError[] = [];
  const unread: CustomToolUnread[] = [];
  const storesConsulted: string[] = [];

  for (const mount of [...mounts].sort((a, b) => a.id.localeCompare(b.id))) {
    const { found, errors: mountErrors, unread: mountUnread } = await loadToolsFromMount(mount.id, 'global');
    entries.push(...found);
    errors.push(...mountErrors);
    unread.push(...mountUnread);
    storesConsulted.push(mount.name);
  }

  return { entries, errors, unread, storesConsulted };
}

// ---------------------------------------------------------------------------
// Execution core
// ---------------------------------------------------------------------------

/**
 * What an LLM invoker hands back: the model's raw answer, or the technical
 * reason there is none. The invoker never sees the author's `errorMessage` —
 * translating failure into the author's words is the execution core's job.
 */
export type LlmInvokeResult =
  | { ok: true; output: string; provider?: string; model?: string }
  | { ok: false; reason: string };

/** What the core tells an invoker about the answer it is prepared to keep. */
export interface LlmInvokeOptions {
  /**
   * The effective output cap (the definition's `maxOutput`, or the default).
   * Advisory: the real invoker scales the call's token budget from it, so a
   * long-form consult is not starved at the provider. The core still enforces
   * the cap on whatever comes back.
   */
  maxOutputChars: number;
}

/**
 * The seam between the execution core and whatever actually talks to a model.
 * Injected by the entrances (`lib/pascal/llm-consult.ts` builds the real one)
 * so the core stays pure enough to test — and so the proving bench can hand in
 * a pretend oracle instead of spending money.
 */
export type LlmInvoker = (prompt: string, options?: LlmInvokeOptions) => Promise<LlmInvokeResult>;

/**
 * The consult as the rest of a run sees it — subjects, templates, and the roll
 * record all read from this one resolution.
 */
export interface LlmConsultResult {
  /** Whether the consult produced an answer. */
  ok: boolean;
  /** The model's trimmed answer on success; the author's `errorMessage` on failure. */
  output: string;
  /** The rendered prompt actually posed — the record of what was asked. */
  prompt: string;
  /** Technical failure reason. Logged and recorded, never spoken in the fiction. */
  reason?: string;
  provider?: string;
  model?: string;
}

/** The pair `when.llm` tests and `{{llm}}` renders. */
export type LlmSubject = Pick<LlmConsultResult, 'ok' | 'output'>;

/** A run that could not be completed. Never becomes a fabricated outcome. */
export class CustomToolRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomToolRunError';
  }
}

/** Resolved parameter values, post-default and post-clamp. */
export type ResolvedParams = Record<string, number | string | boolean>;

/**
 * The random draw a run used, recorded so a held run can be recomputed with
 * the same luck (operator intervention, spec §3.1). For the range form it is
 * the UNIT draw `u ∈ [0, 1)` that is scaled into `[min, max)` — so a parameter
 * change that moves the bounds keeps a top-10% draw in the top 10% of the new
 * range. For the dice form it is the faces.
 */
export type RecordedDraw = { form: 'range'; unit: number } | { form: 'dice'; faces: number[] };

/**
 * What a draw could have produced, given the run's resolved parameters: the
 * low and high ends, each inclusive unless flagged. The range form's raw draw
 * is half-open (`[min, max)`); after rounding both ends are reachable values.
 * The hold dialog shows these so the operator knows what they are bending.
 */
export interface RunSpan {
  min: number;
  max: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
}

/** One effect's operator setting for a held run. Edited fields are literals, never expressions. */
export interface EffectPin {
  /** `auto` follows the effect's own `when`; `on` fires it regardless; `off` suppresses it. */
  mode: 'auto' | 'on' | 'off';
  /** A write's value, taken literally. */
  value?: number | string | boolean;
  /** A wardrobe or inventory gesture's references, taken literally (resolved at apply time as usual). */
  items?: string[];
  /** A log line, taken literally. */
  log?: string;
}

/**
 * Fields of a run the operator has pinned in the hold dialog. Each present key
 * replaces what the engine would have computed; everything downstream that is
 * not pinned is recomputed from it. Absent everywhere outside a held run.
 */
export interface RunPins {
  /** Range form: the raw draw, taken as given. */
  roll?: number;
  /** Dice form: the faces, one per die, clamped to [1, sides]. */
  dice?: number[];
  /** Range form: the value after modifiers. */
  value?: number;
  /** The consult's answer, in place of any consult result. */
  llmAnswer?: { ok: boolean; output: string };
  /** This outcome row wins, whatever the table says. */
  outcomeIndex?: number;
  /** The rendered message, taken literally — no placeholders re-rendered. */
  message?: string;
  state?: OutcomeState;
  /** The rendered chip label, taken literally. */
  chipLabel?: string;
  /** Per effect index (file order). */
  effects?: Record<number, EffectPin>;
}

/** Everything a run produced — enough to post the message and fill pascalMeta. */
export interface CustomToolRunResult {
  tool: string;
  params: ResolvedParams;
  rollForm: 'range' | 'dice';
  notation?: string;
  raw: number;
  diceRolls?: number[];
  value: number;
  state: OutcomeState;
  outcomeIndex: number;
  /** The rendered outcome message, templates substituted. */
  message: string;
  /** Dice breakdown, or '' for Form A. */
  diceBreakdown: string;
  visibility: Visibility;
  /**
   * The metadata keys the winning outcome tested, and what they held when it
   * was tested. Absent when the winning row consulted no metadata.
   */
  metadataTested?: MetadataTested;
  /** The LLM consult, when the definition declares one. */
  llm?: LlmConsultResult;
  /**
   * The rendered `chipLabel`, when the definition declares one — rendered once,
   * here, after outcome selection, with the same subjects as the message. Both
   * entrances copy it into `pascalMeta`; the Salon chip and the announcement
   * header read the same string, so they can never disagree.
   */
  chipLabel?: string;
  /**
   * The definition's effects, resolved (or skipped, with reasons) against this
   * run. Computed pure — the entrances apply them via
   * `applyCustomToolEffects`; the Proving Bench only ever shows them.
   * Absent when the definition declares none.
   */
  effects?: ResolvedEffect[];
  /** The random draw this run used — what a held run replays. */
  draw: RecordedDraw;
  /** What the raw draw could have been (dice: the total). Independent of any pin. */
  rollSpan: RunSpan;
  /** What the value could have been after modifiers (dice: the total). Independent of any pin. */
  valueSpan: RunSpan;
  /**
   * The consult prompt as rendered for THIS run. Equal to `llm.prompt` on an
   * ordinary run; on a replay it may differ from the prompt that produced the
   * answer in use, which is how a held run knows its answer is out of date.
   */
  llmPromptRendered?: string;
  /** When the outcome was pinned: the row the table itself would have picked. */
  tableOutcomeIndex?: number;
}

/**
 * Validate and coerce caller-supplied parameters against the declarations.
 *
 * Unknown keys are rejected rather than ignored: a model passing `bonuss: 5`
 * has misunderstood the tool, and silently rolling without the bonus would look
 * like the tool worked.
 */
export function resolveParams(
  definition: QtapCustomTool,
  supplied: Record<string, unknown> | null | undefined,
  state: CustomToolState = {},
  inventory?: InventoryContext | null
): ResolvedParams {
  const declared = definition.parameters ?? {};
  const given = supplied ?? {};

  for (const key of Object.keys(given)) {
    if (!(key in declared)) {
      throw new CustomToolRunError(
        `"${key}" is not a parameter of ${definition.name}` +
          (Object.keys(declared).length ? ` (expected: ${Object.keys(declared).join(', ')})` : ' (it takes none)')
      );
    }
  }

  const resolved: ResolvedParams = {};
  for (const [name, spec] of Object.entries(declared)) {
    resolved[name] = coerceParam(definition.name, name, spec, given[name], state, inventory);
  }
  return resolved;
}

function coerceParam(
  toolName: string,
  name: string,
  spec: CustomToolParameter,
  value: unknown,
  state: CustomToolState,
  inventory?: InventoryContext | null
): number | string | boolean {
  // An omitted parameter falls to its default, which may itself be a `$state`
  // reference resolved against the merged state, or a `$inventory` reference
  // into an object the rolling character carries (each fallback is
  // type-checked against this parameter's type at load time, so it always fits).
  if (value === undefined || value === null) {
    if (isStateRef(spec.default)) return resolveStateValue(spec.default, state);
    if (isInventoryRef(spec.default)) return resolveInventoryValue(spec.default, inventory);
    return spec.default;
  }

  switch (spec.type) {
    case 'number':
    case 'integer': {
      // Models routinely pass numbers as strings; accept that rather than
      // failing a roll over a quoting habit.
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new CustomToolRunError(`${toolName}: parameter "${name}" must be a number, got ${JSON.stringify(value)}`);
      }
      const rounded = spec.type === 'integer' ? Math.round(n) : n;
      return clamp(rounded, spec.min, spec.max);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new CustomToolRunError(`${toolName}: parameter "${name}" must be a boolean, got ${JSON.stringify(value)}`);
    }
    case 'string':
      return typeof value === 'string' ? value : String(value);
  }
}

/** Clamp into the declared range. Bounds are optional and independent. */
function clamp(value: number, min?: number, max?: number): number {
  let out = value;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

/** Resolve a roll field: literal, `$param` reference, `$state` reference, or the field's default. */
function resolveRollField(
  toolName: string,
  field: string,
  spec: NumberOrParamRef | undefined,
  params: ResolvedParams,
  fallback: number,
  state: CustomToolState,
  inventory?: InventoryContext | null
): number {
  if (spec === undefined) return fallback;

  // A `$inventory` roll field resolves to the object's (numeric) metadata or
  // its numeric fallback — never a failure, exactly as `$state` does.
  if (isInventoryRef(spec)) {
    const value = resolveInventoryValue(spec, inventory);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CustomToolRunError(
        `${toolName}: roll.${field} $inventory reference resolved to ${JSON.stringify(value)} rather than a finite number`
      );
    }
    return value;
  }

  if (isParamRef(spec)) {
    const value = params[spec.$param];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CustomToolRunError(
        `${toolName}: roll.${field} references "${spec.$param}", which resolved to ${JSON.stringify(value)} rather than a finite number`
      );
    }
    return value;
  }

  // A `$state` roll field resolves to its (numeric, load-checked) value or its
  // numeric fallback — never a failure, so a roll is always dealable.
  if (isStateRef(spec)) {
    const value = resolveStateValue(spec, state);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CustomToolRunError(
        `${toolName}: roll.${field} $state reference resolved to ${JSON.stringify(value)} rather than a finite number`
      );
    }
    return value;
  }

  if (!Number.isFinite(spec)) {
    throw new CustomToolRunError(`${toolName}: roll.${field} is not a finite number`);
  }
  return spec;
}

/**
 * A uniform float in [min, max), drawn from crypto-strength randomness.
 *
 * `randomInt` only deals in integers, so the fraction comes from 6 random bytes
 * (48 bits — comfortably more precision than a double's 52-bit mantissa needs
 * for this, and far beyond what any outcome table can distinguish).
 */
function cryptoUnit(): number {
  const bytes = randomBytes(6);
  let scaled = 0;
  for (const byte of bytes) scaled = scaled * 256 + byte;
  return scaled / 2 ** 48;
}

/**
 * Draw the raw value for Form A, honouring `$param` and `$state` bounds.
 *
 * The unit draw is always taken (or replayed), even for a degenerate range, so
 * a held run whose parameters later widen the range still has luck to scale.
 * A pinned `roll` replaces the raw draw and a pinned `value` the transform.
 */
function rollRange(
  definition: QtapCustomTool,
  range: RollRange,
  params: ResolvedParams,
  state: CustomToolState,
  inventory?: InventoryContext | null,
  unitDraw?: number,
  pins?: Pick<RunPins, 'roll' | 'value'>
): { raw: number; value: number; unit: number; rollSpan: RunSpan; valueSpan: RunSpan } {
  const min = resolveRollField(definition.name, 'min', range.min, params, 0, state, inventory);
  const max = resolveRollField(definition.name, 'max', range.max, params, 1, state, inventory);
  const multiplier = resolveRollField(definition.name, 'multiplier', range.multiplier, params, 1, state, inventory);
  const offset = resolveRollField(definition.name, 'offset', range.offset, params, 0, state, inventory);

  if (min > max) {
    throw new CustomToolRunError(
      `${definition.name}: the roll's low bound (${min}) is above its high bound (${max})`
    );
  }

  const unit = unitDraw ?? cryptoUnit();
  const raw = pins?.roll ?? (min === max ? min : min + unit * (max - min));

  // The transform order is fixed and load-bearing: multiply, then offset, then
  // round. Rounding first would quantise before the offset could shift it.
  let value = raw * multiplier;
  value = value + offset;
  if (range.round) value = Math.round(value);
  if (pins?.value !== undefined) value = pins.value;

  if (!Number.isFinite(value)) {
    throw new CustomToolRunError(`${definition.name}: the roll produced a value that is not a finite number`);
  }

  const rollSpan: RunSpan = min === max ? { min, max } : { min, max, maxExclusive: true };
  return { raw, value, unit, rollSpan, valueSpan: transformSpan(rollSpan, multiplier, offset, range.round === true) };
}

/**
 * Carry a raw span through the range form's transform (multiply, offset,
 * round). A negative multiplier swaps the ends, and with them which end is
 * open. Rounding makes both ends reachable values: the largest rounding of a
 * value strictly below `t` is `ceil(t - 0.5)`, the smallest of one strictly
 * above is `Math.round(t)` (which rounds halves up).
 */
function transformSpan(span: RunSpan, multiplier: number, offset: number, round: boolean): RunSpan {
  const low = span.min * multiplier + offset;
  const high = span.max * multiplier + offset;
  const swapped = multiplier < 0;
  const out: RunSpan =
    multiplier === 0
      ? { min: offset, max: offset }
      : swapped
        ? { min: high, max: low, ...(span.maxExclusive ? { minExclusive: true } : {}) }
        : { min: low, max: high, ...(span.maxExclusive ? { maxExclusive: true } : {}) };
  if (!round) return out;
  return {
    min: Math.round(out.min),
    max: out.maxExclusive ? Math.ceil(out.max - 0.5) : Math.round(out.max),
  };
}

/** A dice notation's reachable totals: every die low, every die high. */
function diceSpan(notation: DiceNotation): RunSpan {
  return { min: notation.count + notation.modifier, max: notation.count * notation.sides + notation.modifier };
}

/** Everything an outcome test may be posed about. */
export interface OutcomeSubjects {
  /** The final post-transform value. */
  value: number;
  /** The raw pre-transform draw. */
  roll: number;
  /** The resolved parameters, post-default and post-clamp. */
  params: ResolvedParams;
  /**
   * The rolling character's name, for `{{character}}`. Absent when nobody in
   * particular rolled — the placeholder then renders as written.
   */
  character?: string;
  /**
   * The invoking character's metadata sheet, as hydrated from their vault's
   * `metadata.json`. Absent (or `{}`) when nobody in particular rolled — every
   * `metadata` test then fails and the catch-all answers.
   */
  metadata?: Record<string, unknown>;
  /**
   * The invoking character's timed progressions, FLATTENED to the primitive
   * sheet `flattenProgressions` produces — `"cannon.percent"`, `"cannon.complete"`
   * and the rest, derived from one `nowMs` taken at run start. Absent (or `{}`)
   * when nobody in particular rolled, or when they carry no progressions; every
   * `progress` test then fails and the catch-all answers, exactly as it does
   * for a metadata key the character lacks.
   */
  progress?: Record<string, ProgressPrimitive>;
  /**
   * The LLM consult's result. Absent when the definition declares no `llm`
   * block — an `llm` test then fails soft and the table falls through.
   */
  llm?: LlmSubject;
  /**
   * The merged persistent state (chat → project → group → general) that
   * `$state` comparator operands resolve against. Absent → treated as `{}`,
   * so every `$state` operand falls to its own fallback.
   */
  state?: CustomToolState;
  /**
   * The rolling character's Inventory for this chat (`lib/inventory/refs.ts`),
   * loaded once per run. null or absent for a run nobody made, or a vault that
   * could not be read: every `inventory` / `inventoryCount` test then
   * declines, and every `$inventory` operand falls back.
   */
  inventory?: InventoryContext | null;
}

/** The metadata keys a run actually consulted, and what they held at the time. */
export type MetadataTested = Record<string, number | string | boolean>;

/**
 * Resolve a comparator operand: a literal, or the value of the parameter it
 * references.
 *
 * The reference is validated at load time, so a failure here is a regression
 * rather than an authoring error — it throws instead of quietly declining to
 * match, which would look like the table simply skipping a row.
 */
function resolveOperand(
  toolName: string,
  operand: number | string | boolean | ParamRef | StateRef | InventoryRef,
  params: ResolvedParams,
  label: string,
  state: CustomToolState,
  inventory?: InventoryContext | null
): number | string | boolean {
  // A `$state` operand resolves against the merged state, falling back to its
  // own (load-typed) fallback — it never throws, matching the metadata doctrine.
  if (isStateRef(operand)) return resolveStateValue(operand, state);
  // So does a `$inventory` operand, against the rolling character's bag.
  if (isInventoryRef(operand)) return resolveInventoryValue(operand, inventory);

  if (!isParamRef(operand)) return operand;

  const value = params[operand.$param];
  if (value === undefined) {
    throw new CustomToolRunError(
      `${toolName}: ${label} references "${operand.$param}", which is not a declared parameter`
    );
  }
  return value;
}

/** Demand a number for an ordering comparison. Load-time validation precedes this. */
function requireNumber(toolName: string, value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CustomToolRunError(
      `${toolName}: ${label} cannot be ordered — it is ${JSON.stringify(value)} rather than a finite number`
    );
  }
  return value;
}

/** Demand a string for a containment comparison. Load-time validation precedes this. */
function requireString(toolName: string, value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new CustomToolRunError(
      `${toolName}: ${label} cannot be searched — it is ${JSON.stringify(value)} rather than a string`
    );
  }
  return value;
}

/**
 * Evaluate one comparator against one subject. Keys AND together, and an
 * operand may be a `$param` reference rather than a literal.
 */
function matchesComparator(
  toolName: string,
  comparator: NumericComparator | ParamComparator,
  subject: number | string | boolean,
  subjectLabel: string,
  params: ResolvedParams,
  state: CustomToolState,
  inventory?: InventoryContext | null
): boolean {
  const operandFor = (key: keyof ParamComparator): number | string | boolean =>
    resolveOperand(
      toolName,
      (comparator as ParamComparator)[key] as number | string | boolean | ParamRef | StateRef | InventoryRef,
      params,
      `${subjectLabel} ${key}`,
      state,
      inventory
    );

  for (const key of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (comparator[key] === undefined) continue;
    const a = requireNumber(toolName, subject, subjectLabel);
    const b = requireNumber(toolName, operandFor(key), `${subjectLabel} ${key}`);
    if (!compareOrdered(key, a, b)) return false;
  }
  if (comparator.eq !== undefined && subject !== operandFor('eq')) return false;
  if (comparator.neq !== undefined && subject === operandFor('neq')) return false;

  // Containment is strict and case-sensitive here, matching eq's exactness on
  // declared values; the forgiving variant lives with the LLM subject, whose
  // text is a model's prose rather than an author's literal.
  const wide = comparator as ParamComparator;
  const searched = (key: 'contains' | 'ncontains'): boolean =>
    requireString(toolName, subject, subjectLabel).includes(
      requireString(toolName, operandFor(key), `${subjectLabel} ${key}`)
    );

  if (wide.contains !== undefined && !searched('contains')) return false;
  if (wide.ncontains !== undefined && searched('ncontains')) return false;

  return true;
}

/**
 * Evaluate one comparator against one metadata key — the fail-soft twin of
 * {@link matchesComparator}.
 *
 * The semantics live in {@link metadataComparatorHolds}, shared verbatim with
 * the availability gate so the two can never drift; what this wrapper adds is
 * the two things the shared table cannot know about — how to resolve a
 * `$param`/`$state` operand, and where to log a declined row.
 *
 * `$param` operands still throw if they don't resolve: those ARE load-validated,
 * so a failure there is a regression rather than a fact about the character.
 */
function matchesMetadataComparator(
  toolName: string,
  comparator: MetadataComparator,
  key: string,
  sheet: Record<string, unknown>,
  params: ResolvedParams,
  state: CustomToolState,
  /** Which sheet is being read, for the operand label and the debug log. */
  subject: 'metadata' | 'progress' = 'metadata',
  inventory?: InventoryContext | null
): boolean {
  return metadataComparatorHolds(comparator, key, sheet, {
    resolveOperand: (comparatorKey) =>
      resolveOperand(
        toolName,
        comparator[comparatorKey] as number | string | boolean | ParamRef | StateRef | InventoryRef,
        params,
        `${subject} "${key}" ${comparatorKey}`,
        state,
        inventory
      ),
    onDecline: (reason) =>
      logger.debug(`Custom tool ${subject} test did not match`, {
        context: CONTEXT,
        tool: toolName,
        key,
        reason,
      }),
  });
}

/**
 * Evaluate one comparator against the LLM consult — the second fail-soft
 * evaluator, for the same reason as {@link matchesMetadataComparator}: the
 * subject's run-time type is unknowable at load time, because the answer is
 * whatever the model chose to say.
 *
 * Reconciliation rules, chosen so an author testing an oracle they prompted
 * for "YES", "42", or "the west door" gets the match they meant:
 *
 * - `ok` tests the consult's success flag directly.
 * - Ordering comparators need the answer to parse as a finite number; an
 *   answer that doesn't simply declines the row (debug-logged).
 * - eq/neq compare numerically when both sides are numbers, and otherwise as
 *   trimmed, case-insensitive strings — a model that says "yes." instead of
 *   "YES" has still said yes. (Trailing sentence punctuation is also
 *   forgiven for that reason.)
 * - contains/ncontains search the answer for the operand under that same
 *   trimmed, case-insensitive reconciliation.
 *
 * `$param` operands still throw when they fail to resolve: those are
 * load-validated, so a failure is a regression, not a fact about the model.
 */
function matchesLlmComparator(
  toolName: string,
  comparator: LlmComparator,
  llm: LlmSubject,
  params: ResolvedParams,
  state: CustomToolState,
  inventory?: InventoryContext | null
): boolean {
  const decline = (reason: string): false => {
    logger.debug('Custom tool llm test did not match', { context: CONTEXT, tool: toolName, reason });
    return false;
  };

  if (comparator.ok !== undefined && comparator.ok !== llm.ok) return false;

  const answer = llm.output.trim();
  const numericAnswer = answer !== '' && Number.isFinite(Number(answer)) ? Number(answer) : null;

  const operandFor = (comparatorKey: Exclude<keyof LlmComparator, 'ok'>): number | string | boolean =>
    resolveOperand(
      toolName,
      (comparator as Record<string, unknown>)[comparatorKey] as number | string | boolean | ParamRef | StateRef | InventoryRef,
      params,
      `the llm answer ${comparatorKey}`,
      state,
      inventory
    );

  for (const comparatorKey of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (comparator[comparatorKey] === undefined) continue;
    const operand = operandFor(comparatorKey);
    if (numericAnswer === null || typeof operand !== 'number') {
      return decline(`${comparatorKey} orders ${JSON.stringify(answer)}, and only numbers can be ordered`);
    }
    if (!compareOrdered(comparatorKey, numericAnswer, operand)) return false;
  }

  const equalsAnswer = (operand: number | string | boolean): boolean => {
    if (typeof operand === 'number' && numericAnswer !== null) return numericAnswer === operand;
    const operandText = String(operand).trim().toLowerCase();
    const answerText = answer.toLowerCase();
    return answerText === operandText || answerText === `${operandText}.` || answerText === `${operandText}!`;
  };

  if (comparator.eq !== undefined && !equalsAnswer(operandFor('eq'))) return false;
  if (comparator.neq !== undefined && equalsAnswer(operandFor('neq'))) return false;

  // Containment under eq's reconciliation: trimmed, case-insensitive, and the
  // operand stringified — an author hunting "west door" should find "the West
  // Door", because the subject here is a model's prose, not a declared value.
  const containsAnswer = (operand: number | string | boolean): boolean =>
    answer.toLowerCase().includes(String(operand).trim().toLowerCase());

  if (comparator.contains !== undefined && !containsAnswer(operandFor('contains'))) return false;
  if (comparator.ncontains !== undefined && containsAnswer(operandFor('ncontains'))) return false;

  return true;
}

/**
 * Evaluate an outcome test: the catch-all, one AND-group, or an any-of array
 * of them (the first group to hold decides, left to right).
 */
export function matchesWhen(when: When, subjects: OutcomeSubjects, toolName = 'custom tool'): boolean {
  if (when === true) return true;
  if (!Array.isArray(when)) return matchesWhenGroup(when, subjects, toolName);
  return anyGroupHolds(when, (group) => matchesWhenGroup(group, subjects, toolName), toolName);
}

/** Try groups left to right, short-circuiting on the first that holds; logs which one did. */
function anyGroupHolds<G>(groups: readonly G[], holds: (group: G) => boolean, toolName: string): boolean {
  const heldGroup = groups.findIndex(holds);
  logger.debug('Custom tool any-of test', {
    context: CONTEXT,
    tool: toolName,
    groups: groups.length,
    heldGroup: heldGroup >= 0 ? heldGroup : null,
  });
  return heldGroup >= 0;
}

/**
 * Evaluate one AND-group of an outcome test. Every subject named must hold —
 * bare comparators against the final value, `roll` against the raw draw,
 * `params` against what the caller supplied, `metadata` against the invoking
 * character's fact sheet, and the Inventory subjects against their bag.
 */
function matchesWhenGroup(when: WhenObject, subjects: OutcomeSubjects, toolName: string): boolean {
  const { value, roll, params } = subjects;
  const metadata = subjects.metadata ?? {};
  const progress = subjects.progress ?? {};
  const state = subjects.state ?? {};
  const inventory = subjects.inventory ?? null;

  if (!matchesComparator(toolName, when, value, 'the rolled value', params, state, inventory)) return false;

  if (when.roll !== undefined && !matchesComparator(toolName, when.roll, roll, 'the raw roll', params, state, inventory)) {
    return false;
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    const subject = params[name];
    if (subject === undefined) {
      // Load-time validation rejects a test of an undeclared parameter.
      throw new CustomToolRunError(`${toolName}: an outcome tests "${name}", which is not a declared parameter`);
    }
    if (!matchesComparator(toolName, comparator, subject, `parameter "${name}"`, params, state, inventory)) return false;
  }

  for (const [key, comparator] of Object.entries(when.metadata ?? {})) {
    if (!matchesMetadataComparator(toolName, comparator, key, metadata, params, state, 'metadata', inventory)) return false;
  }

  // The derived progress sheet reads through the SAME fail-soft table as
  // metadata — one semantics, no second comparison code — differing only in
  // which sheet it looks in and what it calls the subject in the log.
  for (const [key, comparator] of Object.entries(when.progress ?? {})) {
    if (!matchesMetadataComparator(toolName, comparator, key, progress, params, state, 'progress', inventory)) {
      return false;
    }
  }

  // The Inventory subjects. Each key is a TEMPLATE, rendered against the
  // run's subjects first (`{{params.weapon}}`), then resolved through the one
  // reference rule. Fail-soft like `metadata`: with no context every
  // comparator declines.
  const inventoryKeys = [...Object.keys(when.inventory ?? {}), ...Object.keys(when.inventoryCount ?? {})];
  if (inventoryKeys.length > 0) {
    const renderVars: PlaceholderSubjects = { ...subjects, dice: (subjects as Partial<EffectSubjects>).dice ?? '' };
    const decline = (key: string) => (reason: string) =>
      logger.debug('Custom tool inventory test did not match', { context: CONTEXT, tool: toolName, key, reason });

    for (const [rawKey, comparator] of Object.entries(when.inventory ?? {})) {
      const ref = renderTemplate(rawKey, renderVars).trim();
      const operandFor = (op: 'eq' | 'neq'): string | undefined => {
        const operand = comparator[op];
        if (operand === undefined) return undefined;
        return String(resolveOperand(toolName, operand, params, `inventory "${rawKey}" ${op}`, state, inventory));
      };
      const holds = inventoryStateHolds({ eq: operandFor('eq'), neq: operandFor('neq') }, ref, inventory, decline(rawKey));
      logger.debug('Custom tool inventory state test', {
        context: CONTEXT,
        tool: toolName,
        key: rawKey,
        ref,
        state: inventory ? inventory.state(ref) : null,
        holds,
      });
      if (!holds) return false;
    }

    for (const [rawKey, comparator] of Object.entries(when.inventoryCount ?? {})) {
      const ref = renderTemplate(rawKey, renderVars).trim();
      const test: Record<string, number> = {};
      for (const op of ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const) {
        const operand = comparator[op];
        if (operand === undefined) continue;
        test[op] = requireNumber(
          toolName,
          resolveOperand(toolName, operand, params, `inventoryCount "${rawKey}" ${op}`, state, inventory),
          `inventoryCount "${rawKey}" ${op}`
        );
      }
      const holds = inventoryCountHolds(test, ref, inventory, decline(rawKey));
      logger.debug('Custom tool inventory count test', {
        context: CONTEXT,
        tool: toolName,
        key: rawKey,
        ref,
        count: inventory ? inventory.equippedKinCount(ref) : null,
        holds,
      });
      if (!holds) return false;
    }
  }

  // The aggregate sheet: one attribute across a scope of the bag, through the
  // same comparison table as `metadata`. The key is literal (it names a scope
  // and a field, never an object); operands resolve like any other.
  for (const [key, comparator] of Object.entries(when.inventoryAggregate ?? {})) {
    const holds = inventoryAggregateHolds(comparator, key, inventory, {
      resolveOperand: (comparatorKey) =>
        resolveOperand(
          toolName,
          comparator[comparatorKey] as number | string | boolean | ParamRef | StateRef | InventoryRef,
          params,
          `inventoryAggregate "${key}" ${comparatorKey}`,
          state,
          inventory
        ),
      onDecline: (reason) =>
        logger.debug('Custom tool inventoryAggregate test did not match', { context: CONTEXT, tool: toolName, key, reason }),
    });
    logger.debug('Custom tool inventoryAggregate test', {
      context: CONTEXT,
      tool: toolName,
      key,
      value: describeAggregateValue(key, inventory),
      holds,
    });
    if (!holds) return false;
  }

  if (when.llm !== undefined) {
    // No consult ran (a definition without an `llm` block, or a simulation
    // that supplied none): the test fails soft, exactly like a metadata key
    // the character doesn't carry.
    if (!subjects.llm) {
      logger.debug('Custom tool llm test did not match — no consult ran', { context: CONTEXT, tool: toolName });
      return false;
    }
    if (!matchesLlmComparator(toolName, when.llm, subjects.llm, params, state, inventory)) return false;
  }

  return true;
}

/** What an effect condition may be posed about: the run's subjects, plus the winning outcome. */
export interface EffectSubjects extends OutcomeSubjects {
  /** The winning outcome — the one subject that exists only after the deal. */
  outcome: { state: OutcomeState; index: number; brief?: string };
  /** Dice breakdown for `{{dice}}` in expressions — a string, '' for Form A. */
  dice: string;
  /**
   * Epoch milliseconds at run start, for `{{now}}` in an effect expression —
   * the idiom `{{now}} + 600000` re-arms a countdown ten minutes out without
   * the format needing a date grammar.
   */
  now: number;
}

/**
 * Evaluate an effect's condition. Delegates the shared subjects to the same
 * comparator chain outcome rows use, and adds the one subject only an effect
 * can test — the winning outcome's semantic state.
 */
export function matchesEffectWhen(
  when: EffectCondition | undefined,
  subjects: EffectSubjects,
  toolName = 'custom tool'
): boolean {
  if (when === undefined) return true;
  if (!Array.isArray(when)) return matchesEffectWhenGroup(when, subjects, toolName);
  return anyGroupHolds(effectWhenGroups(when), (group) => matchesEffectWhenGroup(group, subjects, toolName), toolName);
}

/** One AND-group of an effect condition: the outcome test, then the shared subjects. */
function matchesEffectWhenGroup(when: EffectWhen, subjects: EffectSubjects, toolName: string): boolean {
  if (when.outcome !== undefined) {
    if (when.outcome.eq !== undefined && subjects.outcome.state !== when.outcome.eq) return false;
    if (when.outcome.neq !== undefined && subjects.outcome.state === when.outcome.neq) return false;
  }

  const { outcome: _outcome, ...shared } = when;
  // An outcome-only group has no shared subjects left: it holds on the outcome alone.
  return matchesWhenGroup(shared as WhenObject, subjects, toolName);
}

/**
 * One effect, resolved by the pure core: the value it would write, the
 * wardrobe gesture it would make, or the reason it was skipped. The entrances
 * (and only they) apply the first two; the Proving Bench shows all three as a
 * dry run.
 */
export type ResolvedEffect =
  | { index: number; target: EffectTarget; value: ExprValue }
  | { index: number; wardrobe: ResolvedWardrobeGesture }
  | { index: number; inventory: ResolvedInventoryGesture }
  | { index: number; log: string }
  | { index: number; skipped: string };

/** An Inventory gesture with its object references rendered — ready for the applier. */
export interface ResolvedInventoryGesture {
  action: InventoryEffectAction;
  /** Rendered, trimmed references in file order; empty ones dropped with a debug log. */
  items: string[];
  /** pick_up only: equip the new instances (default true). */
  equip?: boolean;
}

/** A wardrobe gesture with its item references rendered — ready for the applier. */
export interface ResolvedWardrobeGesture {
  action: WardrobeEffectAction;
  /** Rendered, trimmed item references in file order. Empty strings are dropped here, with a debug log. */
  items: string[];
  mode?: WardrobeEffectMode;
  slot?: WardrobeItemType;
}

/** True for a resolved effect that would actually write a value. */
export function isApplicableWriteEffect(
  effect: ResolvedEffect
): effect is Extract<ResolvedEffect, { target: EffectTarget }> {
  return 'target' in effect;
}

/** True for a resolved effect that would actually change an outfit. */
export function isApplicableWardrobeEffect(
  effect: ResolvedEffect
): effect is Extract<ResolvedEffect, { wardrobe: ResolvedWardrobeGesture }> {
  return 'wardrobe' in effect;
}

/** True for a resolved effect that would change what the rolling character carries. */
export function isApplicableInventoryEffect(
  effect: ResolvedEffect
): effect is Extract<ResolvedEffect, { inventory: ResolvedInventoryGesture }> {
  return 'inventory' in effect;
}

/** True for a resolved effect that would write a line to the log. */
export function isApplicableLogEffect(
  effect: ResolvedEffect
): effect is Extract<ResolvedEffect, { log: string }> {
  return 'log' in effect;
}

/** True for a resolved effect of any kind that would apply (the Proving Bench's count). */
export function isApplicableEffect(
  effect: ResolvedEffect
): effect is Exclude<ResolvedEffect, { skipped: string }> {
  return (
    isApplicableWriteEffect(effect) ||
    isApplicableWardrobeEffect(effect) ||
    isApplicableInventoryEffect(effect) ||
    isApplicableLogEffect(effect)
  );
}

/**
 * Resolve a definition's effects against a finished run. Pure — nothing is
 * written here; the module's "no writes, no message posting" contract holds.
 *
 * Failure semantics are the `renderTemplate` doctrine: a condition that does
 * not hold, or an expression that fails to evaluate (a division by zero, a
 * reference that resolves to nothing), skips THAT effect with a debug log and
 * a recorded reason — a broken effect never sinks a roll. Parse failures are
 * load-time rejections and only reach here as regressions, handled the same
 * fail-soft way.
 */
function resolveEffects(
  definition: QtapCustomTool,
  subjects: EffectSubjects,
  /** A held run's per-effect settings (operator intervention). Absent everywhere else. */
  pins?: Record<number, EffectPin>
): ResolvedEffect[] {
  const resolveRef = (refname: string): ExprValue | undefined => {
    const v = resolvePlaceholderValue(classifyPlaceholder(refname), subjects);
    return isPrimitive(v) ? v : undefined;
  };

  const skipped = (index: number, reason: string): ResolvedEffect => {
    logger.debug('Custom tool effect skipped', {
      context: CONTEXT,
      tool: definition.name,
      effectIndex: index,
      reason,
    });
    return { index, skipped: reason };
  };

  return (definition.effects ?? []).map((effect, index) => {
    const pin = pins?.[index];
    if (pin?.mode === 'off') return skipped(index, 'switched off for this run');

    // A forced effect fires whatever its condition says; it can never add an
    // effect the definition lacks, only override this one's `when`.
    if (pin?.mode !== 'on') {
      let holds: boolean;
      try {
        holds = matchesEffectWhen(effect.when, subjects, definition.name);
      } catch (error) {
        // A comparator regression past load-time validation. An outcome row in
        // this state fails the run; an effect never does — it just doesn't fire.
        return skipped(index, `condition could not be evaluated: ${getErrorMessage(error)}`);
      }
      if (!holds) return skipped(index, 'condition did not hold');
    }

    // An edited gesture's references, or an edited log line, are literals —
    // the operator is editing what gets written, not the template.
    const literalItems = pin?.items?.map((item) => item.trim()).filter((item) => item.length > 0);

    if (isWardrobeEffect(effect)) {
      const gesture = literalItems ? { ...effect.wardrobe, items: literalItems } : effect.wardrobe;
      return resolveWardrobeGesture(definition.name, index, gesture, subjects, skipped, literalItems !== undefined);
    }
    if (isInventoryEffect(effect)) {
      const gesture = literalItems ? { ...effect.inventory, items: literalItems } : effect.inventory;
      return resolveInventoryGesture(definition.name, index, gesture, subjects, skipped, literalItems !== undefined);
    }
    if (isLogEffect(effect)) {
      // A template, like an outcome message — not an expression.
      const line = (pin?.log !== undefined ? pin.log : renderTemplate(effect.log, subjects)).trim();
      return line.length > 0 ? { index, log: line } : skipped(index, 'log line rendered empty');
    }
    if (effect.target === undefined || effect.value === undefined) {
      // Load-time validation rejects this; reaching here is a regression.
      return skipped(index, 'effect is neither a complete write, a wardrobe or inventory gesture, nor a log line');
    }

    const target = parseEffectTarget(effect.target);
    if (!target.ok) return skipped(index, `target ${target.reason}`);

    if (pin?.value !== undefined) return { index, target: target.target, value: pin.value };

    if (typeof effect.value !== 'string') {
      return { index, target: target.target, value: effect.value };
    }

    const parsed = parseExpression(effect.value);
    if (!parsed.ok) return skipped(index, `expression did not parse: ${parsed.reason}`);

    const evaluated = evaluateExpression(parsed.expr, resolveRef);
    if (!evaluated.ok) return skipped(index, `expression did not evaluate: ${evaluated.reason}`);

    return { index, target: target.target, value: evaluated.value };
  });
}

/**
 * Render a wardrobe gesture's item references with the same subjects an
 * outcome message gets. Templates, not expressions: a reference that renders
 * empty is dropped (a `wear` or `take_off` left with none is skipped), and one
 * that keeps an unresolved placeholder is passed on as written — it will
 * simply fail to resolve in the wardrobe, fail-soft, at the applier.
 */
function resolveWardrobeGesture(
  toolName: string,
  index: number,
  gesture: CustomToolWardrobeGesture,
  subjects: EffectSubjects,
  skipped: (index: number, reason: string) => ResolvedEffect,
  /** The references are the operator's literals — not rendered as templates. */
  literal = false
): ResolvedEffect {
  const items: string[] = [];
  for (const raw of gesture.items ?? []) {
    const rendered = (literal ? raw : renderTemplate(raw, subjects)).trim();
    if (rendered.length === 0) {
      logger.debug('Custom tool wardrobe item reference rendered empty; dropped', {
        context: CONTEXT,
        tool: toolName,
        effectIndex: index,
        reference: raw,
      });
      continue;
    }
    items.push(rendered);
  }

  if (gesture.action !== 'clear_slot' && items.length === 0) {
    return skipped(index, 'every item reference rendered empty');
  }

  return {
    index,
    wardrobe: {
      action: gesture.action,
      items,
      ...(gesture.mode !== undefined ? { mode: gesture.mode } : {}),
      ...(gesture.slot !== undefined ? { slot: gesture.slot } : {}),
    },
  };
}

/**
 * Render an Inventory gesture's object references with the same subjects an
 * outcome message gets — templates, not expressions. A reference that renders
 * empty is dropped; a gesture left with none is skipped with that reason.
 */
function resolveInventoryGesture(
  toolName: string,
  index: number,
  gesture: CustomToolInventoryGesture,
  subjects: EffectSubjects,
  skipped: (index: number, reason: string) => ResolvedEffect,
  /** The references are the operator's literals — not rendered as templates. */
  literal = false
): ResolvedEffect {
  const items: string[] = [];
  for (const raw of gesture.items) {
    const rendered = (literal ? raw : renderTemplate(raw, subjects)).trim();
    if (rendered.length === 0) {
      logger.debug('Custom tool inventory reference rendered empty; dropped', {
        context: CONTEXT,
        tool: toolName,
        effectIndex: index,
        reference: raw,
      });
      continue;
    }
    items.push(rendered);
  }
  if (items.length === 0) return skipped(index, 'every object reference rendered empty');
  return {
    index,
    inventory: {
      action: gesture.action,
      items,
      ...(gesture.action === 'pick_up' ? { equip: gesture.equip !== false } : {}),
    },
  };
}

/**
 * The metadata a winning outcome consulted, for the roll record.
 *
 * Only the keys that row actually tested, and only their primitive values —
 * which is every key it tested, since a row whose metadata comparator declined
 * (absent key, non-primitive value, wrong type) is precisely a row that did not
 * win. So the transcript records what the table saw, not the whole sheet: the
 * sheet is the character's business, and may hold things the room shouldn't.
 */
export function collectMetadataTested(
  when: When,
  metadata: Record<string, unknown> | undefined
): MetadataTested | undefined {
  if (!metadata) return undefined;

  // Across every group of an any-of: a key some group consulted was consulted.
  const tested: MetadataTested = {};
  for (const group of whenGroups(when)) {
    for (const key of Object.keys(group.metadata ?? {})) {
      const value = metadata[key];
      if (isPrimitive(value)) tested[key] = value;
    }
  }
  return Object.keys(tested).length > 0 ? tested : undefined;
}

// `formatValue` (integers plain, floats to 4 significant digits) now lives in
// `./expressions` — one number-rendering convention for templates and effect
// expressions alike — and is re-exported above for existing importers.

/** What a `{{placeholder}}` may be resolved against — a run's subjects, as a template sees them. */
export interface PlaceholderSubjects {
  value: number;
  roll: number;
  dice: string;
  params: ResolvedParams;
  /** The rolling character's name, for `{{character}}`. */
  character?: string;
  metadata?: Record<string, unknown>;
  /** The flattened progress sheet, for `{{progress.<id>.<field>}}`. */
  progress?: Record<string, ProgressPrimitive>;
  /**
   * Epoch milliseconds at run start, for `{{now}}` — ONE value for the whole
   * run, so two effects in the same file that both say `{{now}}` agree.
   */
  now?: number;
  /** The consult's result. Absent while rendering the consult's own prompt. */
  llm?: LlmSubject;
  /**
   * The winning outcome, for `{{outcome.state}}` / `{{outcome.index}}` /
   * `{{outcome.brief}}`. Present once the table has dealt: before the consult
   * when no row tests it, after otherwise (so absent from the prompt then).
   */
  outcome?: { state: OutcomeState; index: number; brief?: string };
  /** The merged persistent state, for `{{state.path}}` placeholders. */
  state?: CustomToolState;
  /** The rolling character's Inventory, for `{{inventory.<ref>.<field>}}`. */
  inventory?: InventoryContext | null;
}

/**
 * The value a classified placeholder names in a run's subjects, RAW — a
 * `{{metadata.key}}` holding a list comes back as the list, an absent key as
 * `undefined`, an unknown family as `undefined`. The two readers (the template
 * renderer and the effect-expression resolver) share this lookup and differ
 * only in what they make of a non-primitive: the renderer logs why and leaves
 * the placeholder as written, the resolver fails the expression soft.
 */
export function resolvePlaceholderValue(ref: PlaceholderRef, vars: PlaceholderSubjects): unknown {
  switch (ref.kind) {
    case 'value':
      return vars.value;
    case 'roll':
      return vars.roll;
    case 'dice':
      return vars.dice;
    case 'llm':
      return vars.llm?.output;
    case 'outcome':
      return vars.outcome?.[ref.field];
    case 'params':
      return vars.params[ref.name];
    case 'metadata':
      return vars.metadata?.[ref.key];
    case 'progress':
      return vars.progress?.[`${ref.id}.${ref.field}`];
    case 'now':
      return vars.now;
    case 'character':
      return vars.character;
    case 'state':
      // `state.` is stripped and the remainder is a full state path.
      return getAtPath(vars.state ?? {}, parsePath(ref.path));
    case 'inventory': {
      // No context (a run nobody made): nothing renders, not even `state`.
      if (!vars.inventory) return undefined;
      if (ref.field === 'state') return vars.inventory.state(ref.ref);
      const item = vars.inventory.item(ref.ref);
      if (!item) return undefined;
      switch (ref.field) {
        case 'title':
          // A title, or the name — so a message can always say *the sword*.
          return item.title?.trim() || item.name;
        case 'name':
          return item.name;
        case 'description':
          return item.description ?? undefined;
        case 'metadata':
          return ref.key !== undefined ? item.metadata?.[ref.key] : undefined;
      }
      return undefined;
    }
    case 'unknown':
      return undefined;
  }
}

/**
 * Substitute the four placeholder families. Plain string replacement — user
 * text is never interpreted, and an unknown placeholder is left as written.
 *
 * `{{metadata.key}}` follows that same leave-it-as-written rule when the key is
 * absent or holds a list or an object: the alternative — rendering an empty
 * string — would quietly eat the hole in the sentence, where the placeholder
 * left standing tells the author exactly which key their character lacks.
 * `{{state.path}}` follows the same doctrine.
 */
export function renderTemplate(message: string, vars: PlaceholderSubjects): string {
  return message.replace(/\{\{([^}]+)\}\}/g, (whole, rawKey: string) => {
    const ref = classifyPlaceholder(rawKey.trim());
    const v = resolvePlaceholderValue(ref, vars);
    if (isPrimitive(v)) return typeof v === 'number' ? formatValue(v) : String(v);

    // Nothing renderable: say why, and leave the hole visible.
    switch (ref.kind) {
      case 'llm':
        logger.debug('Custom tool message references {{llm}} with no consult to render', { context: CONTEXT });
        break;
      case 'outcome':
        logger.debug('Custom tool template references {{outcome.*}} it cannot render', {
          context: CONTEXT,
          placeholder: whole,
          reason: !vars.outcome
            ? 'the table has not dealt yet (or the consult is read by an outcome row)'
            : 'the winning outcome has no brief',
        });
        break;
      case 'metadata':
        logger.debug('Custom tool message references metadata the character cannot render', {
          context: CONTEXT,
          placeholder: whole,
          reason: v === undefined ? 'no such metadata key' : 'the key does not hold a primitive',
        });
        break;
      case 'progress':
        logger.debug('Custom tool message references a progression the character cannot render', {
          context: CONTEXT,
          placeholder: whole,
          reason: 'the character carries no such progression, or it has no such field',
        });
        break;
      case 'now':
        logger.debug('Custom tool message references {{now}} with no run clock to render', { context: CONTEXT });
        break;
      case 'character':
        logger.debug('Custom tool message references {{character}} but nobody in particular rolled', { context: CONTEXT });
        break;
      case 'inventory':
        logger.debug('Custom tool message references an inventory object it cannot render', {
          context: CONTEXT,
          placeholder: whole,
          reason: !vars.inventory
            ? 'no inventory to read (nobody in particular rolled)'
            : v === undefined
              ? 'the object is absent, or has no such field or metadata key'
              : 'the metadata key does not hold a primitive',
        });
        break;
      case 'state':
        logger.debug('Custom tool message references state it cannot render', {
          context: CONTEXT,
          placeholder: whole,
          reason: v === undefined ? 'no such state path' : 'the path does not hold a primitive',
        });
        break;
      default:
        logger.debug('Custom tool message carries an unknown placeholder', { context: CONTEXT, placeholder: whole });
    }
    return whole;
  });
}

/**
 * Resolve a definition's LLM consult: render the prompt, pose it through the
 * injected invoker, and translate whatever happens into the author's terms.
 *
 * Fail-soft by design — a consult NEVER throws. A provider error, a timeout,
 * an empty answer, or an entrance that wired no invoker all land in the same
 * place: `ok: false` with the author's `errorMessage` as the output, so the
 * outcome table gets to deal with the silence the way its author wrote it to.
 */
async function resolveLlmConsult(
  toolName: string,
  spec: CustomToolLlm,
  prompt: string,
  invoke: LlmInvoker | undefined
): Promise<LlmConsultResult> {
  const failed = (reason: string): LlmConsultResult => {
    logger.warn('Custom tool LLM consult failed', { context: CONTEXT, tool: toolName, reason });
    return { ok: false, output: spec.errorMessage, prompt, reason };
  };

  if (!invoke) return failed('no LLM invoker was available in this context');

  // The author's own leash, or the default. errorMessage is never subject to
  // it — those are the author's words, kept whole.
  const maxOutput = spec.maxOutput ?? MAX_LLM_OUTPUT_LENGTH;

  let result: LlmInvokeResult;
  try {
    result = await invoke(prompt, { maxOutputChars: maxOutput });
  } catch (error) {
    return failed(getErrorMessage(error));
  }

  if (!result.ok) return failed(result.reason);

  const output = result.output.trim().slice(0, maxOutput).trim();
  if (output === '') return failed('the model returned an empty answer');

  return {
    ok: true,
    output,
    prompt,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.model ? { model: result.model } : {}),
  };
}

/**
 * Pose a definition's consult once, with a prompt given whole — the hold
 * dialog's Re-ask (operator intervention). The same fail-soft resolution as a
 * run's own consult: never throws.
 */
export function poseLlmConsult(
  definition: QtapCustomTool,
  prompt: string,
  invoke: LlmInvoker | undefined
): Promise<LlmConsultResult> {
  if (!definition.llm) {
    throw new CustomToolRunError(`${definition.name}: this tool consults no model`);
  }
  return resolveLlmConsult(definition.name, definition.llm, prompt, invoke);
}

/** A definition's roll, parsed once so a thousand draws need not re-parse it. */
type PreparedRoll = { form: 'dice'; notation: string; parsed: DiceNotation } | { form: 'range'; range: RollRange };

/**
 * Parse a definition's `roll` for drawing. Load-time validation precedes this;
 * a dice string that no longer parses is a regression and must still fail
 * loudly rather than invent a number.
 */
function prepareRoll(definition: QtapCustomTool, inventory?: InventoryContext | null): PreparedRoll {
  if (typeof definition.roll === 'string') {
    const parsed = parseDiceNotation(definition.roll);
    if (!parsed) {
      throw new CustomToolRunError(`${definition.name}: "${definition.roll}" is not dice notation this build can roll`);
    }
    return { form: 'dice', notation: definition.roll, parsed };
  }
  // A whole roll drawn from an object's metadata ("sword.metadata.damage"):
  // the notation it holds, or the (load-checked) dice fallback when it holds
  // none, or none this build can roll.
  if (isInventoryRef(definition.roll)) {
    const ref = definition.roll;
    const resolved = resolveInventoryValue(ref, inventory);
    const parsed = typeof resolved === 'string' ? parseDiceNotation(resolved) : null;
    if (parsed) return { form: 'dice', notation: resolved as string, parsed };
    logger.debug('Custom tool $inventory roll fell back', {
      context: CONTEXT,
      tool: definition.name,
      reference: ref.$inventory,
      resolved,
      fallback: ref.fallback,
    });
    const fallback = typeof ref.fallback === 'string' ? parseDiceNotation(ref.fallback) : null;
    if (!fallback) {
      throw new CustomToolRunError(`${definition.name}: the $inventory roll's fallback is not dice notation this build can roll`);
    }
    return { form: 'dice', notation: ref.fallback as string, parsed: fallback };
  }
  return { form: 'range', range: definition.roll ?? {} };
}

/**
 * One draw. Dice carry their own modifier — Form A's multiplier/offset/round
 * do not apply, so raw and value are the same total; the range form draws
 * and transforms through {@link rollRange}.
 */
function drawRoll(
  definition: QtapCustomTool,
  roll: PreparedRoll,
  params: ResolvedParams,
  state: CustomToolState,
  inventory?: InventoryContext | null,
  replay?: { draw?: RecordedDraw; pins?: RunPins }
): { raw: number; value: number; dice?: DiceRollResult; draw: RecordedDraw; rollSpan: RunSpan; valueSpan: RunSpan } {
  if (roll.form === 'dice') {
    const faces = replay?.pins?.dice ?? (replay?.draw?.form === 'dice' ? replay.draw.faces : undefined);
    const rolled = faces ? diceFromFaces(definition.name, roll.parsed, faces) : rollNotation(roll.parsed);
    // Dice carry their own modifier, so the total is both raw and value: a
    // pinned total without its faces would make `{{dice}}` lie.
    const span = diceSpan(roll.parsed);
    return {
      raw: rolled.total,
      value: rolled.total,
      dice: rolled,
      draw: { form: 'dice', faces: [...rolled.results] },
      rollSpan: span,
      valueSpan: span,
    };
  }
  const unit = replay?.draw?.form === 'range' ? replay.draw.unit : undefined;
  const { raw, value, unit: used, rollSpan, valueSpan } = rollRange(
    definition,
    roll.range,
    params,
    state,
    inventory,
    unit,
    replay?.pins
  );
  return { raw, value, draw: { form: 'range', unit: used }, rollSpan, valueSpan };
}

/**
 * A dice result from given faces (a replayed draw or the operator's pin): each
 * face clamped to [1, sides], the total their sum plus the notation's modifier.
 * The count must match the notation — a held run's notation cannot change.
 */
function diceFromFaces(toolName: string, notation: DiceNotation, faces: number[]): DiceRollResult {
  if (faces.length !== notation.count) {
    throw new CustomToolRunError(
      `${toolName}: ${faces.length} dice given for ${notation.count}d${notation.sides}`
    );
  }
  const results = faces.map((face) => Math.min(notation.sides, Math.max(1, Math.round(face))));
  const subtotal = results.reduce((sum, face) => sum + face, 0);
  return { ...notation, results, subtotal, total: subtotal + notation.modifier };
}

/**
 * The index of the first outcome whose test holds. The schema's mandatory
 * trailing catch-all makes "none" unreachable, so it throws as a regression.
 */
function pickOutcome(definition: QtapCustomTool, subjects: OutcomeSubjects): number {
  const outcomeIndex = definition.outcomes.findIndex((o) => matchesWhen(o.when, subjects, definition.name));
  if (outcomeIndex < 0) {
    throw new CustomToolRunError(`${definition.name}: no outcome matched ${formatValue(subjects.value)}`);
  }
  return outcomeIndex;
}

/**
 * Run a definition: validate params, roll, transform, consult (when declared),
 * evaluate, render.
 *
 * No writes, no message posting — both entrances call this and then decide how
 * to announce the result. The one impurity is the optional LLM consult, which
 * arrives as an injected {@link LlmInvoker} so this stays testable and the
 * proving bench can substitute a pretend oracle.
 */
export async function executeCustomTool(
  definition: QtapCustomTool,
  suppliedParams: Record<string, unknown> | null | undefined,
  overrides?: {
    private?: boolean;
    metadata?: Record<string, unknown>;
    /**
     * The flattened progress sheet, derived by the ENTRANCE from the same
     * metadata snapshot it hands in above, against one `nowMs` taken at run
     * start. Derived there rather than here so the sheet and `{{now}}` are the
     * same clock reading the entrance's effect applier will later stamp with.
     */
    progress?: Record<string, ProgressPrimitive>;
    /** Epoch milliseconds at run start, for `{{now}}`. Defaults to `Date.now()`. */
    now?: number;
    /** The rolling character's name, for `{{character}}`. Absent for a run nobody made. */
    character?: string;
    /** Merged persistent state for `$state` refs and `{{state.path}}`. Default {}. */
    state?: CustomToolState;
    /**
     * The rolling character's Inventory for this chat, loaded once by the
     * entrance. Absent/null for a run nobody made — inventory tests decline,
     * `$inventory` operands fall back, `{{inventory.*}}` renders as written.
     */
    inventory?: InventoryContext | null;
    llmInvoke?: LlmInvoker;
    /**
     * Operator intervention (lib/pascal/intervention/): the random draw to
     * replay instead of fresh randomness. Absent = a fresh draw.
     */
    draw?: RecordedDraw;
    /**
     * Operator intervention: the consult result to use instead of calling
     * `llmInvoke`. When supplied, the invoker is never called.
     */
    consult?: LlmConsultResult;
    /** Operator intervention: the fields the operator pinned. */
    pins?: RunPins;
  }
): Promise<CustomToolRunResult> {
  const state = overrides?.state ?? {};
  const inventory = overrides?.inventory ?? null;
  const pins = overrides?.pins;
  const params = resolveParams(definition, suppliedParams, state, inventory);

  if (pins?.outcomeIndex !== undefined && !definition.outcomes[pins.outcomeIndex]) {
    throw new CustomToolRunError(`${definition.name}: there is no outcome row ${pins.outcomeIndex}`);
  }

  const roll = prepareRoll(definition, inventory);
  const { raw, value, dice, draw, rollSpan, valueSpan } = drawRoll(definition, roll, params, state, inventory, {
    ...(overrides?.draw ? { draw: overrides.draw } : {}),
    ...(pins ? { pins } : {}),
  });
  const rollForm = roll.form;
  const notation = roll.form === 'dice' ? roll.notation : undefined;
  const diceRolls = dice?.results;
  const diceBreakdown = dice ? formatDiceBreakdown(dice) : '';

  const metadata = overrides?.metadata ?? {};
  const progress = overrides?.progress ?? {};
  // One clock reading for the whole run: two effects that both say {{now}}
  // must agree, and a run's start is the honest instant for both.
  const now = overrides?.now ?? Date.now();
  const character = overrides?.character?.trim() || undefined;

  // Two run orders, and the table decides which. A table that TESTS the
  // consult's answer needs the consult first (the oracle: the model's answer is
  // the verdict). Any other table is dealt BEFORE the consult, so the prompt
  // is told the verdict (`{{outcome.brief}}`) rather than asked to recompute it
  // — a cheap model asked to redo arithmetic the engine has already done will
  // sometimes report the other branch (bug 257).
  const consultFirst = definition.llm !== undefined && outcomeTableTestsLlm(definition.outcomes);
  const baseSubjects: OutcomeSubjects = {
    value,
    roll: raw,
    params,
    metadata,
    progress,
    state,
    inventory,
    ...(character ? { character } : {}),
  };
  const templateVars = { value, roll: raw, dice: diceBreakdown, params, character, metadata, progress, now, state, inventory };

  // A held run never calls the model from here: a pinned answer, or the
  // consult it was handed, stands in. Only a Re-ask spends a call, and that
  // goes through the dialog's own action.
  const consult = async (spec: CustomToolLlm, prompt: string): Promise<LlmConsultResult> => {
    if (pins?.llmAnswer) return { ok: pins.llmAnswer.ok, output: pins.llmAnswer.output, prompt };
    if (overrides?.consult) return overrides.consult;
    return resolveLlmConsult(definition.name, spec, prompt, overrides?.llmInvoke);
  };

  let llm: LlmConsultResult | undefined;
  let llmPromptRendered: string | undefined;
  let outcomeIndex: number;
  let tableOutcomeIndex: number | undefined;
  let briefs: Array<string | undefined> = [];
  if (definition.llm && consultFirst) {
    llmPromptRendered = renderTemplate(definition.llm.prompt, templateVars);
    llm = await consult(definition.llm, llmPromptRendered);
    const tablePick = pickOutcome(definition, { ...baseSubjects, llm });
    outcomeIndex = pins?.outcomeIndex ?? tablePick;
    if (pins?.outcomeIndex !== undefined) tableOutcomeIndex = tablePick;
  } else {
    const tablePick = pickOutcome(definition, baseSubjects);
    outcomeIndex = pins?.outcomeIndex ?? tablePick;
    if (pins?.outcomeIndex !== undefined) tableOutcomeIndex = tablePick;
    if (definition.llm) {
      const winner = definition.outcomes[outcomeIndex];
      // The brief is written before the consult, so it quotes only what the
      // prompt may: no `{{llm}}`, no `{{outcome.*}}` (load rejects both).
      const brief = winner.brief !== undefined ? renderTemplate(winner.brief, templateVars) : undefined;
      briefs = [];
      briefs[outcomeIndex] = brief;
      logger.debug('Custom tool table dealt ahead of the consult', {
        context: CONTEXT,
        tool: definition.name,
        outcomeIndex,
        state: winner.state,
        hasBrief: brief !== undefined,
      });
      llmPromptRendered = renderTemplate(definition.llm.prompt, {
        ...templateVars,
        outcome: { state: winner.state, index: outcomeIndex, ...(brief !== undefined ? { brief } : {}) },
      });
      llm = await consult(definition.llm, llmPromptRendered);
    }
  }

  const subjects: OutcomeSubjects = { ...baseSubjects, ...(llm ? { llm } : {}) };
  const outcome = definition.outcomes[outcomeIndex];

  // Rendered once for the winner, whichever run order dealt it: a brief after
  // an oracle-first run is never read by the prompt, but `{{outcome.brief}}`
  // in a message or effect still resolves.
  const winningBrief =
    briefs[outcomeIndex] ?? (outcome.brief !== undefined ? renderTemplate(outcome.brief, templateVars) : undefined);
  // A pinned state is the state the run announces, and the one effects test.
  const finalState = pins?.state ?? outcome.state;
  const winning = { state: finalState, index: outcomeIndex, ...(winningBrief !== undefined ? { brief: winningBrief } : {}) };

  // A pinned message is the operator's literal text: no placeholders re-rendered in it.
  const message = pins?.message ?? renderTemplate(outcome.message, { ...templateVars, llm, outcome: winning });

  const metadataTested = collectMetadataTested(outcome.when, metadata);

  // F1 — the chip label, rendered AFTER the outcome is chosen so it may quote
  // everything the message may. This is the one render site; both entrances
  // copy the result, so the chip and the bubble header can never drift.
  const chipLabel = definition.chipLabel
    ? (pins?.chipLabel ?? renderTemplate(definition.chipLabel, { ...templateVars, llm, outcome: winning }))
    : undefined;

  // F3 — effects, resolved pure against the finished run. Nothing is written
  // here; the entrances decide whether (and where) the writes land.
  const effectSubjects: EffectSubjects = {
    ...subjects,
    outcome: winning,
    dice: diceBreakdown,
    now,
  };
  const effects =
    definition.effects && definition.effects.length > 0
      ? resolveEffects(definition, effectSubjects, pins?.effects)
      : undefined;

  const visibility: Visibility =
    overrides?.private === true
      ? 'whisper'
      : overrides?.private === false
        ? 'public'
        : (definition.defaultVisibility ?? 'public');

  return {
    tool: definition.name,
    params,
    rollForm,
    notation,
    raw,
    diceRolls,
    value,
    state: finalState,
    outcomeIndex,
    message,
    diceBreakdown,
    visibility,
    ...(metadataTested ? { metadataTested } : {}),
    ...(llm ? { llm } : {}),
    ...(chipLabel !== undefined ? { chipLabel } : {}),
    ...(effects ? { effects } : {}),
    draw,
    rollSpan,
    valueSpan,
    ...(llmPromptRendered !== undefined ? { llmPromptRendered } : {}),
    ...(tableOutcomeIndex !== undefined ? { tableOutcomeIndex } : {}),
  };
}

/** The Workbench audit: per-outcome hit counts over many simulated draws. */
export interface CustomToolAuditResult {
  runs: number;
  outcomes: Array<{ index: number; hits: number; share: number }>;
  valueMin: number;
  valueMax: number;
  valueMean: number;
}

/**
 * Deal many hands and count where they land — the proving bench's table audit.
 *
 * Same draw, same transform, same {@link matchesWhen} evaluation as
 * {@link executeCustomTool}, run `runs` times with one param resolution up
 * front. `renderTemplate` is deliberately skipped: it is the expensive step and
 * contributes nothing to hit rates. So are `chipLabel` (a label contributes
 * nothing either) and `effects` (an audit that wrote ten thousand times would
 * not be an audit).
 *
 * The result is one sample of a wider space — hit rates generally depend on the
 * supplied `params` and `metadata`, so a zero-hit row here may simply need a
 * different caller, not a different table.
 */
export function simulateOutcomes(
  definition: QtapCustomTool,
  suppliedParams: Record<string, unknown> | null | undefined,
  runs: number,
  metadata?: Record<string, unknown>,
  /**
   * A pretend consult, held fixed across every draw — the audit never spends a
   * real LLM call, let alone ten thousand of them. Hit rates for a table that
   * branches on the answer are therefore conditional on this one answer; the
   * bench says so beside the field.
   */
  llm?: LlmSubject,
  /** Mock merged state for `$state` refs. Default `{}` — every ref falls back. */
  state: CustomToolState = {},
  /**
   * The mock progress sheet, held fixed across every draw. The bench derives
   * it from the typed fact sheet at one instant, so an audit of a table that
   * branches on `cannon.complete` is conditional on that one clock reading —
   * the same caveat the bench already states for a pretend consult.
   */
  progress: Record<string, ProgressPrimitive> = {},
  /** The mock Inventory (the bench's), held fixed across every draw. */
  inventory: InventoryContext | null = null
): CustomToolAuditResult {
  const params = resolveParams(definition, suppliedParams, state, inventory);
  const roll = prepareRoll(definition, inventory);

  const hits = new Array<number>(definition.outcomes.length).fill(0);
  let valueMin = Infinity;
  let valueMax = -Infinity;
  let valueSum = 0;

  for (let i = 0; i < runs; i++) {
    const { raw, value } = drawRoll(definition, roll, params, state, inventory);

    const subjects: OutcomeSubjects = {
      value,
      roll: raw,
      params,
      metadata: metadata ?? {},
      progress,
      state,
      inventory,
      ...(llm ? { llm } : {}),
    };
    hits[pickOutcome(definition, subjects)] += 1;

    if (value < valueMin) valueMin = value;
    if (value > valueMax) valueMax = value;
    valueSum += value;
  }

  return {
    runs,
    outcomes: hits.map((count, index) => ({ index, hits: count, share: runs > 0 ? count / runs : 0 })),
    valueMin: runs > 0 ? valueMin : 0,
    valueMax: runs > 0 ? valueMax : 0,
    valueMean: runs > 0 ? valueSum / runs : 0,
  };
}
