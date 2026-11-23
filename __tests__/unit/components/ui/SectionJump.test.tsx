/**
 * SectionJump: the compact section navigation used in narrow panes.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SectionJump } from '@/components/ui/SectionJump'

describe('SectionJump', () => {
  const options = [
    { id: 'colors', label: 'Colours', note: '2 set by this theme' },
    { id: 'fonts', label: 'Fonts' },
  ]

  it('names the select by its visible label and lists every option', () => {
    render(<SectionJump label="Go to a section" options={options} onJump={() => {}} />)
    const select = screen.getByLabelText('Go to a section') as HTMLSelectElement
    expect([...select.options].map((o) => o.text)).toEqual(['Choose…', 'Colours (2 set by this theme)', 'Fonts'])
    expect(select.value).toBe('')
  })

  it('jumps to the chosen section and returns to its prompt', () => {
    const onJump = jest.fn()
    render(<SectionJump label="Go to a section" options={options} onJump={onJump} />)
    const select = screen.getByLabelText('Go to a section') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'fonts' } })
    expect(onJump).toHaveBeenCalledWith('fonts')
    expect(select.value).toBe('')
  })

  it('says so when there is nothing to choose', () => {
    render(<SectionJump label="Go to a section" options={[]} onJump={() => {}} emptyText="No section answers." />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('No section answers.')).toBeInTheDocument()
  })
})
