/**
 * One resolution order for "which prompt does this character start with",
 * shared by the new-chat picker, the announcement dialog, the voice preview and
 * the chat initializer. Two of those used to give up and start the chat with no
 * prompt at all when the `defaultSystemPromptId` column named a prompt the
 * character no longer had — which is exactly what a stale column looks like.
 */

import { describe, expect, it } from '@jest/globals'

import {
  resolveDefaultSystemPrompt,
  resolveDefaultSystemPromptId,
} from '@/lib/characters/default-system-prompt'

const main = { id: 'main', isDefault: true, content: 'the everyday voice' }
const frontLine = { id: 'front-line', isDefault: false, content: 'the fighting has started' }

it('prefers the column when it names a prompt the character has', () => {
  const resolved = resolveDefaultSystemPrompt({
    systemPrompts: [main, frontLine],
    defaultSystemPromptId: 'front-line',
  })
  expect(resolved?.id).toBe('front-line')
})

it('falls through to the isDefault flag when the column is null', () => {
  expect(
    resolveDefaultSystemPromptId({ systemPrompts: [frontLine, main], defaultSystemPromptId: null })
  ).toBe('main')
})

it('falls through to the flag when the column names a prompt that is gone', () => {
  expect(
    resolveDefaultSystemPromptId({
      systemPrompts: [main, frontLine],
      defaultSystemPromptId: 'deleted-long-ago',
    })
  ).toBe('main')
})

it('falls through to the first prompt when nothing is marked default', () => {
  expect(
    resolveDefaultSystemPromptId({
      systemPrompts: [frontLine, { ...main, isDefault: false }],
    })
  ).toBe('front-line')
})

it('answers null for a character with no prompts at all', () => {
  expect(resolveDefaultSystemPrompt({ systemPrompts: [] })).toBeNull()
  expect(resolveDefaultSystemPromptId({})).toBeNull()
  expect(resolveDefaultSystemPromptId({ systemPrompts: null, defaultSystemPromptId: 'main' })).toBeNull()
})
