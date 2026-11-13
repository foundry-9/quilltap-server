/**
 * The Writing Assistant's agent-mode wording: finish with
 * submit_final_response carrying the finished piece and nothing else.
 */

import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
  WRITING_FINISH_NOW,
} from '@/lib/services/chat-message/agent-mode-resolver.service'

describe("agent-mode instructions — 'writing'", () => {
  it('asks for the finished piece through submit_final_response, and states the budget', () => {
    const text = buildAgentModeInstructions(12, 'writing')
    expect(text).toContain('submit_final_response')
    expect(text).toMatch(/finished piece and nothing else/)
    expect(text).toContain('**12 tool iterations**')
    expect(text).not.toMatch(/summary of what you did/)
  })

  it('forces the finish with the same wording', () => {
    expect(buildForceFinalMessage('writing')).toBe(WRITING_FINISH_NOW)
    expect(WRITING_FINISH_NOW).toMatch(/finished piece and nothing else/)
  })

  it('leaves the research wording as it was', () => {
    expect(buildAgentModeInstructions(5, 'research')).toMatch(/structured summary/)
    expect(buildForceFinalMessage('research')).toMatch(/best answer/)
  })
})
