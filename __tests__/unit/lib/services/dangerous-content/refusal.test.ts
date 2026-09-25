/**
 * classifyRefusal — the one definition of "the provider refused on content
 * grounds". A table of recorded provider error shapes, plus the evidence
 * precedence and the things that must NOT count as a refusal.
 */

import { describe, it, expect } from '@jest/globals'
import {
  classifyRefusal,
  isModerationRefusal,
  MODERATION_REJECTION_CODE,
} from '@/lib/services/dangerous-content/refusal'

/** The OpenAI SDK's APIError shape: top-level `status` / `code`, body under `error`. */
function openAIError(code: string, message: string, status = 400) {
  const err = new Error(`${status} ${message}`) as Error & Record<string, unknown>
  err.status = status
  err.code = code
  err.error = { code, message, type: 'invalid_request_error' }
  return err
}

describe('classifyRefusal — recorded provider errors', () => {
  const refused: Array<[string, unknown, string]> = [
    ['OpenAI gpt-image moderation_blocked', openAIError('moderation_blocked', 'Your request was rejected by the safety system.'), 'provider-code'],
    ['OpenAI DALL-E content_policy_violation', openAIError('content_policy_violation', 'Your request was rejected as a result of our safety system.'), 'provider-code'],
    ['OpenAI nested code only', Object.assign(new Error('400 bad request'), { error: { code: 'content_policy_violation' } }), 'provider-code'],
    ['Google Imagen filtered prediction', new Error('Imagen returned no image: the prompt was blocked by safety filters (content policy).'), 'message-pattern'],
    ['Gemini IMAGE_SAFETY', new Error('Gemini image generation stopped: finishReason IMAGE_SAFETY'), 'message-pattern'],
    ['Google Responsible AI HTTP message', new Error('400 The prompt could not be submitted. This prompt contains words that violate Google\'s Responsible AI practices.'), 'message-pattern'],
    ['Grok content moderation', new Error('Generated image rejected by content moderation.'), 'message-pattern'],
    ['OpenRouter declined', new Error('Model declined to generate an image'), 'message-pattern'],
    ['Z.AI 1301 (numeric code)', Object.assign(new Error('Contains sensitive content'), { code: 1301 }), 'provider-code'],
    ['Z.AI 1301 (string code)', Object.assign(new Error('Contains sensitive content'), { code: '1301' }), 'provider-code'],
  ]

  it.each(refused)('%s → refused', (_label, error, evidence) => {
    const verdict = classifyRefusal({ error })
    expect(verdict.refused).toBe(true)
    expect(verdict.evidence).toBe(evidence)
    expect(verdict.detail).toBeDefined()
    expect(verdict.detail!.length).toBeLessThanOrEqual(200)
  })

  const notRefused: Array<[string, unknown]> = [
    ['NanoGPT generic 400', new Error('400 Bad Request: Please try a different prompt')],
    ['a 429', Object.assign(new Error('429 Too Many Requests'), { status: 429, code: 'rate_limit_exceeded' })],
    ['an auth failure', Object.assign(new Error('401 Incorrect API key provided'), { code: 'invalid_api_key' })],
    ['a network error with "safety" as a path segment', new Error('fetch failed: ECONNREFUSED https://example.com/v1/safety/check')],
    ['a bare 400', new Error('400 Bad Request')],
    ['nothing at all', undefined],
  ]

  it.each(notRefused)('%s → not refused', (_label, error) => {
    expect(classifyRefusal({ error }).refused).toBe(false)
  })
})

describe('classifyRefusal — evidence precedence', () => {
  it('a typed error wins, even with a misleading message', () => {
    const err = Object.assign(new Error('429 rate limit, try later'), {
      code: MODERATION_REJECTION_CODE,
      providerReason: 'IMAGE_SAFETY',
    })
    const verdict = classifyRefusal({ error: err })
    expect(verdict).toMatchObject({ refused: true, evidence: 'typed-error' })
    expect(verdict.detail).toContain('IMAGE_SAFETY')
  })

  it('recognises the class by name when the code is missing (an un-bundled plugin copy)', () => {
    const err = new Error('refused')
    err.name = 'ModerationRejectionError'
    expect(classifyRefusal({ error: err }).evidence).toBe('typed-error')
  })

  it('a provider code outranks a finish reason', () => {
    const verdict = classifyRefusal({
      error: openAIError('moderation_blocked', 'blocked'),
      finishReason: 'content_filter',
    })
    expect(verdict.evidence).toBe('provider-code')
  })

  it('reads a stated finish reason', () => {
    expect(classifyRefusal({ finishReason: 'content_filter' })).toEqual({
      refused: true,
      evidence: 'finish-reason',
      detail: 'finish_reason: content_filter',
    })
  })

  it('infers a refusal only from an empty body on flagged content', () => {
    expect(classifyRefusal({ emptyBody: true, contentWasFlagged: true })).toMatchObject({
      refused: true,
      evidence: 'inferred',
    })
    expect(classifyRefusal({ emptyBody: true, contentWasFlagged: false }).refused).toBe(false)
    expect(classifyRefusal({ emptyBody: false, contentWasFlagged: true }).refused).toBe(false)
  })

  it('never lets a detail run past 200 characters', () => {
    const verdict = classifyRefusal({ error: new Error(`content policy ${'x'.repeat(500)}`) })
    expect(verdict.detail!.length).toBeLessThanOrEqual(200)
  })

  it('isModerationRefusal is the same question at a catch site', () => {
    expect(isModerationRefusal(new Error('rejected by content moderation'))).toBe(true)
    expect(isModerationRefusal(new Error('socket hang up'))).toBe(false)
  })
})
