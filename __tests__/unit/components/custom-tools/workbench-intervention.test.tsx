/**
 * Pascal's Workbench — the operator-intervention toggles.
 *
 * The master switch gates every per-field hand; the hands write the draft keys
 * the serializer expects (false hides, absence shows).
 */

import { describe, it, expect, jest as jestGlobal } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import BuilderForm from '@/components/custom-tools/BuilderForm'
import OutcomesSection from '@/components/custom-tools/OutcomesSection'
import SideEffectsSection from '@/components/custom-tools/SideEffectsSection'
import { draftFromDefinition, type ToolDraft } from '@/lib/pascal/tool-draft'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const TOOL = {
  name: 'lockpick',
  description: 'Pick a lock.',
  parameters: { bonus: { type: 'number', default: 0, description: 'A bonus.' } },
  effects: [{ target: 'state.picks', value: '{{state.picks}} + 1' }],
  outcomes: [{ when: true, message: 'Done.', state: 'info' }],
}

function draftWith(intervention?: { enabled: boolean; fields?: Record<string, boolean> }, extra = {}): ToolDraft {
  const draft = draftFromDefinition({ ...TOOL, ...(intervention ? { intervention } : {}), ...extra })
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

describe('BuilderForm — intervention master switch', () => {
  it('is off by default and shows no hands', () => {
    render(<BuilderForm draft={draftWith()} issues={[]} onChange={() => {}} />)
    expect(screen.getByLabelText('Let me take a hand in each roll')).not.toBeChecked()
    expect(screen.queryByLabelText('Show the roll in the hold dialog')).toBeNull()
    expect(screen.queryByLabelText('Show the title in the hold dialog')).toBeNull()
  })

  it('writes intervention.enabled when ticked', () => {
    const onChange = jestGlobal.fn()
    render(<BuilderForm draft={draftWith()} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Let me take a hand in each roll'))
    const next = onChange.mock.calls[0][0] as ToolDraft
    expect(next.intervention.enabled).toBe(true)
  })

  it('shows a hand beside each eligible field while on', () => {
    render(<BuilderForm draft={draftWith({ enabled: true })} issues={[]} onChange={() => {}} />)
    for (const label of [
      'Show the roll in the hold dialog',
      'Show the final value in the hold dialog',
      'Show the title in the hold dialog',
      'Show the chip label in the hold dialog',
      'Show the visibility in the hold dialog',
      'Show the announcer in the hold dialog',
      'Show bonus in the hold dialog',
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-pressed', 'true')
    }
    // No consult block, so no consult hands.
    expect(screen.queryByLabelText('Show the oracle’s question in the hold dialog')).toBeNull()
  })

  it('hides a tool-level field by writing fields[key] = false, and restores it by deleting', () => {
    const onChange = jestGlobal.fn()
    const { rerender } = render(<BuilderForm draft={draftWith({ enabled: true })} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Show the roll in the hold dialog'))
    const hidden = onChange.mock.calls[0][0] as ToolDraft
    expect(hidden.intervention.fields.roll).toBe(false)

    rerender(<BuilderForm draft={hidden} issues={[]} onChange={onChange} />)
    expect(screen.getByLabelText('Show the roll in the hold dialog')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Show the roll in the hold dialog').className).toContain('qt-intervene-toggle--off')
    fireEvent.click(screen.getByLabelText('Show the roll in the hold dialog'))
    const shown = onChange.mock.calls[1][0] as ToolDraft
    expect('roll' in shown.intervention.fields).toBe(false)
  })

  it('keeps hidden-field values in the draft while the master is off', () => {
    const draft = draftWith({ enabled: false, fields: { roll: false } })
    render(<BuilderForm draft={draft} issues={[]} onChange={() => {}} />)
    expect(screen.queryByLabelText('Show the roll in the hold dialog')).toBeNull()
    expect(draft.intervention.fields.roll).toBe(false)
  })

  it('writes param.intervene = false to hide a parameter and clears it to show again', () => {
    const onChange = jestGlobal.fn()
    const { rerender } = render(<BuilderForm draft={draftWith({ enabled: true })} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Show bonus in the hold dialog'))
    const hidden = onChange.mock.calls[0][0] as ToolDraft
    expect(hidden.parameters[0].intervene).toBe(false)

    rerender(<BuilderForm draft={hidden} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Show bonus in the hold dialog'))
    const shown = onChange.mock.calls[1][0] as ToolDraft
    expect(shown.parameters[0].intervene).toBeUndefined()
  })

  it('offers the consult hands only while the consult is on', () => {
    const draft = draftWith({ enabled: true }, { llm: { prompt: 'YES or NO?', errorMessage: 'Silence.' } })
    render(<BuilderForm draft={draft} issues={[]} onChange={() => {}} />)
    expect(screen.getByLabelText('Show the oracle’s question in the hold dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Show the oracle’s answer in the hold dialog')).toBeInTheDocument()
  })
})

describe('OutcomesSection — intervention hands', () => {
  it('is bare while the master is off', () => {
    render(<OutcomesSection draft={draftWith()} issues={[]} onChange={() => {}} />)
    expect(screen.queryByLabelText('Show the winning outcome in the hold dialog')).toBeNull()
  })

  it('writes outcome, message and state keys when on', () => {
    const onChange = jestGlobal.fn()
    render(<OutcomesSection draft={draftWith({ enabled: true })} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Show the winning outcome in the hold dialog'))
    fireEvent.click(screen.getByLabelText('Show the rendered message in the hold dialog'))
    fireEvent.click(screen.getByLabelText('Show the outcome state in the hold dialog'))
    expect((onChange.mock.calls[0][0] as ToolDraft).intervention.fields.outcome).toBe(false)
    expect((onChange.mock.calls[1][0] as ToolDraft).intervention.fields.message).toBe(false)
    expect((onChange.mock.calls[2][0] as ToolDraft).intervention.fields.state).toBe(false)
  })
})

describe('SideEffectsSection — intervention hands', () => {
  it('shows no hand while the master is off', () => {
    renderWithQuery(<SideEffectsSection draft={draftWith()} issues={[]} onChange={() => {}} />)
    expect(screen.queryByLabelText('Show this effect in the hold dialog')).toBeNull()
  })

  it('writes effect.intervene = false and clears it again', () => {
    const onChange = jestGlobal.fn()
    const { rerender } = renderWithQuery(
      <SideEffectsSection draft={draftWith({ enabled: true })} issues={[]} onChange={onChange} />
    )
    fireEvent.click(screen.getByLabelText('Show this effect in the hold dialog'))
    const hidden = onChange.mock.calls[0][0] as ToolDraft
    expect(hidden.effects[0].intervene).toBe(false)
    void rerender
  })
})
