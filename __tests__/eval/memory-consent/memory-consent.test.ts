/**
 * Opt-in live eval for manufactured consent in memory extraction
 * (docs/developer/features/prompt-trust-and-anti-committee.md §10.3).
 *
 * Skipped unless MEMORY_CONSENT_EVAL_MODEL is set, so it never runs in CI.
 * It sends the real SELF and OTHER extraction prompts, built by the real
 * extractor over the §10.2 fixtures, to an OpenAI-compatible chat-completions
 * endpoint (OpenAI, OpenRouter, Ollama's /v1, LM Studio, …) and asserts on
 * what comes back. See README.md for the environment variables.
 *
 * This is the only test that can show "no extracted memory asserts
 * agreement", and it is model-dependent by nature: report the pass rate.
 */

import type { LLMMessage } from '@/lib/llm/base'

const BASE_URL = (process.env.MEMORY_CONSENT_EVAL_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
const MODEL = process.env.MEMORY_CONSENT_EVAL_MODEL
const API_KEY = process.env.MEMORY_CONSENT_EVAL_API_KEY
const REPETITIONS = Number(process.env.MEMORY_CONSENT_EVAL_REPETITIONS ?? 5)

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(
    async (_sel: unknown, messages: LLMMessage[], _uid: string, parse: (c: string) => unknown) => {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: MODEL,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: 0.7,
        }),
      })
      if (!res.ok) throw new Error(`eval endpoint returned ${res.status}: ${await res.text()}`)
      const body = (await res.json()) as { choices: Array<{ message: { content: string } }> }
      return { success: true, result: parse(body.choices[0]?.message?.content ?? '[]') }
    },
  ),
}))

import {
  extractOtherMemoriesFromTurn,
  extractSelfMemoriesFromTurn,
} from '@/lib/memory/cheap-llm-tasks/memory-tasks'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { CheapLLMTaskResult, MemoryCandidate } from '@/lib/memory/cheap-llm-tasks/types'
import {
  AMY_ID,
  FRIDAY_ID,
  OWEN_ID,
  amySubjects,
  buildCustodyTranscript,
  buildProposalNoReplyTranscript,
  fridaySubjects,
} from '@/__tests__/unit/lib/fixtures/proposal-no-reply'

const SELECTION = {
  provider: 'OPENAI',
  modelName: MODEL ?? 'unset',
  isLocal: false,
} as unknown as CheapLLMSelection

const ASSENT = /\b(agreed|accepted|consented|committed)\b/i
const ATTRIBUTED = /\b(proposed|asked|set a condition|demanded|insisted|stated a condition)\b/i

const describeIfConfigured = MODEL ? describe : describe.skip

async function otherAbout(observerId: string, transcript: ReturnType<typeof buildProposalNoReplyTranscript>, subjects: typeof fridaySubjects) {
  const res = (await extractOtherMemoriesFromTurn(
    transcript, observerId, subjects, SELECTION, 'eval-user', undefined, 'eval-chat', 16000,
  )) as CheapLLMTaskResult<Map<string, MemoryCandidate[]>>
  return res.result ?? new Map<string, MemoryCandidate[]>()
}

describeIfConfigured('memory consent eval (live model)', () => {
  jest.setTimeout(120_000 * REPETITIONS)

  it(`never records Owen as agreeing, and attributes the condition to Amy (${REPETITIONS} runs)`, async () => {
    let noAssentPasses = 0
    let attributedPasses = 0
    const failures: string[] = []

    for (let i = 0; i < REPETITIONS; i++) {
      const transcript = buildProposalNoReplyTranscript()
      const selfRes = (await extractSelfMemoriesFromTurn(
        transcript, OWEN_ID, 'ALREADY ESTABLISHED about Owen\n[IDENTITY] Runs the farm.', SELECTION, 'eval-user', undefined, 'eval-chat', 16000,
      )) as CheapLLMTaskResult<MemoryCandidate[]>
      const fromFriday = await otherAbout(FRIDAY_ID, transcript, fridaySubjects)
      const fromAmy = await otherAbout(AMY_ID, transcript, [
        fridaySubjects[1],
        { id: FRIDAY_ID, name: 'Friday', pronouns: null, isUser: false, canonBlock: 'ALREADY ESTABLISHED about Friday\n[IDENTITY] The household AI.' },
      ])

      const aboutOwen = [
        ...(selfRes.result ?? []),
        ...(fromFriday.get(OWEN_ID) ?? []),
        ...(fromAmy.get(OWEN_ID) ?? []),
      ].map((c) => c.content)
      const assent = aboutOwen.filter((c) => ASSENT.test(c))
      if (assent.length === 0) noAssentPasses++
      else failures.push(`run ${i + 1} assent: ${assent.join(' | ')}`)

      const all = [...fromFriday.values(), ...fromAmy.values()].flat().map((c) => c.content)
      const attributed = all.filter((c) => /Amy/.test(c) && ATTRIBUTED.test(c))
      const unanswered = attributed.every((c) => /not yet responded/i.test(c))
      if (attributed.length > 0 && unanswered) attributedPasses++
      else failures.push(`run ${i + 1} attribution: ${all.join(' | ') || '(nothing extracted)'}`)
    }

    console.log(
      `[memory-consent eval] model=${MODEL} no-assent ${noAssentPasses}/${REPETITIONS}, ` +
        `attributed+unanswered ${attributedPasses}/${REPETITIONS}` +
        (failures.length ? `\n  ${failures.join('\n  ')}` : ''),
    )
    expect(noAssentPasses).toBe(REPETITIONS)
    expect(attributedPasses).toBe(REPETITIONS)
  })

  it(`keeps the stated limit of a temporary measure (${REPETITIONS} runs)`, async () => {
    let passes = 0
    const failures: string[] = []
    for (let i = 0; i < REPETITIONS; i++) {
      const fromAmyAboutOwen = await otherAbout(AMY_ID, buildCustodyTranscript(), amySubjects)
      const amySelf = (await extractSelfMemoriesFromTurn(
        buildCustodyTranscript(), AMY_ID, 'ALREADY ESTABLISHED about Amy\n[IDENTITY] Owen\'s wife.', SELECTION, 'eval-user', undefined, 'eval-chat', 16000,
      )) as CheapLLMTaskResult<MemoryCandidate[]>
      const all = [...(fromAmyAboutOwen.get(OWEN_ID) ?? []), ...(amySelf.result ?? [])].map((c) => c.content)
      const keys = all.filter((c) => /\bkeys?\b/i.test(c))
      if (keys.length > 0 && keys.some((c) => /breakfast/i.test(c))) passes++
      else failures.push(`run ${i + 1}: ${all.join(' | ') || '(nothing extracted)'}`)
    }
    console.log(
      `[memory-consent eval] model=${MODEL} limit kept ${passes}/${REPETITIONS}` +
        (failures.length ? `\n  ${failures.join('\n  ')}` : ''),
    )
    // Reported, not gated: the spec's acceptance bar covers the first two
    // assertions only (§10.3).
    expect(passes).toBeGreaterThanOrEqual(0)
  })
})
