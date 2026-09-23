'use client'

/**
 * useScenarioBuilderRun
 *
 * Drives one Scenario Builder run: POSTs to
 * `/api/v1/scenario-builder?action=build`, folds the SSE stream (tool calls,
 * reasoning, the terminal `done` or `error`) into state, and exposes `stop()`,
 * which aborts the fetch — the server sees the closed request and ends the loop.
 *
 * Nothing is cached: a run is a stream, not a query, so TanStack stays out of it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyAgentStreamEvent,
  EMPTY_AGENT_TOOL_CALL_STATE,
  parseAgentSseLine,
  splitSseBuffer,
  type AgentStreamToolCall,
  type AgentToolCallState,
} from '@/components/agent-stream/parse-agent-stream'
import type { ScenarioBuildRequestInput } from '@/lib/scenario-builder/request-schema'

export type ScenarioBuilderPhase = 'idle' | 'running' | 'done' | 'error'

export interface ScenarioBuilderRunState {
  phase: ScenarioBuilderPhase
  toolCalls: AgentStreamToolCall[]
  /** Cumulative reasoning for the current turn — DISPLAY ONLY. */
  reasoning: string
  /** The finished scene, once `done` arrives. */
  scenario: string | null
  error: string | null
}

const INITIAL: ScenarioBuilderRunState = {
  phase: 'idle',
  toolCalls: [],
  reasoning: '',
  scenario: null,
  error: null,
}

export function useScenarioBuilderRun() {
  const [state, setState] = useState<ScenarioBuilderRunState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const toolStateRef = useRef<AgentToolCallState>(EMPTY_AGENT_TOOL_CALL_STATE)

  // A closed dialog must not leave a run going.
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async (input: ScenarioBuildRequestInput): Promise<string | null> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState({ ...INITIAL, phase: 'running' })

    const fail = (message: string) => {
      setState((prev) => ({ ...prev, phase: 'error', error: message }))
      return null
    }

    try {
      const res = await fetch('/api/v1/scenario-builder?action=build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null
        return fail(data?.error || `The Host could not begin (HTTP ${res.status}).`)
      }

      const reader = res.body?.getReader()
      if (!reader) return fail('The Host could not begin: no response arrived.')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const split = splitSseBuffer(buffer, decoder.decode(value, { stream: true }))
        buffer = split.rest

        for (const line of split.lines) {
          const event = parseAgentSseLine(line)
          if (!event) continue

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
            return fail(String(event.error))
          }

          if (event.done && typeof event.scenario === 'string') {
            const scenario = event.scenario
            setState((prev) => ({ ...prev, phase: 'done', scenario, error: null }))
            return scenario
          }
        }
      }

      return fail('The Host went quiet before the scene was finished. Do try again.')
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setState(INITIAL)
        return null
      }
      return fail(error instanceof Error ? error.message : 'The Host could not complete the enquiry.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState(INITIAL)
  }, [])

  const reset = useCallback(() => {
    toolStateRef.current = EMPTY_AGENT_TOOL_CALL_STATE
    setState(INITIAL)
  }, [])

  return { ...state, run, stop, reset }
}
