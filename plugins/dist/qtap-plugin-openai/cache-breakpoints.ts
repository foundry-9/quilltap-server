/**
 * Explicit prompt-cache breakpoints for GPT-5.6 and later.
 *
 * From gpt-5.6 on, OpenAI reuses a cached prefix only at a cache boundary,
 * never at an arbitrary matching token, and it looks a prefix up only at the
 * boundaries marked in the request being served (the first two and the latest
 * fifty explicit breakpoints, plus the implicit one). A request in `explicit`
 * mode writes cache entries at its latest four breakpoints.
 *
 * Left to the implicit default, a request writes after the leading developer
 * block and after the latest user message. A Salon turn's latest user message
 * carries that turn's trailing context sections, which are gone from the next
 * turn's copy of it, so that entry is never read and the history between the
 * two is never cached: on Friday a gpt-6.1-sol chat re-read only the tools and
 * system blocks on every turn and paid a write rate on everything after them.
 *
 * `applyOpenAICacheBreakpoints` therefore marks **every** stable boundary — the
 * end of the leading developer block, and every user / developer message and
 * function-call output after it — and leaves the turn-variable latest user
 * message unmarked unless a tool call follows it. Since a lookup can only land
 * on a boundary this request marks, marking them all is what lets a request
 * find the previous request's furthest entry, wherever it fell; since only the
 * latest four marks are written, the extra marks cost nothing. So:
 *
 *  - turn N+1 reads up to the last history message turn N wrote;
 *  - a tool loop's step k+1 reads up to step k's last tool output (the
 *    trailing message is marked in a tool loop, because every later step of
 *    the same turn repeats it);
 *  - a lone user message is marked, since an explicit-mode request with no
 *    breakpoints is not cached at all.
 *
 * Marks are capped at the leading developer block plus the latest
 * MAX_HISTORY_BREAKPOINTS, inside OpenAI's lookup window. Developer messages
 * and function-call outputs are always sent as `input_text` lists, marked or
 * not, so an item renders the same whether or not it carries a breakpoint
 * this time.
 *
 * @module qtap-plugin-openai/cache-breakpoints
 */

import type OpenAI from 'openai';

type ResponsesInputItem = OpenAI.Responses.ResponseInputItem;

const BREAKPOINT = { mode: 'explicit' } as const;

/**
 * History breakpoints kept after the leading developer block. OpenAI looks up
 * the first two and the latest fifty explicit breakpoints; the developer block
 * takes one of the first two.
 */
export const MAX_HISTORY_BREAKPOINTS = 48;

/** Content-block types that accept `prompt_cache_breakpoint`. */
const MARKABLE_BLOCK_TYPES = new Set(['input_text', 'input_image', 'input_file']);

interface MessageLike {
  type?: string;
  role?: string;
  content?: unknown;
}

interface FunctionCallOutputLike {
  type: 'function_call_output';
  output: unknown;
}

function isMessage(item: ResponsesInputItem, role?: 'user' | 'developer'): boolean {
  const m = item as MessageLike;
  if (m.type !== undefined && m.type !== 'message') return false;
  if (role) return m.role === role;
  return m.role === 'user' || m.role === 'developer';
}

function isFunctionCallOutput(item: ResponsesInputItem): item is ResponsesInputItem & FunctionCallOutputLike {
  return (item as { type?: string }).type === 'function_call_output';
}

/** A markable item: a user or developer message, or a function-call output. */
function isMarkable(item: ResponsesInputItem): boolean {
  return isMessage(item) || isFunctionCallOutput(item);
}

/** Lift a non-empty string to one `input_text` block; leave anything else alone. */
function liftString(value: unknown): unknown {
  return typeof value === 'string' && value.length > 0 ? [{ type: 'input_text', text: value }] : value;
}

/**
 * Put a breakpoint on the last block of a content list. Returns the new list,
 * or null when there is nothing markable (empty, or a last block of another
 * type).
 */
function markBlocks(blocks: unknown): unknown[] | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const last = blocks[blocks.length - 1] as { type?: string } | null;
  if (!last || !MARKABLE_BLOCK_TYPES.has(last.type ?? '')) return null;
  return [...blocks.slice(0, -1), { ...last, prompt_cache_breakpoint: BREAKPOINT }];
}

function markItem(input: ResponsesInputItem[], index: number): boolean {
  const item = input[index];
  if (isFunctionCallOutput(item)) {
    const output = markBlocks(item.output);
    if (!output) return false;
    input[index] = { ...item, output } as ResponsesInputItem;
    return true;
  }
  const content = markBlocks((item as MessageLike).content);
  if (!content) return false;
  input[index] = { ...(item as object), content } as ResponsesInputItem;
  return true;
}

/**
 * Normalise and mark the input for explicit-mode caching (see the module
 * comment). Mutates `input` in place — the array is built fresh for each
 * request — and returns how many breakpoints were placed.
 */
export function applyOpenAICacheBreakpoints(input: ResponsesInputItem[]): number {
  if (input.length === 0) return 0;

  // Developer messages and function-call outputs always travel as lists, so
  // gaining or losing a breakpoint never changes how an item renders.
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (isFunctionCallOutput(item)) {
      input[i] = { ...item, output: liftString(item.output) } as ResponsesInputItem;
    } else if (isMessage(item, 'developer')) {
      input[i] = { ...(item as object), content: liftString((item as MessageLike).content) } as ResponsesInputItem;
    }
  }

  let leadingDeveloperEnd = -1;
  while (leadingDeveloperEnd + 1 < input.length && isMessage(input[leadingDeveloperEnd + 1], 'developer')) {
    leadingDeveloperEnd++;
  }

  let latestUser = -1;
  for (let i = input.length - 1; i >= 0; i--) {
    if (isMessage(input[i], 'user')) {
      latestUser = i;
      break;
    }
  }
  // The latest user message carries this turn's trailing sections. It is a
  // stable boundary only inside a tool loop, where later steps repeat it.
  const toolLoopAfterLatestUser =
    latestUser >= 0 && input.slice(latestUser + 1).some((item) => isFunctionCallOutput(item));

  const history: number[] = [];
  for (let i = leadingDeveloperEnd + 1; i < input.length; i++) {
    if (!isMarkable(input[i])) continue;
    if (i === latestUser && !toolLoopAfterLatestUser) continue;
    history.push(i);
  }

  const chosen: number[] = [];
  if (leadingDeveloperEnd >= 0) chosen.push(leadingDeveloperEnd);
  chosen.push(...history.slice(-MAX_HISTORY_BREAKPOINTS));

  let placed = 0;
  for (const index of chosen) {
    if (markItem(input, index)) placed++;
  }

  // Nothing else to mark (a lone user message): mark the latest user message,
  // since an explicit-mode request with no breakpoints is not cached at all.
  if (placed === 0 && latestUser >= 0 && markItem(input, latestUser)) placed++;
  return placed;
}

/** Remove every `prompt_cache_breakpoint` from an input array (a copy). */
function stripBreakpoints(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  const strip = (blocks: unknown): unknown =>
    Array.isArray(blocks)
      ? blocks.map((block) => {
          if (!block || typeof block !== 'object' || !('prompt_cache_breakpoint' in block)) return block;
          const { prompt_cache_breakpoint: _dropped, ...rest } = block as Record<string, unknown>;
          return rest;
        })
      : blocks;
  return input.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    if (Array.isArray(record.content)) return { ...record, content: strip(record.content) };
    if (Array.isArray(record.output)) return { ...record, output: strip(record.output) };
    return item;
  });
}

/**
 * A copy of the request with every prompt-cache control removed:
 * `prompt_cache_retention`, `prompt_cache_options` and the input's
 * breakpoints. `prompt_cache_key` (routing only) stays. Used for the one
 * retry after a model rejects a cache parameter.
 */
export function stripPromptCacheControls<T extends object>(requestParams: T): T {
  const {
    prompt_cache_retention: _retention,
    prompt_cache_options: _options,
    ...rest
  } = requestParams as Record<string, unknown>;
  return { ...rest, input: stripBreakpoints(rest.input) } as T;
}
