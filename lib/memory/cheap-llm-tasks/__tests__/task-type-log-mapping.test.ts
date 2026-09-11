/**
 * `mapTaskTypeToLogType` — the cheap-LLM task type → `llm_logs.type` allowlist.
 *
 * The failure mode this guards is silent: an unmapped task type does not throw,
 * it files itself as SUMMARIZATION and disappears among the chat summaries in
 * the Almanack's Wire Records and the LLM inspector. Both voice rehearsals did
 * exactly that until `VOICE_REWRITE` was added.
 */

import { mapTaskTypeToLogType } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { LLMLogTypeEnum } from '@/lib/schemas/llm-log.types'

describe('mapTaskTypeToLogType', () => {
  it('files both voice rehearsals under VOICE_REWRITE', () => {
    expect(mapTaskTypeToLogType('announcement-rewrite')).toBe('VOICE_REWRITE')
    expect(mapTaskTypeToLogType('impersonation-voice-rewrite')).toBe('VOICE_REWRITE')
  })

  it('still maps the established task types', () => {
    expect(mapTaskTypeToLogType('memory-extraction-self')).toBe('MEMORY_EXTRACTION')
    expect(mapTaskTypeToLogType('title-chat')).toBe('TITLE_GENERATION')
    expect(mapTaskTypeToLogType('craft-image-prompt')).toBe('IMAGE_PROMPT_CRAFTING')
    expect(mapTaskTypeToLogType('custom-tool-consult')).toBe('CUSTOM_TOOL_CONSULT')
  })

  it('falls through to SUMMARIZATION for an unknown or absent task type', () => {
    expect(mapTaskTypeToLogType('something-nobody-mapped')).toBe('SUMMARIZATION')
    expect(mapTaskTypeToLogType(undefined)).toBe('SUMMARIZATION')
    expect(mapTaskTypeToLogType('')).toBe('SUMMARIZATION')
  })

  it('only ever returns a value the LLMLogType enum admits', () => {
    const known = new Set(LLMLogTypeEnum.options)
    for (const taskType of [
      'announcement-rewrite',
      'impersonation-voice-rewrite',
      'memory-extraction-self',
      'scene-state-tracking',
      'answer-confirmation',
      'not-a-real-task',
    ]) {
      expect(known.has(mapTaskTypeToLogType(taskType))).toBe(true)
    }
  })
})
