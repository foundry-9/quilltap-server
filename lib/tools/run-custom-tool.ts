/**
 * Run Custom Tool Definition
 *
 * A single tool through which a model runs any of the user-authored pseudo-tools
 * on Pascal's roster (`Tools/*.tool.json` documents in the chat's document
 * stores). One tool rather than one per definition: the tool list stays stable
 * for prompt caching, the snapshot doesn't churn as users write new files, and
 * the Zod chokepoint stays honest. The roster rides in the description, rebuilt
 * on every tool build.
 *
 * The roll happens server-side and the outcome is persisted as a message the
 * model did not author, so a failure cannot be talked into a success and
 * regenerating a reply does not re-roll.
 */

import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import type { DiscoveredCustomTool } from '@/lib/pascal/custom-tools';
import {
  isParamRef,
  type NumericComparator,
  type ParamComparator,
  type QtapCustomTool,
} from '@/lib/pascal/custom-tool.types';

/**
 * Zod schema for the run_custom tool's input. The single source of truth for
 * both runtime validation and the derived OpenAI-format `parameters` JSON Schema.
 */
export const runCustomToolInputSchema = z.object({
  tool: z
    .string()
    .describe(
      'Name of the custom tool to run, exactly as listed in this tool\'s description (e.g. "unlock").'
    ),
  parameters: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      'Arguments for the tool, keyed by parameter name. Omit entirely to accept every default. Only parameters the tool declares are accepted.'
    ),
  private: z
    .boolean()
    .optional()
    .describe(
      'Roll privately: the outcome is whispered to you alone and other characters never see it. Defaults to the tool\'s own setting.'
    ),
});

/**
 * Input parameters for the run_custom tool
 */
export type RunCustomToolInput = z.infer<typeof runCustomToolInputSchema>;

/**
 * Output from the run_custom tool — the compact result handed back to the model.
 */
export interface RunCustomToolOutput {
  success: boolean;
  tool?: string;
  /** Final post-transform value the outcome table tested. */
  value?: number;
  /** Semantic state of the outcome that matched. */
  state?: 'success' | 'partial' | 'failure' | 'info';
  /** The rendered outcome message. */
  message?: string;
  /** Whether the outcome was whispered rather than posted publicly. */
  whispered?: boolean;
  error?: string;
}

/** Fixed preamble; the roster is appended per build. */
const RUN_CUSTOM_PREAMBLE = [
  'Run one of this scene\'s custom tools — user-authored actions with a random outcome.',
  'The roll happens server-side and its result is posted as a permanent message by Pascal the Croupier, so you cannot choose the outcome: run the tool and then narrate whatever it returns, including failure.',
  'Do not describe the result before calling, and do not re-run a tool to get a better answer.',
  '',
  'Available tools:',
].join('\n');

/** Render a roll spec compactly for the roster listing. */
function describeRoll(roll: QtapCustomTool['roll']): string {
  if (roll === undefined) return 'random value from 0 to 1';
  if (typeof roll === 'string') return `dice ${roll}`;

  const part = (label: string, v: unknown, fallback: string): string =>
    v === undefined ? fallback : isParamRef(v) ? `${label} ${v.$param}` : `${label} ${v}`;

  const bits = [
    `random value from ${part('', roll.min, '0').trim()} to ${part('', roll.max, '1').trim()}`,
  ];
  if (roll.multiplier !== undefined) bits.push(`× ${isParamRef(roll.multiplier) ? roll.multiplier.$param : roll.multiplier}`);
  if (roll.offset !== undefined) bits.push(`+ ${isParamRef(roll.offset) ? roll.offset.$param : roll.offset}`);
  if (roll.round) bits.push('rounded');
  return bits.join(' ');
}

/** The comparator keys, paired with the operator a reader expects to see. */
const COMPARATOR_SYMBOLS: Array<[keyof NumericComparator, string]> = [
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
  ['eq', '='],
  ['neq', '!='],
];

/** Render a comparator operand: a literal, or the parameter it points at. */
function describeOperand(operand: unknown): string {
  if (isParamRef(operand)) return operand.$param;
  return typeof operand === 'string' ? JSON.stringify(operand) : String(operand);
}

/** Render one comparator as a readable test of a named subject. */
function describeComparator(
  comparator: NumericComparator | ParamComparator,
  subject: string
): string[] {
  return COMPARATOR_SYMBOLS.filter(([key]) => comparator[key] !== undefined).map(
    ([key, symbol]) => `${subject} ${symbol} ${describeOperand(comparator[key])}`
  );
}

/**
 * Render an outcome test. Every subject is named — the bare comparators are
 * about `value`, so saying so keeps them legible beside a `roll` or a parameter
 * test rather than leaving the model to infer which is which.
 */
function describeWhen(when: QtapCustomTool['outcomes'][number]['when']): string {
  if (when === true) return 'otherwise';

  const parts: string[] = [
    ...describeComparator(when, 'value'),
    ...(when.roll !== undefined ? describeComparator(when.roll, 'roll') : []),
    ...Object.entries(when.params ?? {}).flatMap(([name, comparator]) => describeComparator(comparator, name)),
  ];

  return parts.join(' and ');
}

/**
 * Compose the tool description for a resolved roster.
 *
 * Called on EVERY tool build, so a definition added, edited, or deleted
 * mid-chat is reflected on the very next LLM call — and a brand-new chat gets
 * the full roster on turn one with no initialisation step.
 *
 * A tool with `revealOdds: false` contributes its name, description, and
 * parameters only: the model learns the tool exists and how to call it, but
 * never what the odds are.
 */
export function buildRunCustomDescription(roster: DiscoveredCustomTool[]): string {
  const lines: string[] = [RUN_CUSTOM_PREAMBLE];

  for (const { definition } of roster) {
    lines.push(`\n• ${definition.name} — ${definition.description}`);

    const params = Object.entries(definition.parameters ?? {});
    if (params.length > 0) {
      for (const [name, spec] of params) {
        const bounds =
          spec.min !== undefined || spec.max !== undefined
            ? `, ${[spec.min !== undefined ? `min ${spec.min}` : null, spec.max !== undefined ? `max ${spec.max}` : null]
                .filter(Boolean)
                .join(', ')}`
            : '';
        const detail = spec.description ? ` — ${spec.description}` : '';
        lines.push(`    - ${name} (${spec.type}, default ${JSON.stringify(spec.default)}${bounds})${detail}`);
      }
    }

    if (definition.revealOdds === false) {
      lines.push('    The odds are not disclosed.');
      continue;
    }

    lines.push(`    Roll: ${describeRoll(definition.roll)}`);
    for (const outcome of definition.outcomes) {
      lines.push(`    ${describeWhen(outcome.when)} → ${outcome.state}`);
    }
  }

  return lines.join('\n');
}

/**
 * Tool definition compatible with OpenAI's tool_calls format.
 *
 * The description here is the empty-roster form. Real calls go through
 * `buildToolsForProvider`, which swaps in a description built from that call's
 * freshly resolved roster.
 */
export const runCustomToolDefinition = {
  type: 'function',
  function: {
    name: 'run_custom',
    description: RUN_CUSTOM_PREAMBLE,
    parameters: zodToOpenAISchema(runCustomToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateRunCustomInput(input: unknown): RunCustomToolInput | null {
  const parsed = runCustomToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
