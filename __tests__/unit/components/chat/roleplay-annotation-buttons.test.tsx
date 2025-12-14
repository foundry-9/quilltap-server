/**
 * Unit tests for RoleplayAnnotationButtons component
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React, { useRef, useState } from 'react'
import RoleplayAnnotationButtons from '@/components/chat/RoleplayAnnotationButtons'

interface HarnessProps {
  templateId: string | null
}

function AnnotationHarness({ templateId }: HarnessProps) {
  const [value, setValue] = useState('Hello')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  return (
    <div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        data-testid="composer"
      />
      <RoleplayAnnotationButtons
        roleplayTemplateId={templateId}
        inputRef={inputRef}
        input={value}
        setInput={setValue}
      />
    </div>
  )
}

function mockTemplateFetch(template: { id: string; name: string; description: string | null; isBuiltIn: boolean }) {
  return jest.spyOn(global as any, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => template,
  } as Response)
}

describe('RoleplayAnnotationButtons', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('wraps selected text using Standard annotations', async () => {
    mockTemplateFetch({
      id: 'standard',
      name: 'Standard',
      description: null,
      isBuiltIn: true,
    })

    render(<AnnotationHarness templateId="standard" />)

    const oocButton = await screen.findByRole('button', { name: /ooc/i })
    const textarea = screen.getByTestId('composer') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)

    fireEvent.click(oocButton)

    await waitFor(() => {
      expect(textarea.value).toBe('((Hello))')
    })
  })

  it('shows Quilltap RP annotations and inserts braces for internal monologue', async () => {
    mockTemplateFetch({
      id: 'quilltap',
      name: 'Quilltap RP',
      description: null,
      isBuiltIn: true,
    })

    render(<AnnotationHarness templateId="quilltap" />)

    const internalButton = await screen.findByRole('button', { name: /internal/i })
    const textarea = screen.getByTestId('composer') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)

    fireEvent.click(internalButton)

    await waitFor(() => {
      expect(textarea.value).toBe('{Hello}')
    })
  })
})

