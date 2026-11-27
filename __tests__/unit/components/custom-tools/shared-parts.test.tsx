/**
 * The Workbench's shared parts: the issue lines, the chip pieces, the
 * reference rows, the per-line duplicate guard and the destinations read.
 */

import React from 'react'
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react'
import { IssueLines } from '@/components/custom-tools/IssueLines'
import { FailSoftHint, ParamRefSelect, RawRefBadge, SubjectKeyField, progressKeyTitle } from '@/components/custom-tools/chip-parts'
import { ReferenceRows, withRefAt } from '@/components/custom-tools/ReferenceRows'
import { useLineSlotGuard } from '@/components/custom-tools/ConditionGroups'
import { useCustomToolDestinations, CUSTOM_TOOL_DESTINATIONS_URL } from '@/components/custom-tools/use-custom-tool-destinations'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import type { CustomToolDestinations } from '@/lib/pascal/workbench'

describe('IssueLines', () => {
  it('draws errors, then warnings with their mark, and nothing when there are none', () => {
    const { container, rerender } = render(<IssueLines errors={['Broken']} warnings={['Odd']} />)
    const lines = container.querySelectorAll('p')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('Broken')
    expect(lines[0].className).toContain('qt-text-destructive')
    expect(lines[1]).toHaveTextContent('⚠ Odd')
    rerender(<IssueLines />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})

describe('chip parts', () => {
  it('flags a blank key and reports typing', () => {
    const onChange = jest.fn()
    render(<SubjectKeyField value=" " onChange={onChange} disabled={false} placeholder="key" title="t" ariaLabel="Key" />)
    const input = screen.getByLabelText('Key')
    expect(input.className).toContain('qt-input-error')
    fireEvent.change(input, { target: { value: 'hp' } })
    expect(onChange).toHaveBeenCalledWith('hp')
  })

  it('titles a progress key with its fields and its ending', () => {
    expect(progressKeyTitle('never matches')).toMatch(/^A progression of the invoking character, keyed "<id>\.<field>" — percent, .*\. A progression they do not carry never matches\.$/)
  })

  it('draws the fail-soft mark and the verbatim badge', () => {
    render(
      <>
        <FailSoftHint title="Declines" />
        <RawRefBadge title="Verbatim" hasError>
          $state.x
        </RawRefBadge>
      </>,
    )
    expect(screen.getByTitle('Declines')).toHaveTextContent('ⓘ')
    const badge = screen.getByTitle('Verbatim')
    expect(badge).toHaveTextContent('$state.x')
    expect(badge.className).toContain('qt-input-error')
  })

  it('keeps an orphaned parameter as an option', () => {
    const onChange = jest.fn()
    render(<ParamRefSelect value="gone" names={['a', 'b']} onChange={onChange} disabled={false} ariaLabel="Parameter" />)
    const select = screen.getByLabelText('Parameter') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['gone', 'a', 'b'])
    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('ReferenceRows', () => {
  it('withRefAt sets one row, an empty list being one blank row', () => {
    expect(withRefAt([], 0, 'x')).toEqual(['x'])
    expect(withRefAt(['a', 'b'], 1, 'c')).toEqual(['a', 'c'])
  })

  function renderRows(refs: string[], onChange = jest.fn(), onChoose = jest.fn()) {
    render(
      <ReferenceRows<{ title: string }>
        refs={refs}
        onChange={onChange}
        resolve={(ref) => (ref === 'known' ? { title: 'Known thing' } : undefined)}
        isTemplated={(ref) => ref.includes('{{')}
        renderResolved={({ item, index, trash }) => (
          <div key={index}>
            <span>{item.title}</span>
            {trash}
          </div>
        )}
        canFlagUnresolved
        unresolvedText="not found"
        unresolvedTestId="unresolved"
        onChoose={onChoose}
        max={3}
        maxLength={100}
        hasErrors={false}
        disabled={false}
        placeholder={(i) => `ref ${i + 1}`}
        inputLabel={(i) => `Item ${i + 1}`}
        removeTitle="Remove this item"
        chooseTitle="Choose one"
        addLabel="Add an item"
        atMaxTitle="That is the most"
        hintLead="A title"
      />,
    )
    return { onChange, onChoose }
  }

  it('draws resolved rows as the caller chips and the rest as text boxes', () => {
    renderRows(['known', 'mystery', '{{params.x}}'])
    expect(screen.getByText('Known thing')).toBeInTheDocument()
    expect(screen.getByLabelText('Item 2')).toHaveValue('mystery')
    expect(screen.getAllByTestId('unresolved')).toHaveLength(1)
    expect(screen.getByText('chosen at run time')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add an item/ })).toBeDisabled()
  })

  it('edits, removes, chooses and adds rows', () => {
    const { onChange, onChoose } = renderRows(['a', 'b'])
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'z' } })
    expect(onChange).toHaveBeenLastCalledWith(['z', 'b'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this item' })[0])
    expect(onChange).toHaveBeenLastCalledWith(['b'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose…' })[1])
    expect(onChoose).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: /Add an item/ }))
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b', ''])
  })

  it('shows one blank row for an empty list, which cannot be removed', () => {
    renderRows([])
    expect(screen.getByLabelText('Item 1')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Remove this item' })).toBeDisabled()
  })
})

describe('useLineSlotGuard', () => {
  type C = { id: string; joiner?: 'and' | 'or'; slot: string }
  const conditions: C[] = [
    { id: '1', slot: 'a' },
    { id: '2', joiner: 'and', slot: 'b' },
    { id: '3', joiner: 'or', slot: 'c' },
  ]

  it('refuses a change that repeats a slot on its own line, and says why', () => {
    const setConditions = jest.fn()
    const { result } = renderHook(() =>
      useLineSlotGuard(conditions, setConditions, (a, b) => a.slot === b.slot, (next) => `Already testing ${next.slot}`),
    )
    act(() => result.current.update('2', { id: '2', joiner: 'and', slot: 'a' }))
    expect(setConditions).not.toHaveBeenCalled()
    expect(result.current.notice).toBe('Already testing a')
    act(() => result.current.clearNotice())
    expect(result.current.notice).toBeNull()
  })

  it('allows the same slot on another line', () => {
    const setConditions = jest.fn()
    const { result } = renderHook(() =>
      useLineSlotGuard(conditions, setConditions, (a, b) => a.slot === b.slot, () => 'dup'),
    )
    act(() => result.current.update('3', { id: '3', joiner: 'or', slot: 'a' }))
    expect(setConditions).toHaveBeenCalledWith([conditions[0], conditions[1], { id: '3', joiner: 'or', slot: 'a' }])
    expect(result.current.notice).toBeNull()
  })
})

describe('useCustomToolDestinations', () => {
  const destinations: CustomToolDestinations = {
    general: { mountPointId: 'mp-general', mountName: 'General', existingToolNames: [] },
    characters: [{ characterId: 'c1', characterName: 'Imogen', mountPointId: 'mp-i', mountName: 'Imogen', existingToolNames: [] }],
    groups: [],
    projects: [],
    other: [],
  }
  const realFetch = global.fetch
  let fetchSpy: jest.Mock
  beforeEach(() => {
    fetchSpy = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => destinations }))
    global.fetch = fetchSpy as unknown as typeof fetch
  })
  afterAll(() => {
    global.fetch = realFetch
  })

  it('reads the destinations, narrowed by select', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useCustomToolDestinations({ select: (d) => d.characters.map((c) => c.characterName) }), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(['Imogen']))
    expect(String(fetchSpy.mock.calls[0][0])).toBe(CUSTOM_TOOL_DESTINATIONS_URL)
  })

  it('waits while disabled', () => {
    const { wrapper } = createQueryWrapper()
    renderHook(() => useCustomToolDestinations({ enabled: false }), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
