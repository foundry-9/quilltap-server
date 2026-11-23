'use client'

/**
 * useScenarioBuilderRun
 *
 * Drives one Scenario Builder run: `useAgentStreamRun` against
 * `/api/v1/scenario-builder?action=build`, whose `done` event carries the
 * scene as `scenario`. `stop()` aborts the fetch — the server sees the closed
 * request and ends the loop.
 */

import { useAgentStreamRun, type AgentStreamPhase } from '@/components/agent-stream/useAgentStreamRun'
import type { AgentStreamEvent } from '@/components/agent-stream/parse-agent-stream'
import type { ScenarioBuildRequestInput } from '@/lib/scenario-builder/request-schema'

export type ScenarioBuilderPhase = AgentStreamPhase

const readScene = (event: AgentStreamEvent): string | null =>
  typeof event.scenario === 'string' ? event.scenario : null

const MESSAGES = {
  cannotBegin: (status: number) => `The Host could not begin (HTTP ${status}).`,
  noBody: 'The Host could not begin: no response arrived.',
  wentQuiet: 'The Host went quiet before the scene was finished. Do try again.',
  failed: 'The Host could not complete the enquiry.',
}

export function useScenarioBuilderRun() {
  const { result, ...rest } = useAgentStreamRun<ScenarioBuildRequestInput, string>({
    url: '/api/v1/scenario-builder?action=build',
    readDone: readScene,
    messages: MESSAGES,
  })
  return { ...rest, scenario: result }
}
