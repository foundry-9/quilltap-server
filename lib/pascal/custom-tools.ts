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
import { listDatabaseFiles, readDatabaseDocument, DatabaseStoreError } from '@/lib/mount-index/database-store';
import {
  resolveTieredMountPool,
  type MountTier,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool';
import { getErrorMessage } from '@/lib/error-utils';
import {
  QtapCustomToolSchema,
  collectUnknownKeys,
  formatDefinitionIssues,
  isParamRef,
  MAX_ROSTER_SIZE,
  TOOLS_FOLDER,
  TOOL_FILE_SUFFIX,
  type CustomToolParameter,
  type NumberOrParamRef,
  type NumericComparator,
  type OutcomeState,
  type ParamComparator,
  type ParamRef,
  type QtapCustomTool,
  type RollRange,
  type Visibility,
  type When,
} from './custom-tool.types';
import { formatDiceBreakdown, parseDiceNotation, rollNotation, type DiceRollResult } from './dice';

const CONTEXT = 'pascal.custom-tools';

/** Tier precedence, nearest first. A nearer tier shadows a farther one. */
const TIER_ORDER: MountTier[] = ['character', 'participant', 'group', 'project', 'global'];

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
  /** Every character in the chat — their vaults form the 'participant' tier. */
  characterIds?: string[];
  projectId?: string | null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * True for a root-level `*.tool.json`.
 *
 * `listDatabaseFiles({ folder })` filters by PREFIX, so it happily returns
 * `Tools/nested/deep/x.tool.json`. Definitions are a flat root-level
 * convention; a nested file is somebody's archive, not a live tool.
 */
function isRootToolFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (!lower.endsWith(TOOL_FILE_SUFFIX)) return false;
  const rest = relativePath.slice(TOOLS_FOLDER.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

/** List `Tools/*.tool.json` in a database-backed store. */
async function listToolFilesFromDatabase(mountPointId: string): Promise<string[]> {
  const entries = await listDatabaseFiles(mountPointId, { folder: TOOLS_FOLDER });
  return entries
    .filter((e) => e.kind !== 'folder' && isRootToolFile(e.relativePath))
    .map((e) => e.relativePath);
}

/**
 * List `Tools/*.tool.json` in an on-disk store (filesystem or obsidian).
 *
 * A missing `Tools/` folder is the normal case — it is a lazy convention like
 * Suparṇā's `Mail/`, never scaffolded — so ENOENT yields [] rather than an error.
 */
async function listToolFilesFromDisk(basePath: string): Promise<string[]> {
  const folder = path.join(basePath, TOOLS_FOLDER);
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(TOOL_FILE_SUFFIX))
      .map((e) => `${TOOLS_FOLDER}/${e.name}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }
}

/** Read one definition's bytes, whichever kind of store holds it. */
async function readToolFile(
  mount: { id: string; mountType: string; basePath: string },
  relativePath: string
): Promise<string> {
  if (mount.mountType === 'database') {
    const { content } = await readDatabaseDocument(mount.id, relativePath);
    return content;
  }
  return fs.readFile(path.join(mount.basePath, relativePath), 'utf-8');
}

/**
 * Load every definition in one mount. Never throws: a broken file becomes an
 * error entry, because one malformed `.tool.json` must not take the whole
 * roster down with it.
 */
async function loadToolsFromMount(
  mountPointId: string,
  tier: MountTier
): Promise<{ found: DiscoveredCustomTool[]; errors: CustomToolLoadError[] }> {
  const found: DiscoveredCustomTool[] = [];
  const errors: CustomToolLoadError[] = [];

  const repos = getRepositories();
  const mount = await repos.docMountPoints.findById(mountPointId);
  if (!mount || !mount.enabled) return { found, errors };

  const mountName = mount.name;

  let paths: string[];
  try {
    paths =
      mount.mountType === 'database'
        ? await listToolFilesFromDatabase(mountPointId)
        : await listToolFilesFromDisk(mount.basePath);
  } catch (error) {
    logger.warn('Custom-tool listing failed for mount', {
      context: CONTEXT,
      mountPointId,
      mountName,
      error: getErrorMessage(error),
    });
    return { found, errors };
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
      // Deleted between list and read — a race, not a defect. Skip quietly.
      if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') continue;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason: `could not be read: ${getErrorMessage(error)}` });
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason: `is not valid JSON: ${getErrorMessage(error)}` });
      continue;
    }

    const unknownKeys = collectUnknownKeys(parsedJson);
    if (unknownKeys.length > 0) {
      // Tolerated, not rejected — `persist` is a planned v2 key and an older
      // build must not choke on a newer file.
      logger.debug('Custom tool carries keys this build does not know', {
        context: CONTEXT,
        mountPointId,
        definitionPath: relativePath,
        unknownKeys,
      });
    }

    const result = QtapCustomToolSchema.safeParse(parsedJson);
    if (!result.success) {
      const reason = formatDefinitionIssues(result.error);
      errors.push({ definitionPath: relativePath, mountPointId, mountName, tier, reason });
      logger.debug('Custom tool rejected at load time', {
        context: CONTEXT,
        mountPointId,
        definitionPath: relativePath,
        reason,
      });
      continue;
    }

    const definition = result.data;
    const priorPath = nameToPath.get(definition.name);
    if (priorPath) {
      errors.push({
        definitionPath: relativePath,
        mountPointId,
        mountName,
        tier,
        reason: `defines "${definition.name}", which ${priorPath} in this same store already defines`,
      });
      continue;
    }
    nameToPath.set(definition.name, relativePath);

    found.push({ definition, tier, mountPointId, mountName, definitionPath: relativePath });
  }

  return { found, errors };
}

/** Bucket the pool into (tier, mountPointId) pairs in precedence order. */
function orderedMounts(pool: TieredMountPool): Array<{ tier: MountTier; mountPointId: string }> {
  const byTier: Record<MountTier, string[]> = {
    character: pool.characterMountPointId ? [pool.characterMountPointId] : [],
    participant: pool.participantMountPointIds,
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
 * Resolve the roster for one invoker.
 *
 * Iterates tier buckets explicitly rather than flattening the pool: flattening
 * dedups into a Set and throws away the tier attribution that shadowing and
 * `pascalMeta.definitionTier` both depend on.
 */
export async function resolveCustomToolRoster(ctx: RosterContext): Promise<CustomToolRoster> {
  const pool = await resolveTieredMountPool(
    {
      userId: ctx.userId,
      characterId: ctx.characterId ?? null,
      characterMountPointId: ctx.characterMountPointId ?? null,
      characterIds: ctx.characterIds,
      projectId: ctx.projectId ?? null,
    },
    { includeParticipants: true }
  );

  const tools = new Map<string, DiscoveredCustomTool>();
  const errors: CustomToolLoadError[] = [];
  const droppedForCap: string[] = [];
  /** Names switched off by a nearer tier. They must stay off further out. */
  const suppressed = new Set<string>();

  for (const { tier, mountPointId } of orderedMounts(pool)) {
    const { found, errors: mountErrors } = await loadToolsFromMount(mountPointId, tier);
    errors.push(...mountErrors);

    for (const entry of found) {
      const { name } = entry.definition;

      // Nearest tier wins. Once a name is decided — by a live definition or by
      // a `disabled` tombstone — farther tiers cannot revive it.
      if (tools.has(name) || suppressed.has(name)) continue;

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

  logger.debug('Custom-tool roster resolved', {
    context: CONTEXT,
    chatId: ctx.chatId,
    characterId: ctx.characterId ?? null,
    toolCount: tools.size,
    errorCount: errors.length,
    names: [...tools.keys()],
  });

  return { tools, errors, droppedForCap };
}

// ---------------------------------------------------------------------------
// Execution core
// ---------------------------------------------------------------------------

/** A run that could not be completed. Never becomes a fabricated outcome. */
export class CustomToolRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomToolRunError';
  }
}

/** Resolved parameter values, post-default and post-clamp. */
export type ResolvedParams = Record<string, number | string | boolean>;

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
  supplied: Record<string, unknown> | null | undefined
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
    resolved[name] = coerceParam(definition.name, name, spec, given[name]);
  }
  return resolved;
}

function coerceParam(
  toolName: string,
  name: string,
  spec: CustomToolParameter,
  value: unknown
): number | string | boolean {
  if (value === undefined || value === null) return spec.default;

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

/** Resolve a roll field: literal, `$param` reference, or the field's default. */
function resolveRollField(
  toolName: string,
  field: string,
  spec: NumberOrParamRef | undefined,
  params: ResolvedParams,
  fallback: number
): number {
  if (spec === undefined) return fallback;

  if (isParamRef(spec)) {
    const value = params[spec.$param];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CustomToolRunError(
        `${toolName}: roll.${field} references "${spec.$param}", which resolved to ${JSON.stringify(value)} rather than a finite number`
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
function cryptoUniform(min: number, max: number): number {
  const bytes = randomBytes(6);
  let scaled = 0;
  for (const byte of bytes) scaled = scaled * 256 + byte;
  const fraction = scaled / 2 ** 48;
  return min + fraction * (max - min);
}

/** Draw the raw value for Form A, honouring `$param` bounds. */
function rollRange(
  definition: QtapCustomTool,
  range: RollRange,
  params: ResolvedParams
): { raw: number; value: number } {
  const min = resolveRollField(definition.name, 'min', range.min, params, 0);
  const max = resolveRollField(definition.name, 'max', range.max, params, 1);
  const multiplier = resolveRollField(definition.name, 'multiplier', range.multiplier, params, 1);
  const offset = resolveRollField(definition.name, 'offset', range.offset, params, 0);

  if (min > max) {
    throw new CustomToolRunError(
      `${definition.name}: the roll's low bound (${min}) is above its high bound (${max})`
    );
  }

  const raw = min === max ? min : cryptoUniform(min, max);

  // The transform order is fixed and load-bearing: multiply, then offset, then
  // round. Rounding first would quantise before the offset could shift it.
  let value = raw * multiplier;
  value = value + offset;
  if (range.round) value = Math.round(value);

  if (!Number.isFinite(value)) {
    throw new CustomToolRunError(`${definition.name}: the roll produced a value that is not a finite number`);
  }

  return { raw, value };
}

/** Everything an outcome test may be posed about. */
export interface OutcomeSubjects {
  /** The final post-transform value. */
  value: number;
  /** The raw pre-transform draw. */
  roll: number;
  /** The resolved parameters, post-default and post-clamp. */
  params: ResolvedParams;
}

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
  operand: number | string | boolean | ParamRef,
  params: ResolvedParams,
  label: string
): number | string | boolean {
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

/**
 * Evaluate one comparator against one subject. Keys AND together, and an
 * operand may be a `$param` reference rather than a literal.
 */
function matchesComparator(
  toolName: string,
  comparator: NumericComparator | ParamComparator,
  subject: number | string | boolean,
  subjectLabel: string,
  params: ResolvedParams
): boolean {
  const operandFor = (key: keyof ParamComparator): number | string | boolean =>
    resolveOperand(toolName, comparator[key] as number | string | boolean | ParamRef, params, `${subjectLabel} ${key}`);

  const order = (key: 'gt' | 'gte' | 'lt' | 'lte'): [number, number] => [
    requireNumber(toolName, subject, subjectLabel),
    requireNumber(toolName, operandFor(key), `${subjectLabel} ${key}`),
  ];

  if (comparator.gt !== undefined) {
    const [a, b] = order('gt');
    if (!(a > b)) return false;
  }
  if (comparator.gte !== undefined) {
    const [a, b] = order('gte');
    if (!(a >= b)) return false;
  }
  if (comparator.lt !== undefined) {
    const [a, b] = order('lt');
    if (!(a < b)) return false;
  }
  if (comparator.lte !== undefined) {
    const [a, b] = order('lte');
    if (!(a <= b)) return false;
  }
  if (comparator.eq !== undefined && subject !== operandFor('eq')) return false;
  if (comparator.neq !== undefined && subject === operandFor('neq')) return false;

  return true;
}

/**
 * Evaluate an outcome test. Every subject named must hold — bare comparators
 * against the final value, `roll` against the raw draw, `params` against what
 * the caller supplied.
 */
export function matchesWhen(when: When, subjects: OutcomeSubjects, toolName = 'custom tool'): boolean {
  if (when === true) return true;

  const { value, roll, params } = subjects;

  if (!matchesComparator(toolName, when, value, 'the rolled value', params)) return false;

  if (when.roll !== undefined && !matchesComparator(toolName, when.roll, roll, 'the raw roll', params)) {
    return false;
  }

  for (const [name, comparator] of Object.entries(when.params ?? {})) {
    const subject = params[name];
    if (subject === undefined) {
      // Load-time validation rejects a test of an undeclared parameter.
      throw new CustomToolRunError(`${toolName}: an outcome tests "${name}", which is not a declared parameter`);
    }
    if (!matchesComparator(toolName, comparator, subject, `parameter "${name}"`, params)) return false;
  }

  return true;
}

/**
 * Render a number for display: integers plain, floats to 4 significant digits.
 */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // `toPrecision` can hand back exponential form for extremes; Number() folds
  // that back to the shortest faithful representation.
  return String(Number(value.toPrecision(4)));
}

/**
 * Substitute the three placeholder families. Plain string replacement — user
 * text is never interpreted, and an unknown placeholder is left as written.
 */
export function renderTemplate(
  message: string,
  vars: { value: number; roll: number; dice: string; params: ResolvedParams }
): string {
  return message.replace(/\{\{([^}]+)\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.trim();

    if (key === 'value') return formatValue(vars.value);
    if (key === 'roll') return formatValue(vars.roll);
    if (key === 'dice') return vars.dice;

    if (key.startsWith('params.')) {
      const name = key.slice('params.'.length);
      if (name in vars.params) {
        const v = vars.params[name];
        return typeof v === 'number' ? formatValue(v) : String(v);
      }
    }

    logger.debug('Custom tool message carries an unknown placeholder', { context: CONTEXT, placeholder: whole });
    return whole;
  });
}

/**
 * Run a definition: validate params, roll, transform, evaluate, render.
 *
 * Pure computation — no writes, no message posting. Both entrances call this
 * and then decide how to announce the result.
 */
export function executeCustomTool(
  definition: QtapCustomTool,
  suppliedParams: Record<string, unknown> | null | undefined,
  overrides?: { private?: boolean }
): CustomToolRunResult {
  const params = resolveParams(definition, suppliedParams);

  let raw: number;
  let value: number;
  let rollForm: 'range' | 'dice';
  let notation: string | undefined;
  let diceRolls: number[] | undefined;
  let diceBreakdown = '';

  if (typeof definition.roll === 'string') {
    rollForm = 'dice';
    const parsed = parseDiceNotation(definition.roll);
    if (!parsed) {
      // Load-time validation should have caught this; a regression here must
      // still fail loudly rather than invent a number.
      throw new CustomToolRunError(`${definition.name}: "${definition.roll}" is not dice notation this build can roll`);
    }
    const rolled: DiceRollResult = rollNotation(parsed);
    notation = definition.roll;
    diceRolls = rolled.results;
    diceBreakdown = formatDiceBreakdown(rolled);
    // Dice carry their own modifier; Form A's multiplier/offset/round do not
    // apply, so raw and value are the same total.
    raw = rolled.total;
    value = rolled.total;
  } else {
    rollForm = 'range';
    const range = definition.roll ?? {};
    const drawn = rollRange(definition, range, params);
    raw = drawn.raw;
    value = drawn.value;
  }

  const subjects: OutcomeSubjects = { value, roll: raw, params };
  const outcomeIndex = definition.outcomes.findIndex((o) => matchesWhen(o.when, subjects, definition.name));
  if (outcomeIndex < 0) {
    // The schema's mandatory trailing catch-all makes this unreachable.
    throw new CustomToolRunError(`${definition.name}: no outcome matched ${formatValue(value)}`);
  }
  const outcome = definition.outcomes[outcomeIndex];

  const message = renderTemplate(outcome.message, { value, roll: raw, dice: diceBreakdown, params });

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
    state: outcome.state,
    outcomeIndex,
    message,
    diceBreakdown,
    visibility,
  };
}
