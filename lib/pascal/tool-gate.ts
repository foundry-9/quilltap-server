/**
 * The availability gate — whether a tool is dealt to this invoker at all.
 *
 * An outcome table decides what happens once a tool is run. A gate decides
 * something earlier and coarser: whether the tool appears on the roster in the
 * first place. A definition that declares `availableWhen` is offered only to an
 * invoker whose fact sheet satisfies it; one that declares `withheldWhen` is
 * kept from an invoker whose sheet satisfies THAT. A definition declaring
 * neither is offered to everyone, which is every file written before this key
 * existed.
 *
 * ## Why metadata and progress alone
 *
 * The gate is answered before the deal. There is no roll to test, no resolved
 * parameters (nobody has called anything yet), and no consult. What a character
 * carries into the room is their `metadata.json` — and, derived from the
 * `progressions` key inside it against the wall clock, their timed
 * progressions. Those two are the only subjects a pre-roll test can honestly
 * have, and the reason a gate's operands are literals rather than
 * `$param`/`$state` references.
 *
 * The progress sheet is what makes `availableWhen: { progress: {
 * "cannon.complete": { eq: true } } }` — the whole weapon-recharge use case —
 * a gate rather than a branch in every outcome table. The roster already holds
 * the invoker's metadata, so deriving the sheet from it adds no reads.
 *
 * ## Fail-soft, and therefore fail-CLOSED for `availableWhen`
 *
 * Metadata tests never throw: an absent key, a list, a value of the wrong type
 * all simply fail to match (see {@link metadataComparatorHolds}). Read through
 * the gate, that means a character with no sheet at all fails every
 * `availableWhen` — the tool is withheld — and satisfies no `withheldWhen` — the
 * tool is offered. Both are the safe reading of "we could not establish that
 * this character qualifies".
 *
 * CLIENT-SAFE: pure, and imports only client-safe modules, so the Workbench can
 * tell an author whether a fact sheet would be dealt to without a round trip.
 */

import type { QtapCustomTool, ToolGate } from './custom-tool.types';
import { metadataComparatorHolds, type Primitive } from './metadata-match';
import type { ProgressPrimitive } from '@/lib/progressions/engine';

/** What a gate decided, and which clause decided it. */
export interface ToolGateVerdict {
  /** Whether this invoker may be offered the tool. */
  available: boolean;
  /** The clause that withheld it. Absent whenever the tool is available. */
  withheldBy?: 'availableWhen' | 'withheldWhen';
}

/** A definition carries a gate when it declares either clause. */
export function hasToolGate(definition: Pick<QtapCustomTool, 'availableWhen' | 'withheldWhen'>): boolean {
  return definition.availableWhen !== undefined || definition.withheldWhen !== undefined;
}

/**
 * Evaluate a definition's gate against one invoker's fact sheet.
 *
 * Total: an ungated definition is available, and no input can make this throw.
 */
export function evaluateToolGate(
  definition: Pick<QtapCustomTool, 'availableWhen' | 'withheldWhen'>,
  metadata: Record<string, unknown> | null | undefined,
  /**
   * The invoker's derived progress sheet (`flattenProgressions`), keyed
   * `"<id>.<field>"`. Omitted → `{}`, so every `progress` test fails and the
   * fail-closed / fail-open reading below applies to it unchanged.
   */
  progress?: Record<string, ProgressPrimitive> | null
): ToolGateVerdict {
  const sheet = metadata ?? {};
  const progressSheet = progress ?? {};

  if (definition.availableWhen && !gateHolds(definition.availableWhen, sheet, progressSheet)) {
    return { available: false, withheldBy: 'availableWhen' };
  }

  if (definition.withheldWhen && gateHolds(definition.withheldWhen, sheet, progressSheet)) {
    return { available: false, withheldBy: 'withheldWhen' };
  }

  return { available: true };
}

/** Every test in a gate must hold. Keys AND together, as they do in a `when`. */
function gateHolds(
  gate: ToolGate,
  metadata: Record<string, unknown>,
  progress: Record<string, ProgressPrimitive>
): boolean {
  // Both subjects go through the SAME comparison table — one semantics, no
  // second implementation to drift — differing only in which sheet they read.
  for (const [key, comparator] of Object.entries(gate.metadata ?? {})) {
    const holds = metadataComparatorHolds(comparator, key, metadata, {
      // A gate's operands are literals by construction — the schema admits no
      // `$param` or `$state` here — so resolution is the identity.
      resolveOperand: (comparatorKey) => comparator[comparatorKey] as Primitive,
    });
    if (!holds) return false;
  }

  for (const [key, comparator] of Object.entries(gate.progress ?? {})) {
    const holds = metadataComparatorHolds(comparator, key, progress, {
      resolveOperand: (comparatorKey) => comparator[comparatorKey] as Primitive,
    });
    if (!holds) return false;
  }

  return true;
}
