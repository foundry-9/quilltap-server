/**
 * Tool effects — the type, the ranking, and the helper for computed effects.
 *
 * Every tool declares what it does to the world: `none` (nothing beyond its own
 * return value), `read` (reads, changes nothing), `write` (changes stored
 * state) or `destroy` (a write that cannot be undone from inside Quilltap —
 * deletion). Anything undeclared counts as `write`.
 *
 * This module imports nothing, so every tool file can declare its effect
 * beside its definition without an import cycle through `effects.ts`, which
 * collects them.
 *
 * @module tools/effect-types
 */

export type ToolEffect = 'none' | 'read' | 'write' | 'destroy';

export const TOOL_EFFECTS: readonly ToolEffect[] = ['none', 'read', 'write', 'destroy'];

export const TOOL_EFFECT_RANK: Record<ToolEffect, number> = { none: 0, read: 1, write: 2, destroy: 3 };

/** What an undeclared tool, or a computed effect whose input fails validation, counts as. */
export const UNDECLARED_TOOL_EFFECT: ToolEffect = 'write';

/**
 * Lookups a computed effect may need that its input alone cannot answer —
 * `run_custom` names a custom tool, whose effect is derived from a definition
 * the caller has already resolved.
 */
export interface ToolEffectLookups {
  /** Custom tool name → derived effect, for the caller's roster. */
  customToolEffects?: ReadonlyMap<string, ToolEffect>;
}

/**
 * An effect that depends on the call's input. The function receives the RAW
 * input and validates it itself (see {@link computedToolEffect}); `maxEffect`
 * is the highest effect any valid input can have, used wherever a single
 * static answer is needed (bid tiers, the autonomous-room destructive filter).
 */
export interface ComputedToolEffect {
  (input: unknown, lookups?: ToolEffectLookups): ToolEffect;
  readonly computed: true;
  readonly maxEffect: ToolEffect;
  /**
   * One line for the tool's description when a turn's ceiling sits below
   * `maxEffect`, saying which uses are allowed (e.g. "only `fetch` this turn").
   * Returns null when the ceiling allows every use or none.
   */
  readonly usesAllowedUnder: (ceiling: ToolEffect) => string | null;
}

export type ToolEffectSpec = ToolEffect | ComputedToolEffect;

/** Minimal shape of a Zod schema, so this module stays import-free. */
interface SafeParser<I> {
  safeParse(input: unknown): { success: true; data: I } | { success: false };
}

/**
 * Build a computed effect from the tool's own Zod input schema. The resolver
 * only ever sees validated input; input that fails validation counts as
 * {@link UNDECLARED_TOOL_EFFECT} for that call.
 */
export function computedToolEffect<I>(options: {
  schema: SafeParser<I>;
  resolve: (input: I, lookups: ToolEffectLookups) => ToolEffect;
  maxEffect: ToolEffect;
  /** Per-ceiling note; keyed by the ceiling the note applies under. */
  notes?: Partial<Record<ToolEffect, string>>;
}): ComputedToolEffect {
  const fn = ((input: unknown, lookups?: ToolEffectLookups): ToolEffect => {
    const parsed = options.schema.safeParse(input ?? {});
    if (!parsed.success) return UNDECLARED_TOOL_EFFECT;
    return options.resolve(parsed.data, lookups ?? {});
  }) as ComputedToolEffect;
  Object.defineProperty(fn, 'computed', { value: true });
  Object.defineProperty(fn, 'maxEffect', { value: options.maxEffect });
  Object.defineProperty(fn, 'usesAllowedUnder', {
    value: (ceiling: ToolEffect): string | null => {
      if (TOOL_EFFECT_RANK[ceiling] >= TOOL_EFFECT_RANK[options.maxEffect]) return null;
      return options.notes?.[ceiling] ?? null;
    },
  });
  return fn;
}

export function isComputedToolEffect(spec: ToolEffectSpec): spec is ComputedToolEffect {
  return typeof spec === 'function';
}

/** The higher of two effects. */
export function maxToolEffect(a: ToolEffect, b: ToolEffect): ToolEffect {
  return TOOL_EFFECT_RANK[a] >= TOOL_EFFECT_RANK[b] ? a : b;
}

/** True when `effect` is within `ceiling`. */
export function isWithinCeiling(effect: ToolEffect, ceiling: ToolEffect): boolean {
  return TOOL_EFFECT_RANK[effect] <= TOOL_EFFECT_RANK[ceiling];
}

/** The lower of a ceiling (unset = no ceiling) and another ceiling. */
export function lowerToolEffect(ceiling: ToolEffect | undefined, other: ToolEffect): ToolEffect {
  if (!ceiling) return other;
  return TOOL_EFFECT_RANK[ceiling] <= TOOL_EFFECT_RANK[other] ? ceiling : other;
}
