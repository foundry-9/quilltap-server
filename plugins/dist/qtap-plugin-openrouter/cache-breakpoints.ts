/**
 * Explicit prompt-cache breakpoints for Claude on OpenRouter.
 *
 * Claude caches only at `cache_control` breakpoints, at most four per
 * request, and a lookup walks back about twenty blocks from each breakpoint
 * for an entry an earlier request wrote. OpenRouter's "automatic" mode (a
 * top-level `cache_control`) puts its one breakpoint on the last block — and
 * a Salon turn's last block is the newest user line wrapped in that turn's
 * trailing sections, which the next turn never repeats. Automatic mode would
 * therefore pay the write premium on every turn and read back almost nothing.
 *
 * So, like the direct Anthropic plugin, breakpoints go where the prompt is
 * stable:
 *
 *  1. the first system message (the identity stack — tools and system sit
 *     before it in Claude's prefix order, so they ride along);
 *  2. the history: the message just before the newest user line and the
 *     previous reply before the final run of user messages, so turn N+1
 *     reads up to what turn N wrote. The newest user line is the last `user`
 *     message, which a multi-character prefill (`[Name]`) may follow. In a
 *     tool loop the final tool result is marked too, since every later step
 *     repeats it;
 *  3. the host's own mark (`cacheControl` on the summary head), when present;
 *  4. on long arrays, a mid-history breakpoint on a stepped index, which
 *     stays put across turns and survives the tail moving out of lookback
 *     range.
 *
 * Every string content is lifted to one text part, marked or not (see
 * `liftAll`): OpenRouter merges consecutive same-role messages, and a lift on
 * the marked message alone changed how its run rendered — which, live on
 * V4test, cost every history hit.
 *
 * @module qtap-plugin-openrouter/cache-breakpoints
 */

export const MAX_CLAUDE_CACHE_BREAKPOINTS = 4;
const MIN_MESSAGES_FOR_MID_BREAKPOINT = 20;
const MID_BREAKPOINT_STEP = 15;

type CacheControl = { type: 'ephemeral'; ttl?: '1h' };

export function claudeCacheControl(ttl?: '5m' | '1h'): CacheControl {
  return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

/**
 * Mark the last text part of `messages[index]`. Returns false when the
 * message has no text to carry a mark (empty, tool-call-only, image last).
 */
function markMessage(messages: Array<Record<string, any>>, index: number, cc: CacheControl): boolean {
  const msg = messages[index];
  if (!msg) return false;
  const content = msg.content;
  if (typeof content === 'string') {
    if (content.length === 0) return false;
    messages[index] = { ...msg, content: [{ type: 'text', text: content, cache_control: cc }] };
    return true;
  }
  if (Array.isArray(content) && content.length > 0) {
    const last = content[content.length - 1];
    if (last?.cache_control) return true;
    if (last?.type !== 'text') return false;
    messages[index] = { ...msg, content: [...content.slice(0, -1), { ...last, cache_control: cc }] };
    return true;
  }
  return false;
}

/**
 * Lift every non-empty string content to one text part. OpenRouter merges
 * consecutive same-role messages before they reach Claude, and how it joins
 * a run depends on whether each member is a string or a list — so a mark
 * that lifted only its own message would change how its unmarked neighbours
 * render, and the prefix with them. Lifting everything keeps a message's
 * rendering the same whether or not it carries a mark this time.
 */
function liftAll(messages: Array<Record<string, any>>): void {
  for (let i = 0; i < messages.length; i++) {
    const content = messages[i].content;
    if (typeof content === 'string' && content.length > 0) {
      messages[i] = { ...messages[i], content: [{ type: 'text', text: content }] };
    }
  }
}

/**
 * Place Claude breakpoints on an OpenAI-shape `messages` array (mutated in
 * place; it is built fresh per request). `hostMarked` holds the indexes the
 * host flagged with `cacheControl`. Returns the indexes marked.
 *
 * The newest user line is the last `user` message — not necessarily the
 * final message, since a multi-character prefill (`[Name]`) or a tool loop
 * can follow it. Outside a tool loop the history marks are the message just
 * before it (the turn's whispers, which are recorded and recur) and the last
 * non-user message before the final run of user messages (the previous
 * reply), so the next turn finds one or the other.
 */
export function applyClaudeCacheBreakpoints(
  messages: Array<Record<string, any>>,
  hostMarked: ReadonlySet<number>,
  ttl?: '5m' | '1h',
): number[] {
  if (messages.length === 0) return [];
  liftAll(messages);
  const cc = claudeCacheControl(ttl);
  const placed: number[] = [];
  const tryMark = (index: number): boolean => {
    if (index < 0 || placed.length >= MAX_CLAUDE_CACHE_BREAKPOINTS || placed.includes(index)) return false;
    if (messages[index]?.role === 'system' && placed.length > 0) return false;
    if (!markMessage(messages, index, cc)) return false;
    placed.push(index);
    return true;
  };

  const firstSystem = messages.findIndex((m) => m.role === 'system');
  if (firstSystem >= 0) tryMark(firstSystem);

  let latestUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { latestUser = i; break; }
  }
  const last = messages.length - 1;
  const toolLoop = latestUser >= 0 && messages.slice(latestUser + 1).some((m) => m.role === 'tool');

  // The turn-variable newest line is never marked, except as the only thing
  // there is (or inside a tool loop, where every later step repeats it).
  const variable = toolLoop ? -1 : latestUser;
  let tailIndex = -1;
  if (toolLoop && messages[last]?.role === 'tool' && tryMark(last)) tailIndex = last;

  if (latestUser > firstSystem) {
    if (tryMark(latestUser - 1) && tailIndex < 0) tailIndex = latestUser - 1;
    let runStart = latestUser;
    while (runStart - 1 > firstSystem && messages[runStart - 1].role === 'user') runStart--;
    for (let i = runStart - 1; i > firstSystem; i--) {
      if (messages[i].role === 'system') continue;
      if (placed.includes(i) || tryMark(i)) break;
    }
  }

  // The host's flag never marks the turn-variable newest line.
  for (const index of [...hostMarked].sort((a, b) => a - b)) {
    if (index !== variable) tryMark(index);
  }

  if (messages.length >= MIN_MESSAGES_FOR_MID_BREAKPOINT) {
    const stepped = Math.floor((messages.length - MID_BREAKPOINT_STEP) / MID_BREAKPOINT_STEP) * MID_BREAKPOINT_STEP;
    const role = messages[stepped]?.role;
    if (stepped > firstSystem && (tailIndex < 0 || stepped < tailIndex) && (role === 'user' || role === 'assistant')) {
      tryMark(stepped);
    }
  }

  return placed;
}
