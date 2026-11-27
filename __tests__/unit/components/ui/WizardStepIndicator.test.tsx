/**
 * The shared wizard step indicator and the step-number helper the tools
 * wizards read their "Step N of M" from.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { WizardStepIndicator } from '@/components/ui/WizardStepIndicator'
import { wizardStep } from '@/components/ui/WizardModal'

const STEPS = [
  { key: 'a', label: 'First' },
  { key: 'b', label: 'Second' },
  { key: 'c', label: 'Third' },
]

describe('WizardStepIndicator', () => {
  it('draws every step label inside the progress nav', () => {
    render(<WizardStepIndicator steps={STEPS} current={1} />)
    expect(screen.getByRole('navigation', { name: 'Wizard progress' })).toBeInTheDocument()
    for (const step of STEPS) expect(screen.getByText(step.label)).toBeInTheDocument()
  })

  it('marks only the current step with aria-current', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} current={1} />)
    const current = container.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toBe('2')
  })

  it('numbers the steps after the current one and ticks those before', () => {
    const { container } = render(<WizardStepIndicator steps={STEPS} current={1} />)
    expect(container.textContent).not.toContain('1')
    expect(container.textContent).toContain('3')
  })
})

describe('wizardStep', () => {
  const ORDER = ['type', 'select', 'exporting', 'complete'] as const

  it('reports a one-based position and the order length', () => {
    expect(wizardStep(ORDER, 'type')).toEqual({ current: 1, total: 4 })
    expect(wizardStep(ORDER, 'exporting')).toEqual({ current: 3, total: 4 })
  })

  it('falls back to the first step for a step outside the order', () => {
    expect(wizardStep<string>(ORDER, 'options')).toEqual({ current: 1, total: 4 })
  })
})
