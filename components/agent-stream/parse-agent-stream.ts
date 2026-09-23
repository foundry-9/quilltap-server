/**
 * Agent SSE stream parsing — shared by every client that watches a tool-using
 * agent loop stream (the Brahma Console, the Scenario Builder).
 *
 * Pure functions, no React: `parseAgentSseLine` turns one `data:` line into an
 * event object, `splitSseBuffer` handles partial lines across reads, and
 * `applyAgentStreamEvent` folds the tool-call events (`toolsDetected` →
 * pending entries, `toolResult` → settled by batch + index) into an immutable
 * tool-call state. Hooks keep the rest (content, reasoning, done, error) since
 * what those mean differs per surface.
 */

/**
 * A tool call observed live on the stream. Built from a `toolsDetected` event
 * (name + arguments) and completed by the matching `toolResult` event.
 */
export interface AgentStreamToolCall {
  name: string
  arguments: Record<string, unknown>
  /** Result payload once it arrives (often null on failure). */
  result?: unknown
  success?: boolean
  /** Human-readable error text on failure. */
  error?: string
  /** True until the matching toolResult event fills this in. */
  pending: boolean
}

/**
 * Tool calls accumulated across a whole agent run, plus the base offset of the
 * current detection batch — a `toolResult` is indexed within its batch, so the
 * base maps it back to the right entry across several agent turns.
 */
export interface AgentToolCallState {
  toolCalls: AgentStreamToolCall[]
  batchBase: number
}

export const EMPTY_AGENT_TOOL_CALL_STATE: AgentToolCallState = { toolCalls: [], batchBase: 0 }

/** A parsed SSE event: whatever JSON object the server sent. */
export type AgentStreamEvent = Record<string, unknown>

/** Parse one SSE line. Returns null for comments, blank lines, and bad JSON. */
export function parseAgentSseLine(line: string): AgentStreamEvent | null {
  if (!line.startsWith('data: ')) return null
  const jsonStr = line.slice(6).trim()
  if (!jsonStr) return null
  try {
    const parsed: unknown = JSON.parse(jsonStr)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as AgentStreamEvent)
      : null
  } catch {
    return null
  }
}

/**
 * Append a decoded chunk to the carry-over buffer and split out the complete
 * lines. The trailing partial line (if any) comes back as `rest`.
 */
export function splitSseBuffer(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const lines = (buffer + chunk).split('\n')
  const rest = lines.pop() ?? ''
  return { lines, rest }
}

/**
 * Fold one event into the tool-call state. Returns the SAME object when the
 * event carries nothing tool-related, so callers can skip a re-render.
 */
export function applyAgentStreamEvent(
  state: AgentToolCallState,
  event: AgentStreamEvent,
): AgentToolCallState {
  let next = state

  if (typeof event.toolsDetected === 'number') {
    const names: unknown[] = Array.isArray(event.toolNames) ? event.toolNames : []
    const argsArr: unknown[] = Array.isArray(event.toolArguments) ? event.toolArguments : []
    const added: AgentStreamToolCall[] = []
    for (let i = 0; i < event.toolsDetected; i++) {
      const a = argsArr[i]
      added.push({
        name: typeof names[i] === 'string' ? (names[i] as string) : 'unknown',
        arguments: a && typeof a === 'object' ? (a as Record<string, unknown>) : {},
        pending: true,
      })
    }
    next = { toolCalls: [...next.toolCalls, ...added], batchBase: next.toolCalls.length }
  }

  if (event.toolResult && typeof event.toolResult === 'object') {
    const tr = event.toolResult as { index?: number; success?: boolean; result?: unknown; error?: unknown }
    const gi = next.batchBase + (typeof tr.index === 'number' ? tr.index : 0)
    const entry = next.toolCalls[gi]
    if (entry) {
      const toolCalls = [...next.toolCalls]
      toolCalls[gi] = {
        ...entry,
        result: tr.result,
        success: tr.success,
        error: typeof tr.error === 'string' ? tr.error : undefined,
        pending: false,
      }
      next = { ...next, toolCalls }
    }
  }

  return next
}
