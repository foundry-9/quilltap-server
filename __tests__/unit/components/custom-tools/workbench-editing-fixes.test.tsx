/**
 * Pascal's Workbench — regressions from the 4.14.1 bug pass.
 *
 *   #266  a condition key can be typed through a prefix another chip holds
 *   #314  the "Insert value" menu behaves as a menu button
 *   #315  JSON mode judges the live text at Save, not the debounced parse
 *   #316  the `?mount=` deep link preselects the save destination
 *   #317  re-choosing "Hand-typed sheet" keeps the typed sheet
 *   #319  a rename-on-save checks the old file before deleting it
 *   #320  the bench clock runs only for a sheet with progressions
 *   #321  the audit button says how many hands it deals
 *   #322  old rolls keep the row labels they were dealt against
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React, { useState } from 'react'
import OutcomesSection from '@/components/custom-tools/OutcomesSection'
import GateSection from '@/components/custom-tools/GateSection'
import ProvingBench from '@/components/custom-tools/ProvingBench'
import DestinationPicker from '@/components/custom-tools/DestinationPicker'
import WorkbenchEditor from '@/components/custom-tools/WorkbenchEditor'
import { draftFromDefinition, type ToolDraft } from '@/lib/pascal/tool-draft'
import type { CustomToolDestinations } from '@/lib/pascal/workbench'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const mockShowAlert = jest.fn()
const mockShowConfirmation = jest.fn()
jest.mock('@/lib/alert', () => ({
  showAlert: (...args: unknown[]) => mockShowAlert(...args),
  showConfirmation: (...args: unknown[]) => mockShowConfirmation(...args),
  showPrompt: jest.fn(),
}))

const HP_TOOL = {
  name: 'vigour',
  description: 'Test the vigour.',
  outcomes: [
    { when: { metadata: { hp: { gte: 5 } } }, message: 'Hale.', state: 'success' },
    { when: { gte: 20 }, message: 'Middling.', state: 'partial' },
    { when: true, message: 'Wan.', state: 'failure' },
  ],
}

const GATED_TOOL = {
  name: 'gated',
  description: 'Only for the hale.',
  availableWhen: { metadata: { hp: { gte: 5 } } },
  outcomes: [{ when: true, message: 'Done.', state: 'info' }],
}

function load(definition: unknown): ToolDraft {
  const draft = draftFromDefinition(definition)
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

afterEach(() => {
  jest.restoreAllMocks()
  mockShowAlert.mockReset()
  mockShowConfirmation.mockReset()
})

// ---------------------------------------------------------------------------
// #266 — typing a key through a colliding prefix
// ---------------------------------------------------------------------------

function typeInto(input: HTMLElement, text: string) {
  for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } })
}

describe('condition keys can be typed through a colliding prefix (#266)', () => {
  it('outcome chips: a second metadata key types out "hp_max" in order', () => {
    const start = load(HP_TOOL)
    // A second metadata chip on row 1's line, same comparator, empty key.
    start.outcomes[0].conditions.push({
      id: 'second',
      subject: { kind: 'metadata', key: '' },
      comparator: 'gte',
      operand: { kind: 'number', text: '1' },
    })

    function Harness() {
      const [draft, setDraft] = useState(start)
      return <OutcomesSection draft={draft} issues={[]} onChange={setDraft} />
    }
    render(<Harness />)

    const keys = screen.getAllByLabelText('Metadata key') as HTMLInputElement[]
    const second = keys[1]
    typeInto(second, 'hp')
    // Passing through the taken slot is allowed, and said.
    expect(second.value).toBe('hp')
    expect(screen.getByText(/only once/)).toBeInTheDocument()

    typeInto(second, 'hp_max')
    expect(second.value).toBe('hp_max')
    expect(screen.queryByText(/only once/)).toBeNull()
  })

  it('gate chips: the same holds for the availability gate', () => {
    const start = load(GATED_TOOL)
    start.gateConditions.push({
      id: 'gate-second',
      subject: 'metadata',
      key: '',
      comparator: start.gateConditions[0].comparator,
      operand: { kind: 'number', text: '1' },
    })

    function Harness() {
      const [draft, setDraft] = useState(start)
      return <GateSection draft={draft} issues={[]} onChange={setDraft} />
    }
    render(<Harness />)

    const second = (screen.getAllByLabelText('Metadata key') as HTMLInputElement[])[1]
    typeInto(second, 'hp_max')
    expect(second.value).toBe('hp_max')
    expect(screen.queryByText(/only once/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// #314 — Insert value is a menu button
// ---------------------------------------------------------------------------

describe('the Insert value menu (#314)', () => {
  it('moves focus in, answers the arrow keys, and Escape returns focus to the button', () => {
    render(<OutcomesSection draft={load(HP_TOOL)} issues={[]} onChange={() => {}} />)
    const button = screen.getAllByRole('button', { name: /Insert value/ })[0]
    fireEvent.click(button)

    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('inserts the chosen placeholder', () => {
    const onChange = jest.fn()
    render(<OutcomesSection draft={load(HP_TOOL)} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Insert value/ })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Raw roll' }))
    const next = onChange.mock.calls[0][0] as ToolDraft
    expect(next.outcomes[0].message).toContain('{{roll}}')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The Proving Bench (#317, #320, #321, #322)
// ---------------------------------------------------------------------------

describe('the Proving Bench', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ general: null, projects: [], groups: [], characters: [], other: [] }))
  })

  it('keeps a typed sheet when "Hand-typed sheet" is chosen again (#317)', () => {
    renderWithQuery(<ProvingBench draft={load(HP_TOOL)} valid />)
    const sheet = screen.getByLabelText('Hand-typed fact sheet (JSON object)')
    fireEvent.change(sheet, { target: { value: '{"hp": 9}' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Hand-typed sheet' }))
    expect(screen.getByLabelText('Hand-typed fact sheet (JSON object)')).toHaveValue('{"hp": 9}')
  })

  it('runs its clock only while the sheet carries progressions (#320)', () => {
    const intervals = jest.spyOn(global, 'setInterval')
    renderWithQuery(<ProvingBench draft={load(HP_TOOL)} valid />)
    const secondly = () => intervals.mock.calls.filter((call) => call[1] === 1000).length
    expect(secondly()).toBe(0)

    fireEvent.change(screen.getByLabelText('Hand-typed fact sheet (JSON object)'), {
      target: { value: '{"progressions": []}' },
    })
    expect(secondly()).toBe(1)
  })

  it('says it deals ten thousand hands (#321)', () => {
    renderWithQuery(<ProvingBench draft={load(HP_TOOL)} valid />)
    expect(screen.getByRole('button', { name: 'Deal ten thousand hands' })).toBeInTheDocument()
  })

  it('keeps an old roll labelled by the rows it was dealt against (#322)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('action=preview')) {
        return jsonResponse({
          tool: 'vigour',
          params: {},
          rollForm: 'range',
          raw: 0.3,
          value: 30,
          state: 'partial',
          outcomeIndex: 1,
          message: 'Middling.',
          diceBreakdown: '',
          visibility: 'public',
        })
      }
      return jsonResponse({ general: null, projects: [], groups: [], characters: [], other: [] })
    })

    const draft = load(HP_TOOL)
    const { rerender } = renderWithQuery(<ProvingBench draft={draft} valid />)
    fireEvent.click(screen.getByRole('button', { name: /^Roll$/ }))
    await screen.findByText(/matched row 2/)

    // Delete row 1: index 1 is now the catch-all in the live draft.
    rerender(<ProvingBench draft={{ ...draft, outcomes: draft.outcomes.slice(1) }} valid />)
    expect(screen.getByText(/matched row 2/)).toBeInTheDocument()
    expect(screen.queryByText(/matched the catch-all/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// #316 — the destination picker's preselection
// ---------------------------------------------------------------------------

const DESTINATIONS: CustomToolDestinations = {
  general: { mountPointId: 'general-1', mountName: 'Quilltap General', existingToolNames: [] },
  projects: [],
  groups: [],
  characters: [],
  other: [{ mountPointId: 'm-target', mountName: 'The Annex', existingToolNames: [] }],
}

describe('the destination picker (#316)', () => {
  it('starts with the deep-linked store chosen', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(DESTINATIONS))
    const onPick = jest.fn()
    renderWithQuery(
      <DestinationPicker toolName="vigour" onPick={onPick} onCancel={() => {}} initialMountPointId="m-target" />
    )
    const keep = await screen.findByRole('button', { name: 'Keep it here' })
    await waitFor(() => expect(keep).not.toBeDisabled())
    fireEvent.click(keep)
    expect(onPick).toHaveBeenCalledWith({ mountPointId: 'm-target', mountName: 'The Annex' })
  })

  it('ignores an id no store carries', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(DESTINATIONS))
    renderWithQuery(
      <DestinationPicker toolName="vigour" onPick={() => {}} onCancel={() => {}} initialMountPointId="nowhere" />
    )
    await screen.findByText('The Annex')
    expect(screen.getByRole('button', { name: 'Keep it here' })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// WorkbenchEditor saves (#315, #319)
// ---------------------------------------------------------------------------

const SOURCE = { mountPointId: 'store-1', path: 'Tools/vigour.tool.json' }
const FILE_TEXT = `${JSON.stringify(HP_TOOL, null, 2)}\n`

describe('WorkbenchEditor saves', () => {
  it('refuses broken JSON clicked before the issue list catches up (#315)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('action=destinations')) return jsonResponse(DESTINATIONS)
      return jsonResponse({ content: FILE_TEXT, mtime: 1 })
    })
    renderWithQuery(<WorkbenchEditor source={SOURCE} onBack={() => {}} onOpenOther={() => {}} />)
    fireEvent.click(await screen.findByRole('radio', { name: 'JSON' }))

    const textarea = await screen.findByLabelText('Definition JSON')
    // Let the debounced parse settle on the valid text first.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
    fireEvent.change(textarea, { target: { value: FILE_TEXT.replace(/}\n$/, '\n') } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const puts = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(puts).toHaveLength(0)
    expect(mockShowConfirmation).not.toHaveBeenCalled()
  })

  it('asks before a rename deletes an old file that has changed (#319)', async () => {
    let oldFileReads = 0
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('action=destinations')) return jsonResponse(DESTINATIONS)
      if (init?.method === 'PUT' || init?.method === 'DELETE') return jsonResponse({ mtime: 9 })
      if (url.includes(encodeURIComponent('vigour.tool.json')) || url.includes('vigour.tool.json')) {
        oldFileReads += 1
        // First read opens the file; the read before the rename finds it changed.
        return jsonResponse({ content: FILE_TEXT, mtime: oldFileReads === 1 ? 1 : 2 })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })
    mockShowAlert.mockResolvedValue('OK')

    renderWithQuery(<WorkbenchEditor source={SOURCE} onBack={() => {}} onOpenOther={() => {}} />)
    const name = await screen.findByLabelText(/name/i, { selector: '#wb-name' })
    fireEvent.change(name, { target: { value: 'vitality' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('The file has moved under your hand')
    const writes = fetchSpy.mock.calls.filter(([, i]) => {
      const method = (i as RequestInit | undefined)?.method
      return method === 'PUT' || method === 'DELETE'
    })
    expect(writes).toHaveLength(0)
  })
})
