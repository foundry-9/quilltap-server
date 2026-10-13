/**
 * The episode prompt: 0–{@link FOLD_EPISODE_CAP} consolidated, dated episode
 * records over a folded stretch. Body moved unchanged from the retired
 * `cheap-llm-tasks/memory-tasks.ts` (memory refactor Phase D).
 *
 * @module memory/extraction/prompts/episode
 */

import type { LLMMessage } from '@/lib/llm/base'
import { renderStretch, type StretchMessage } from '../window'
import { renderClockStamp, type ExtractionClock } from './shared'

/** Hard cap on consolidated episodes per fold. */
export const FOLD_EPISODE_CAP = 2

const FOLD_EPISODE_PROMPT = `You are consolidating a batch of roleplay conversation turns into EPISODE records — coherent, dated accounts of specific things that happened.

An episode is a real occurrence at a specific time and/or place: an outing, a visit, an arrival, a completed undertaking, a notable incident. It is NOT a standing fact, an opinion, a mood, or an ongoing thread — only something that happened.

Read the dated turns below. Return 0–${FOLD_EPISODE_CAP} episodes. Most windows contain none — return [] freely. Only emit an episode when the turns actually depict or recount a specific occurrence worth remembering as an event.

For each episode:
  narrative     2–3 sentences, past tense, third person, using participant
                names. The prose must ITSELF name the place and the time
                ("On July 14th, Amy and Charlie visited Lighthouse Point
                and bought the brass sextant…").
  summary       3–8 words, lowercase, no punctuation
  when          when it happened: an absolute date (YYYY-MM-DD, resolved
                against the message timestamps and the CLOCK line) whenever
                possible, otherwise the phrase as stated
  narrativeTime the in-story time phrase, only when the story runs on a
                fictional timeline ("the third night at sea")
  entities      2–6 proper nouns: places, people, named things
  importance    0.20–1.00 (0.9 = a day the participants will retell for
                years; 0.5 = a pleasant but ordinary outing)

An episode records what was said and done, not what was agreed: attribute proposals and conditions to their speaker, and record an agreement only where the agreeing party's own assent appears in the window.

Return a JSON array only. No prose, no code fences. If nothing qualifies, return [].`

/** The episode call's messages over a stretch. The clock rides inline, as it always has. */
export function buildEpisodeFoldMessages(input: {
  stretch: ReadonlyArray<StretchMessage>
  clock: ExtractionClock
}): LLMMessage[] {
  const clockLine =
    `CLOCK: current date/time ${renderClockStamp(input.clock)}; timeline mode ${input.clock.timelineMode}`
  return [
    { role: 'system', content: FOLD_EPISODE_PROMPT },
    { role: 'user', content: `${clockLine}\n\nDATED TURNS:\n\n${renderStretch(input.stretch)}` },
  ]
}
