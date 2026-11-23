/**
 * Calliope's inspector — inspect mode and its panel (Calliope Live, Spec H,
 * Stage 2).
 *
 * Inspect mode captures the pointer while it is on and leaves nothing behind
 * when it is off; a click while inspecting chooses an element and never
 * reaches it; the editor's own panel (marked `data-inspect-ignore`) stays
 * usable. The panel names the hook, the tokens and their states, and the
 * theme's own rules, and links a token to its row and a hook to a new rule.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect } from 'react'
import { InspectProvider, useInspectOptional, type EditorBridge } from '@/components/theme-inspect/InspectProvider'
import { InspectPanel } from '@/components/theme-inspect/InspectPanel'
import { InspectToggle } from '@/components/theme-inspect/InspectToggle'
import { buildInspectReport, type InspectReport } from '@/components/theme-inspect/report'
import { CLIENT_REGISTRY_VIEW, resolveTheme } from '@/lib/themes/engine/client'

jest.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({ resolvedColorMode: 'light', themeRevision: 0 }),
}))

const RESOLVED = resolveTheme({ primitives: {}, tokens: {}, choices: {} }, CLIENT_REGISTRY_VIEW)

function addStyle(css: string) {
  const el = document.createElement('style')
  el.textContent = css
  document.head.appendChild(el)
  return el
}

afterEach(() => {
  document.head.innerHTML = ''
})

function editorBridge(overrides: Partial<EditorBridge> = {}): EditorBridge {
  return {
    draftName: 'Test Draft',
    resolved: RESOLVED,
    goToToken: jest.fn(() => true),
    hasStylesheet: true,
    writeCss: jest.fn(),
    beginStylesheet: jest.fn(async () => true),
    openGallery: jest.fn(),
    askCalliope: jest.fn(),
    ...overrides,
  }
}

/** Registers an editor bridge the way the draft editor does. */
function RegisterEditor({ bridge }: { bridge: EditorBridge }) {
  const inspect = useInspectOptional()
  const register = inspect?.registerEditor
  useEffect(() => register?.(bridge), [register, bridge])
  return null
}

const INSPECT_EVENTS = new Set(['pointermove', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'keydown'])

/** The capture listeners inspect mode adds to the window (React's own are on its root, not here). */
function inspectCaptures(spy: jest.SpyInstance, from = 0) {
  return spy.mock.calls.slice(from).filter((call) => call[2] === true && INSPECT_EVENTS.has(call[0] as string))
}

describe('inspect mode', () => {
  it('adds its capture listeners when on and removes every one when off, leaving no attribute behind', () => {
    const add = jest.spyOn(window, 'addEventListener')
    const remove = jest.spyOn(window, 'removeEventListener')
    const htmlBefore = document.documentElement.getAttributeNames().sort()
    const bodyBefore = document.body.getAttributeNames().sort()
    render(
      <InspectProvider>
        <InspectToggle />
      </InspectProvider>,
    )
    const toggle = screen.getByRole('button', { name: /inspect/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const addsBefore = add.mock.calls.length
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /inspecting/i })).toHaveAttribute('aria-pressed', 'true')
    const added = inspectCaptures(add, addsBefore)
    expect(new Set(added.map((c) => c[0]))).toEqual(INSPECT_EVENTS)
    // Escape turns it off.
    const removesBefore = remove.mock.calls.length
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /^inspect$/i })).toHaveAttribute('aria-pressed', 'false')
    const removed = inspectCaptures(remove, removesBefore)
    expect(removed).toHaveLength(added.length)
    for (const call of added) {
      expect(removed.some((r) => r[0] === call[0] && r[1] === call[1])).toBe(true)
    }
    expect(screen.queryByTestId('inspect-layer')).toBeNull()
    expect(document.documentElement.getAttributeNames().sort()).toEqual(htmlBefore)
    expect(document.body.getAttributeNames().sort()).toEqual(bodyBefore)
    add.mockRestore()
    remove.mockRestore()
  })

  it('swallows a click on the page and chooses the element instead; the ignored zone keeps working', async () => {
    // A document-level capture listener registered first (the workspace's link interceptor) must not see it either.
    const documentCapture = jest.fn()
    document.addEventListener('click', documentCapture, true)
    const onPage = jest.fn()
    const onEditor = jest.fn()
    render(
      <InspectProvider>
        <div data-inspect-ignore="">
          <InspectToggle />
          <button type="button" onClick={onEditor}>Editor button</button>
        </div>
        <div className="qt-card">
          <button type="button" onClick={onPage}>Page button</button>
        </div>
      </InspectProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }))
    documentCapture.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Page button' }))
    expect(onPage).not.toHaveBeenCalled()
    expect(documentCapture).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Editor button' }))
    expect(onEditor).toHaveBeenCalledTimes(1)
    const panel = await screen.findByRole('complementary', { name: 'The inspector' })
    expect(panel).toHaveTextContent('.qt-card')
    // Turned off, the page answers again.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Page button' }))
    expect(onPage).toHaveBeenCalledTimes(1)
    document.removeEventListener('click', documentCapture, true)
  })

  it('opens the gallery through the editor to show a hook, which the gallery reveals once it registers', async () => {
    const bridge = editorBridge()
    const reveal = jest.fn()
    const holder: { api: ReturnType<typeof useInspectOptional> } = { api: null }
    function Grab() {
      const inspect = useInspectOptional()
      useEffect(() => {
        holder.api = inspect
      })
      return null
    }
    render(
      <InspectProvider>
        <RegisterEditor bridge={bridge} />
        <Grab />
      </InspectProvider>,
    )
    await waitFor(() => expect(holder.api?.editor).toBe(bridge))
    act(() => {
      expect(holder.api!.showInGallery('qt-card')).toBe(true)
    })
    expect(bridge.openGallery).toHaveBeenCalledTimes(1)
    act(() => {
      holder.api!.registerGallery({ reveal })
    })
    await waitFor(() => expect(reveal).toHaveBeenCalledWith('qt-card'))
  })
})

describe('the inspector panel', () => {
  function reportFor(html: string, css: string, select: string, resolved = RESOLVED): InspectReport {
    addStyle(css)
    document.body.innerHTML = html
    const report = buildInspectReport(document.querySelector(select)!, resolved)
    return report
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('names a hooked element, its tokens, and links a token to its row and the hook to a new rule', async () => {
    const report = reportFor('<div class="qt-card"><span class="inner">Words</span></div>', '.qt-card { background-color: var(--color-card); }', '.inner')
    const bridge = editorBridge()
    render(<InspectPanel report={report} editor={bridge} canShowInGallery onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    const panel = screen.getByRole('complementary', { name: 'The inspector' })
    expect(within(panel).getByText('.qt-card')).toBeInTheDocument()
    expect(within(panel).getByText(/1 level up/)).toBeInTheDocument()
    expect(panel.textContent).not.toContain('Words')
    fireEvent.click(screen.getAllByRole('button', { name: /show the row for/i })[0])
    expect(bridge.goToToken).toHaveBeenCalledWith('--theme-card')
    fireEvent.click(screen.getByRole('button', { name: 'Write CSS for this' }))
    await waitFor(() => expect(bridge.writeCss).toHaveBeenCalledWith('.qt-card'))
    expect(bridge.beginStylesheet).not.toHaveBeenCalled()
  })

  it('asks Calliope about the hook, with what styles it, from the panel', () => {
    const report = reportFor('<div class="qt-card"></div>', '.qt-card { background-color: var(--color-card); }', '.qt-card')
    const bridge = editorBridge()
    render(<InspectPanel report={report} editor={bridge} canShowInGallery={false} onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Calliope about this' }))
    expect(bridge.askCalliope).toHaveBeenCalledTimes(1)
    const text = (bridge.askCalliope as jest.Mock).mock.calls[0][0] as string
    expect(text).toMatch(/^About the .* \(\.qt-card\)/)
    expect(text).toMatch(/What styles it now:\n- background-color: --theme-card/)
  })

  it('offers no hand-off to Calliope without a draft', () => {
    const report = reportFor('<div class="qt-card"></div>', '.qt-card { background-color: var(--color-card); }', '.qt-card')
    render(<InspectPanel report={report} editor={null} canShowInGallery={false} onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    expect(screen.queryByRole('button', { name: 'Ask Calliope about this' })).toBeNull()
  })

  it('begins a stylesheet first when the draft has none', async () => {
    const report = reportFor('<div class="qt-card"></div>', '.qt-card { color: var(--color-foreground); }', '.qt-card')
    const bridge = editorBridge({ hasStylesheet: false })
    render(<InspectPanel report={report} editor={bridge} canShowInGallery={false} onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /begin a stylesheet and write css/i }))
    await waitFor(() => expect(bridge.writeCss).toHaveBeenCalledWith('.qt-card'))
    expect(bridge.beginStylesheet).toHaveBeenCalledTimes(1)
  })

  it('says so when nothing is hooked, and offers no editor links without a draft', () => {
    const report = reportFor('<div class="plain"></div>', '.plain { color: var(--color-foreground); }', '.plain', undefined)
    render(<InspectPanel report={{ ...report, readsDraft: false }} editor={null} canShowInGallery={false} onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText(/carries no hook, and nothing above it does either/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show the row for/i })).toBeNull()
    expect(screen.getByText(/shown once a draft is open/)).toBeInTheDocument()
  })

  it('shows what changes on hover', () => {
    const report = reportFor(
      '<div class="qt-card"></div>',
      '.qt-card { background-color: var(--color-card); } .qt-card:hover { border-color: var(--color-primary); }',
      '.qt-card',
    )
    render(<InspectPanel report={report} editor={editorBridge()} canShowInGallery={false} onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText('On hover')).toBeInTheDocument()
    expect(report.states.map((s) => s.state)).toEqual(['hover'])
  })

  it('lists the theme’s own rules and marks a property they set', () => {
    const base = reportFor('<div class="qt-card"></div>', '.qt-card { background-color: var(--color-card); }', '.qt-card')
    const custom: InspectReport = {
      ...base,
      base: base.base.map((g) => ({ ...g, uses: g.uses.map((u) => ({ ...u, fromCustomCss: true })) })),
      customRules: [
        { selector: '.qt-card', declarations: [{ property: 'background-color', value: 'var(--color-card)', important: false }], origin: 'theme-custom', layer: null, order: 0, state: null, source: 'theme' },
      ],
    }
    render(<InspectPanel report={custom} editor={editorBridge()} canShowInGallery={false} onShowInGallery={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByRole('region', { name: 'Your own CSS that applies' })).toHaveTextContent('.qt-card')
    expect(screen.getAllByText('your own CSS').length).toBeGreaterThan(0)
  })
})
