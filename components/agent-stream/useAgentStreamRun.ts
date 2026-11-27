'use client'

/**
 * useAgentStreamRun
 *
 * Drives one run of a one-shot agent surface (the Scenario Builder, the
 * Atlas's lore draft): POSTs a body to `url`, folds the SSE stream (tool
 * calls, reasoning, the terminal `done` or `error`) into state, and exposes
 * `stop()`, which aborts the fetch — the server sees the closed request and
 * ends the loop. `readDone` picks the result out of the `done` event, or
 * returns null when the event does not carry one.
 *
 * Nothing is cached: a run is a stream, not a query, so TanStack stays out of it.
 *
 * @module components/agent-stream/useAgentStreamRun
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyAgentStreamEvent,
  EMPTY_AGENT_TOOL_CALL_STATE,
  readAgentSse,
  type AgentStreamEvent,
  type AgentStreamToolCall,
  type AgentToolCallState,
} from './parse-agent-stream'

export type AgentStreamPhase = 'idle' | 'running' | 'done' | 'error'

export interface AgentStreamRunState<T> {
  phase: AgentStreamPhase
  toolCalls: AgentStreamToolCall[]
  /** Cumulative reasoning for the current turn — DISPLAY ONLY. */
  reasoning: string
  /** The finished result, once `done` arrives. */
  result: T | null
  error: string | null
}

export interface AgentStreamRunOptions<T> {
  url: string
  /** The result a `done` event carries, or null when it carries none. */
  readDone: (event: AgentStreamEvent) => T | null
  /** The surface's words for its failures. */
  messages: {
    cannotBegin: (status: number) => string
    noBody: string
    wentQuiet: string
    failed: string
  }
}

function initialState<T>(): AgentStreamRunState<T> {
  return { phase: 'idle', toolCalls: [], reasoning: '', result: null, error: null }
}

export function useAgentStreamRun<TInput, T>({ url, readDone, messages }: AgentStreamRunOptions<T>) {
  const [state, setState] = useState<AgentStreamRunState<T>>(initialState)
  const abortRef = useRef<AbortController | null>(null)
  const toolStateRef = useRef<AgentToolCallState>(EMPTY_AGENT_TOOL_CALL_STATE)
  // A closed dialog must not leave a run going.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Callers pass a stable url, a module-level reader and module-level words.
  const run = useCallback(async (input: TInput): Promise<T | null> => {
    const target = url
    const pick = readDone
    const words = messages
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState({ ...initialState<T>(), phase: 'running' })

    const fail = (message: string) => {
      setState((prev) => ({ ...prev, phase: 'error', error: message }))
      return null
    }

    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        return fail(data?.error || words.cannotBegin(res.status))
      }

      if (!res.body) return fail(words.noBody)

      let outcome: T | null = null
      let finished = false
      await readAgentSse(res, (event) => {
        const nextToolState = applyAgentStreamEvent(toolStateRef.current, event)
        if (nextToolState !== toolStateRef.current) {
          toolStateRef.current = nextToolState
          setState((prev) => ({ ...prev, toolCalls: nextToolState.toolCalls }))
        }

        // Cumulative per turn — replace, not append.
        if (typeof event.reasoning === 'string') {
          const reasoning = event.reasoning
          setState((prev) => ({ ...prev, reasoning }))
        }

        if (event.error) {
          fail(String(event.error))
          finished = true
          return true
        }

        if (event.done) {
          const result = pick(event)
          if (result !== null) {
            setState((prev) => ({ ...prev, phase: 'done', result, error: null }))
            outcome = result
            finished = true
            return true
          }
        }
      })
      if (finished) return outcome

      return fail(words.wentQuiet)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setState(initialState<T>())
        return null
      }
      return fail(error instanceof Error ? error.message : words.failed)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [url, readDone, messages])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState(initialState<T>())
  }, [])

  const reset = useCallback(() => {
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState(initialState<T>())
  }, [])

  return { ...state, run, stop, reset }
}
