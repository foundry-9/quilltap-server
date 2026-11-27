/**
 * #351: a BaseModal rendered inside another's children stays above it when
 * both mount in one commit — a workspace tab shown again, or a parent opened
 * with its child already open. React appends portals child first, so before
 * the fix the child landed under the parent and Escape closed the parent.
 */

import React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { BaseModal } from '@/components/ui/BaseModal'
import { WorkspaceTabVisibilityProvider } from '@/components/workspace/workspace-tab-context'

function order(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-qt-modal]')].map((n) => n.dataset.testid ?? '?')
}

function Nested({
  visible = true,
  child = true,
  grandchild = false,
  onCloseParent,
  onCloseChild,
}: {
  visible?: boolean
  child?: boolean
  grandchild?: boolean
  onCloseParent: () => void
  onCloseChild: () => void
}) {
  return (
    <WorkspaceTabVisibilityProvider visible={visible}>
      <BaseModal isOpen onClose={onCloseParent} title="Wizard" data-testid="parent">
        <button type="button">Parent button</button>
        <BaseModal isOpen={child} onClose={onCloseChild} title="Gallery" data-testid="child">
          <button type="button">Child button</button>
          <BaseModal isOpen={grandchild} onClose={() => {}} title="Confirm" data-testid="grandchild">
            <button type="button">Grandchild button</button>
          </BaseModal>
        </BaseModal>
      </BaseModal>
    </WorkspaceTabVisibilityProvider>
  )
}

describe('BaseModal nesting order', () => {
  it('puts a child opened in the same commit above its parent', () => {
    render(<Nested onCloseParent={jest.fn()} onCloseChild={jest.fn()} />)
    expect(order()).toEqual(['parent', 'child'])
  })

  it('keeps a nested child on top after its workspace tab is hidden and shown', () => {
    const parent = jest.fn()
    const child = jest.fn()
    const { rerender, getByText } = render(<Nested child={false} onCloseParent={parent} onCloseChild={child} />)
    rerender(<Nested onCloseParent={parent} onCloseChild={child} />)
    expect(order()).toEqual(['parent', 'child'])

    rerender(<Nested visible={false} onCloseParent={parent} onCloseChild={child} />)
    expect(order()).toEqual([])
    rerender(<Nested visible onCloseParent={parent} onCloseChild={child} />)
    expect(order()).toEqual(['parent', 'child'])

    const button = getByText('Child button')
    act(() => button.focus())
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(child).toHaveBeenCalledTimes(1)
    expect(parent).not.toHaveBeenCalled()
  })

  it('orders three levels mounted at once', () => {
    render(<Nested grandchild onCloseParent={jest.fn()} onCloseChild={jest.fn()} />)
    expect(order()).toEqual(['parent', 'child', 'grandchild'])
  })

  it('closing the parent takes the nested child with it cleanly', () => {
    const { rerender } = render(<Nested onCloseParent={jest.fn()} onCloseChild={jest.fn()} />)
    rerender(<Nested visible={false} onCloseParent={jest.fn()} onCloseChild={jest.fn()} />)
    expect(document.querySelectorAll('.qt-dialog-overlay')).toHaveLength(0)
  })
})
