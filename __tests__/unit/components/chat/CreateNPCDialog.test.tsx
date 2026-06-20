/**
 * Regression test for CreateNPCDialog.
 *
 * Guards the two silent data-loss bugs where the ad-hoc NPC dialog POSTed
 * payload keys that the server `createCharacterSchema` strips:
 *   - `scenario` (scalar)            -> must be `scenarios: [{ title, content }]`
 *   - `physicalDescriptions` (array) -> must be singular `physicalDescription: {}`
 *
 * Zod silently drops the unknown keys, so type-checking can't catch this; the
 * only durable guard is to assert the outgoing POST body shape.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import React from 'react'
import CreateNPCDialog from '@/components/chat/CreateNPCDialog'

// Lexical is too heavy for jsdom; swap in a plain textarea keyed by aria-label
// so the test can set the field values directly.
jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// Toasts have no bearing on the payload assertion.
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

// jsdom may not expose crypto.randomUUID; shim only when missing.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    value: { ...(globalThis.crypto ?? {}), randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    configurable: true,
  })
}

const PROFILE = { id: 'profile-1', name: 'GPT', provider: 'openai', modelName: 'gpt-4' }

function routeFetch() {
  return jest.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.startsWith('/api/v1/connection-profiles')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ profiles: [PROFILE] }) } as Response)
    }
    if (url === '/api/v1/characters') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'new-char-1' }) } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
  })
}

describe('CreateNPCDialog payload shape', () => {
  let fetchSpy: ReturnType<typeof routeFetch>

  beforeEach(() => {
    fetchSpy = routeFetch()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('sends scenarios[] and a singular physicalDescription matching the server schema', async () => {
    renderWithQuery(
      <CreateNPCDialog isOpen onClose={() => {}} chatId="chat-1" onNPCCreated={() => {}} />
    )

    // Wait for connection profiles to load and auto-select.
    await screen.findByRole('option', { name: /GPT/ })

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Bartender' } })
    fireEvent.change(screen.getByLabelText('NPC description'), { target: { value: 'Gruff but kind.' } })
    fireEvent.change(screen.getByLabelText('Physical description'), { target: { value: 'Tall, bald.' } })
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'A smoky tavern.' } })

    const createBtn = screen.getByRole('button', { name: /Create NPC/i })
    await waitFor(() => expect(createBtn).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(createBtn)
    })

    const call = fetchSpy.mock.calls.find(([u]) => u === '/api/v1/characters')
    expect(call).toBeDefined()
    const body = JSON.parse((call![1] as RequestInit).body as string)

    // Bug 1: scenario must be a `scenarios` array, never a scalar `scenario`.
    expect(body.scenario).toBeUndefined()
    expect(body.scenarios).toEqual([
      expect.objectContaining({ title: 'Default', content: 'A smoky tavern.' }),
    ])

    // Bug 2: physical description must be a singular object, never a plural array.
    expect(body.physicalDescriptions).toBeUndefined()
    expect(body.physicalDescription).toEqual(
      expect.objectContaining({ name: 'Default', fullDescription: 'Tall, bald.' })
    )
  })
})
