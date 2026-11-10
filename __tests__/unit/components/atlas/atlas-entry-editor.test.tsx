/**
 * The Atlas entry editor (spec §5.10):
 *
 *  - the graphic prompt's live count, and a warning past
 *    `ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT` that never blocks a save;
 *  - the alias token input: Enter or a comma adds, Backspace in an empty
 *    field removes the last, each token's labelled remove button, no repeats;
 *  - the overlap notices for this entry's terms;
 *  - a `NAME_TAKEN` refusal shown under the name.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { AtlasEntryEditor } from '@/components/atlas/atlas-entry-editor'
import { addAliasTerms } from '@/components/atlas/atlas-alias-input'
import { AtlasRequestError } from '@/lib/hooks/use-atlas'
import { ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT, type AtlasEntryWithOrigin, type AtlasOverlap } from '@/lib/schemas/atlas.types'
import type { AtlasEntryActions } from '@/components/atlas/hooks/useAtlasEntryActions'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const T = '2026-11-10T00:00:00.000Z'
const GENERAL = { scope: 'general' as const, id: null }

const CONVERTIBLE: AtlasEntryWithOrigin = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Convertible',
  aliases: ['lander'],
  graphicPrompt: 'A cream 1930s roadster',
  knowledge: null,
  imageFileId: null,
  metadata: {},
  folder: '',
  archivedAt: null,
  createdAt: T,
  updatedAt: T,
  origin: { scope: 'general', id: null, name: 'Quilltap General' },
}

type Mutations = AtlasEntryActions['mutations']

function makeActions(overrides: Partial<Mutations> = {}): Pick<AtlasEntryActions, 'mutations'> {
  return {
    mutations: {
      create: jest.fn(async () => CONVERTIBLE),
      update: jest.fn(async () => CONVERTIBLE),
      ...overrides,
    } as unknown as Mutations,
  }
}

function respondWith(overlaps: AtlasOverlap[] = []) {
  const body = (url: string): unknown => {
    if (url.includes('action=overlaps')) return { overlaps }
    if (url.includes('action=folders')) return { folders: [] }
    if (url.includes('/images')) return { current: null, images: [] }
    return {}
  }
  global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => body(String(input)),
  })) as unknown as typeof fetch
}

function renderEditor(entry: AtlasEntryWithOrigin | null, actions = makeActions()) {
  const onSaved = jest.fn()
  renderWithQuery(
    <AtlasEntryEditor
      container={GENERAL}
      containerLabel="Quilltap General"
      entry={entry}
      actions={actions}
      onClose={jest.fn()}
      onSaved={onSaved}
    />,
  )
  return { actions, onSaved }
}

const realFetch = global.fetch
beforeEach(() => respondWith())
afterAll(() => {
  global.fetch = realFetch
})

describe('graphic prompt', () => {
  it('counts as you type and warns only past the soft limit', () => {
    renderEditor(null)
    const prompt = screen.getByLabelText('Graphic prompt')
    expect(screen.getByText(`0 / ${ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT} characters`)).toBeInTheDocument()

    fireEvent.change(prompt, { target: { value: 'x'.repeat(ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT) } })
    expect(screen.getByText(`${ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT} / ${ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT} characters`)).toBeInTheDocument()
    expect(screen.queryByTestId('atlas-graphic-prompt-warning')).not.toBeInTheDocument()

    fireEvent.change(prompt, { target: { value: 'x'.repeat(ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT + 1) } })
    expect(screen.getByTestId('atlas-graphic-prompt-warning')).toHaveTextContent(/Warning/)
  })

  it('never blocks a save over the limit', async () => {
    const { actions, onSaved } = renderEditor(null)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Convertible' } })
    const long = 'y'.repeat(ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT * 2)
    fireEvent.change(screen.getByLabelText('Graphic prompt'), { target: { value: long } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(actions.mutations.create).toHaveBeenCalledWith(GENERAL, expect.objectContaining({ name: 'Convertible', graphicPrompt: long }))
  })
})

describe('alias token input', () => {
  it('adds on Enter and on a comma, removes the last on Backspace, and by its remove button', () => {
    renderEditor(null)
    const input = screen.getByLabelText('Aliases')

    fireEvent.change(input, { target: { value: 'lander' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove alias lander' })).toBeInTheDocument()
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: 'car' } })
    fireEvent.keyDown(input, { key: ',' })
    expect(screen.getByRole('button', { name: 'Remove alias car' })).toBeInTheDocument()

    // A repeat in another case is not added twice.
    fireEvent.change(input, { target: { value: 'CAR' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByRole('button', { name: /^Remove alias/ })).toHaveLength(2)

    // Backspace in the empty field takes the last off.
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.queryByRole('button', { name: 'Remove alias car' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove alias lander' }))
    expect(screen.queryAllByRole('button', { name: /^Remove alias/ })).toHaveLength(0)
  })

  it('Backspace with text in the field edits the text, not the tokens', () => {
    renderEditor(CONVERTIBLE)
    const input = screen.getByLabelText('Aliases')
    fireEvent.change(input, { target: { value: 'ca' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.getByRole('button', { name: 'Remove alias lander' })).toBeInTheDocument()
  })

  it('sends the aliases with the save', async () => {
    const { actions } = renderEditor(CONVERTIBLE)
    const input = screen.getByLabelText('Aliases')
    fireEvent.change(input, { target: { value: 'dinghy' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(actions.mutations.update).toHaveBeenCalledWith(
        GENERAL,
        CONVERTIBLE.id,
        expect.objectContaining({ aliases: ['lander', 'dinghy'] }),
      ),
    )
  })

  it('addAliasTerms splits commas, trims, and skips repeats and the name', () => {
    expect(addAliasTerms(['lander'], ' car , Lander,, convertible ,dinghy', 'Convertible')).toEqual(['lander', 'car', 'dinghy'])
  })
})

describe('overlap notices', () => {
  it("shows this entry's notices for both kinds", async () => {
    respondWith([
      { term: 'lander', entryId: CONVERTIBLE.id, kind: 'entry', otherName: 'Moon Lander', otherOrigin: { scope: 'project', id: 'p1', name: 'The Quest' } },
      { term: 'Convertible', entryId: CONVERTIBLE.id, kind: 'character', otherName: 'Convertible Jones' },
      { term: 'other', entryId: 'someone-else', kind: 'entry', otherName: 'Elsewhere' },
    ])
    renderEditor(CONVERTIBLE)
    const notices = await screen.findByTestId('atlas-overlap-notices')
    expect(notices).toHaveTextContent('Moon Lander')
    expect(notices).toHaveTextContent('Project: The Quest')
    expect(notices).toHaveTextContent('will never match')
    expect(notices).not.toHaveTextContent('Elsewhere')
  })
})

describe('name refusal', () => {
  it('shows NAME_TAKEN under the name', async () => {
    const create = jest.fn(async () => {
      throw new AtlasRequestError('taken', 409, 'NAME_TAKEN', { name: 'Convertible' })
    })
    const { onSaved } = renderEditor(null, makeActions({ create } as Partial<Mutations>))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Convertible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('An entry called "Convertible" is already filed in this atlas')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })
})
