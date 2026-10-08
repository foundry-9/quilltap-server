import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('@/components/ui/ChevronIcon', () => ({
  ChevronIcon: ({ expanded }: { expanded: boolean }) => <span data-testid="chevron" data-expanded={String(expanded)} />,
}))
jest.mock('@/components/scenarios/ScenariosIcon', () => ({ ScenariosIcon: () => <span data-testid="icon" /> }))
jest.mock('@/components/scenarios/ScenariosManager', () => ({
  ScenariosManager: jest.fn((props: { scopeLabel: string }) => <div data-testid="manager">{props.scopeLabel}</div>),
}))
jest.mock('@/components/scenarios/use-scenario-mutator', () => ({ useScenarioMutator: jest.fn() }))

import { GroupScenariosCard } from '@/app/aurora/groups/components/GroupScenariosCard'
import { ScenariosManager } from '@/components/scenarios/ScenariosManager'
import { useScenarioMutator } from '@/components/scenarios/use-scenario-mutator'

describe('GroupScenariosCard', () => {
  const mutator = (n: number) => ({ scenarios: Array.from({ length: n }, (_, i) => ({ path: `Scenarios/s${i}.md` })) })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useScenarioMutator as jest.Mock).mockReturnValue(mutator(3))
  })

  it('binds the mutator to the group scenarios endpoint', () => {
    render(<GroupScenariosCard groupId="g-7" expanded={false} onToggle={jest.fn()} />)
    expect(useScenarioMutator).toHaveBeenCalledWith('/api/v1/groups/g-7/scenarios')
  })

  it('shows the scenario count in the header', () => {
    render(<GroupScenariosCard groupId="g" expanded={false} onToggle={jest.fn()} />)
    expect(screen.getByText('Scenarios (3)')).toBeInTheDocument()
  })

  it('shows a zero count for an empty shelf', () => {
    ;(useScenarioMutator as jest.Mock).mockReturnValue(mutator(0))
    render(<GroupScenariosCard groupId="g" expanded={false} onToggle={jest.fn()} />)
    expect(screen.getByText('Scenarios (0)')).toBeInTheDocument()
  })

  it('hides the manager when collapsed', () => {
    render(<GroupScenariosCard groupId="g" expanded={false} onToggle={jest.fn()} />)
    expect(screen.queryByTestId('manager')).not.toBeInTheDocument()
    expect(screen.getByTestId('chevron')).toHaveAttribute('data-expanded', 'false')
  })

  it('renders the manager with the group shelf and empty message when expanded', () => {
    render(<GroupScenariosCard groupId="g-7" expanded onToggle={jest.fn()} />)
    expect(screen.getByTestId('manager')).toHaveTextContent('group')
    expect(screen.getByTestId('chevron')).toHaveAttribute('data-expanded', 'true')
    const props = (ScenariosManager as jest.Mock).mock.calls[0][0]
    expect(props.shelf).toEqual({ kind: 'group', groupId: 'g-7' })
    expect(props.mutator).toBe((useScenarioMutator as jest.Mock).mock.results[0].value)
    expect(props.emptyMessage).toMatch(/No scenarios yet/)
  })

  it('calls onToggle when the header is clicked', () => {
    const onToggle = jest.fn()
    render(<GroupScenariosCard groupId="g" expanded={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
