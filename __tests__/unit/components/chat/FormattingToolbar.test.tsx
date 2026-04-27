import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useRef, useState } from 'react'
import FormattingToolbar from '@/components/chat/FormattingToolbar'

const mockEditor = {
  registerUpdateListener: jest.fn(() => () => {}),
  update: jest.fn((callback: () => void) => callback()),
  dispatchCommand: jest.fn(),
  focus: jest.fn(),
}

interface HarnessProps {
  initialValue?: string
  narrationDelimiters?: string | [string, string]
}

function ToolbarHarness({
  initialValue = 'Hello world',
  narrationDelimiters,
}: HarnessProps) {
  const [value, setValue] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  return (
    <div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        data-testid="composer"
      />
      <FormattingToolbar
        editor={mockEditor as any}
        showSource
        sourceTextareaRef={textareaRef}
        setInput={setValue}
        onToggleSource={() => {}}
        narrationDelimiters={narrationDelimiters}
      />
    </div>
  )
}

describe('FormattingToolbar', () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame

  beforeEach(() => {
    jest.clearAllMocks()
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }) as typeof requestAnimationFrame
  })

  afterEach(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame
  })

  it('wraps selected text with bold markers in source mode', async () => {
    render(<ToolbarHarness initialValue="Hello" />)

    const textarea = screen.getByTestId('composer') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)

    fireEvent.click(screen.getByRole('button', { name: 'B' }))

    await waitFor(() => {
      expect(textarea.value).toBe('**Hello**')
    })
  })

  it('prefixes the current line for heading buttons in source mode', async () => {
    render(<ToolbarHarness initialValue="Hello" />)

    const textarea = screen.getByTestId('composer') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(0, 0)

    fireEvent.click(screen.getByRole('button', { name: 'H4' }))

    await waitFor(() => {
      expect(textarea.value).toBe('#### Hello')
    })
  })

  it('inserts a fenced code block when there is no selection in source mode', async () => {
    render(<ToolbarHarness initialValue="Hello" />)

    const textarea = screen.getByTestId('composer') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)

    fireEvent.click(screen.getByRole('button', { name: 'CODE' }))

    await waitFor(() => {
      expect(textarea.value).toBe('Hello\n```\n\n```')
    })
  })

  it('wraps selected text with narration delimiters in source mode', async () => {
    render(<ToolbarHarness initialValue="Hello" narrationDelimiters={['<<', '>>']} />)

    const textarea = screen.getByTestId('composer') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(0, textarea.value.length)

    fireEvent.click(screen.getByRole('button', { name: 'Nar' }))

    await waitFor(() => {
      expect(textarea.value).toBe('<<Hello>>')
    })
  })
})
