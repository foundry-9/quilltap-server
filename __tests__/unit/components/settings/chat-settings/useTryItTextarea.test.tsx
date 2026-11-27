/**
 * The "Try it" textarea: a rewrite replaces the text and puts the cursor
 * where the rewrite says once the new text renders.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useTryItTextarea } from '@/components/settings/chat-settings/hooks/useTryItTextarea'

function Harness() {
  const { text, setText, ref, rewrite } = useTryItTextarea()
  return (
    <>
      <textarea aria-label="Try" ref={ref} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={() => rewrite('Hello, world', 5)}>Rewrite</button>
    </>
  )
}

describe('useTryItTextarea', () => {
  it('replaces the text and places the cursor after the re-render', () => {
    render(<Harness />)
    const ta = screen.getByLabelText('Try') as HTMLTextAreaElement

    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))

    expect(ta.value).toBe('Hello, world')
    expect(ta.selectionStart).toBe(5)
    expect(ta.selectionEnd).toBe(5)
  })
})
