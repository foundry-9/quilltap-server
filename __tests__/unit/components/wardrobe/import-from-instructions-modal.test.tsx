/**
 * Tests for the wardrobe's Import from Instructions wizard.
 *
 * Global jest (bare jest.mock factories hoist), `renderWithQuery` for the
 * `design-defaults` read, and a fetch router that tells the streaming design
 * POST from the JSON defaults GET and the wardrobe creates. Heavy children are
 * stubbed and `useConnectionProfiles` mocked so the Model select is
 * deterministic.
 */

import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import {
  ImportFromInstructionsModal,
  describeAuroraActivity,
  describeWebReach,
} from '@/components/wardrobe/ImportFromInstructionsModal'

jest.mock('@/components/chat/ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => (content ? <div>{content}</div> : null),
}))
jest.mock('@/components/chat/QuillAnimation', () => ({
  QuillAnimation: () => <span data-testid="quill-animation" />,
}))
jest.mock('@/hooks/useConnectionProfiles', () => ({
  useConnectionProfiles: jest.fn(),
}))
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
}))

import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

const PROJECT_ID = '6f9619ff-8b86-4011-b42d-00c04fc964ff'
const PROJECT_WARDROBE = `/api/v1/projects/${PROJECT_ID}/wardrobe`

const PROFILES = [
  { id: 'p-web', name: 'The Usual', provider: 'anthropic', modelName: 'm', isDefault: true, allowToolUse: true, allowWebSearch: true },
  { id: 'p-noweb', name: 'Homebody', provider: 'anthropic', modelName: 'm', isDefault: false, allowToolUse: true, allowWebSearch: false },
  { id: 'p-notools', name: 'Cheap', provider: 'anthropic', modelName: 'm', isDefault: false, allowToolUse: false, allowWebSearch: false },
]

const PROPOSAL = {
  items: [
    { title: 'Pencil Skirt', description: 'Charcoal wool.', imagePrompt: 'charcoal pencil skirt', types: ['bottom'], appropriateness: 'business' },
    { title: 'Silk Blouse', description: 'Ivory.', imagePrompt: 'ivory silk blouse', types: ['top'], appropriateness: 'business' },
  ],
  outfit: { title: 'Board Meeting', description: 'Severe.', appropriateness: 'business' },
  reuse: [{ id: 'item-blazer', title: 'Navy Blazer', types: ['top'] }],
  notes: 'Built round the blazer already on the rail.',
}

const done = (proposal: unknown = PROPOSAL) => ({ done: true, proposal, provider: 'anthropic', modelName: 'm' })

function sseBody(frames: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder()
  return {
    getReader() {
      let i = 0
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined }
          return { done: false, value: encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`) }
        },
        releaseLock() {},
        cancel: async () => {},
      }
    },
  }
}

interface FetchLog {
  designs: Array<Record<string, unknown>>
  creates: Array<{ url: string; body: Record<string, unknown> }>
}

function installFetch(
  runs: Array<Array<Record<string, unknown>>>,
  defaults: Record<string, unknown> = { defaultProfileId: 'p-web', webSearchConfigured: true, curlConfigured: true },
): FetchLog {
  const log: FetchLog = { designs: [], creates: [] }
  let nextId = 0
  ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('action=design-from-instructions')) {
      log.designs.push(JSON.parse(String(init?.body)))
      return { ok: true, status: 200, body: sseBody(runs.shift() ?? []) }
    }
    if (url.includes('action=design-defaults')) {
      const text = JSON.stringify(defaults)
      return { ok: true, status: 200, json: async () => defaults, text: async () => text }
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      log.creates.push({ url, body })
      nextId += 1
      const payload = { wardrobeItem: { ...body, id: `new-${nextId}` } }
      return { ok: true, status: 201, json: async () => payload, text: async () => JSON.stringify(payload) }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
  })
  return log
}

function renderModal(props: Partial<React.ComponentProps<typeof ImportFromInstructionsModal>> = {}) {
  const onClose = jest.fn()
  const onImported = jest.fn()
  renderWithQuery(
    <ImportFromInstructionsModal
      container={{ scope: 'project', id: PROJECT_ID }}
      containerLabel="Project: Ashfall"
      folder="Uniforms"
      onClose={onClose}
      onImported={onImported}
      {...props}
    />,
  )
  return { onClose, onImported }
}

const typeInstructions = (text = 'a business outfit') =>
  fireEvent.change(screen.getByLabelText('What shall Aurora design?'), { target: { value: text } })

async function designOnce() {
  typeInstructions()
  fireEvent.click(screen.getByRole('button', { name: 'Set Aurora to work' }))
  await screen.findByTestId('wardrobe-design-review')
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useConnectionProfiles).mockReturnValue({ profiles: PROFILES, loading: false, getProfileProvider: jest.fn() } as never)
})

describe('ImportFromInstructionsModal — inputs', () => {
  it('needs instructions before Aurora will start', () => {
    installFetch([])
    renderModal()
    expect(screen.getByRole('button', { name: 'Set Aurora to work' })).toBeDisabled()
    typeInstructions()
    expect(screen.getByRole('button', { name: 'Set Aurora to work' })).toBeEnabled()
  })

  it('preselects the default profile and withholds tool-less ones while anything is to be looked up', async () => {
    installFetch([])
    renderModal()
    const select = screen.getByLabelText('Model') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('p-web'))
    await waitFor(() => expect(screen.getByLabelText('Consult the wider web')).toBeChecked())
    expect(screen.getByRole('option', { name: /Cheap/ })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Search the stores and records'))
    expect(screen.getByRole('option', { name: /Cheap/ })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Consult the wider web'))
    expect(screen.getByRole('option', { name: /Cheap/ })).toBeEnabled()
  })

  it('disables the web and says why when none of it is reachable', async () => {
    installFetch([], { defaultProfileId: 'p-web', webSearchConfigured: false, curlConfigured: false })
    renderModal()
    const web = screen.getByLabelText('Consult the wider web')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/No search provider is configured/))
    expect(web).toBeDisabled()
    expect(web).not.toBeChecked()
  })

  it('says which half of the web is missing when a profile forbids searching', async () => {
    installFetch([])
    renderModal()
    await waitFor(() => expect(screen.getByLabelText('Consult the wider web')).toBeChecked())
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'p-noweb' } })
    expect(screen.getByRole('status')).toHaveTextContent(/may open pages but not search/)
    expect(screen.getByLabelText('Consult the wider web')).toBeEnabled()
  })
})

describe('ImportFromInstructionsModal — the run and the review', () => {
  it('POSTs the instructions, toggles, target and profile, then shows the design', async () => {
    const log = installFetch([[{ toolsDetected: 1, toolNames: ['search_web'], toolArguments: [{ query: 'business dress' }] }, done()]])
    renderModal()
    await waitFor(() => expect(screen.getByLabelText('Consult the wider web')).toBeChecked())
    await designOnce()

    expect(log.designs[0]).toEqual({
      instructions: 'a business outfit',
      searchStores: true,
      searchWeb: true,
      connectionProfileId: 'p-web',
      target: { scope: 'project', id: PROJECT_ID },
    })
    expect(screen.getByText('Built round the blazer already on the rail.')).toBeInTheDocument()
    expect(screen.getByText(/2 pieces designed by anthropic • m/)).toBeInTheDocument()
    expect((screen.getByLabelText('Outfit title') as HTMLInputElement).value).toBe('Board Meeting')
    expect(screen.getByLabelText('Navy Blazer')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Import 2 Items + Outfit' })).toBeEnabled()
  })

  it('sends searchWeb false when the web is unreachable, whatever the box wanted', async () => {
    const log = installFetch([[done()]], { defaultProfileId: 'p-web', webSearchConfigured: false, curlConfigured: false })
    renderModal()
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    await designOnce()
    expect(log.designs[0].searchWeb).toBe(false)
  })

  it('shows the error and keeps the instructions when the run fails', async () => {
    installFetch([[{ error: 'Aurora came back empty-handed.' }]])
    renderModal()
    typeInstructions('a grey cloak')
    fireEvent.click(screen.getByRole('button', { name: 'Set Aurora to work' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Aurora came back empty-handed.')
    expect((screen.getByLabelText('What shall Aurora design?') as HTMLTextAreaElement).value).toBe('a grey cloak')
  })

  it('revises from the design as edited: the new title, only ticked pieces, reused ids', async () => {
    const revised = { ...PROPOSAL, items: [PROPOSAL.items[0]], reuse: [], outfit: null, notes: 'Longer now.' }
    const log = installFetch([[done()], [done(revised)]])
    renderModal()
    await designOnce()

    fireEvent.change(screen.getAllByLabelText('Item title')[0], { target: { value: 'Long Skirt' } })
    fireEvent.click(screen.getByLabelText('Import Silk Blouse'))
    fireEvent.change(screen.getByLabelText('Revise'), { target: { value: 'make the skirt longer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }))

    await screen.findByText('Longer now.')
    expect(log.designs[1].revision).toBe('make the skirt longer')
    expect(log.designs[1].priorProposal).toEqual({
      items: [{ title: 'Long Skirt', description: 'Charcoal wool.', imagePrompt: 'charcoal pencil skirt', types: ['bottom'], appropriateness: 'business' }],
      outfit: { title: 'Board Meeting', description: 'Severe.', appropriateness: 'business' },
      reuseItemIds: ['item-blazer'],
    })
    expect(screen.getByRole('button', { name: 'Import 1 Item' })).toBeEnabled()
    expect((screen.getByLabelText('Revise') as HTMLInputElement).value).toBe('')
  })

  it('Start over returns to the inputs with the instructions intact', async () => {
    installFetch([[done()]])
    renderModal()
    await designOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect((screen.getByLabelText('What shall Aurora design?') as HTMLTextAreaElement).value).toBe('a business outfit')
  })
})

describe('ImportFromInstructionsModal — import', () => {
  it('creates the pieces in the browsed wardrobe and folder, then an outfit that borrows the reused piece', async () => {
    const log = installFetch([[done()]])
    const { onClose, onImported } = renderModal()
    await designOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 Items + Outfit' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onImported).toHaveBeenCalled()
    expect(log.creates.map((c) => c.url)).toEqual([PROJECT_WARDROBE, PROJECT_WARDROBE, PROJECT_WARDROBE])
    expect(log.creates[0].body).toMatchObject({ title: 'Pencil Skirt', types: ['bottom'], folder: 'Uniforms', isDefault: false })
    expect(log.creates[2].body).toMatchObject({
      title: 'Board Meeting',
      componentItemIds: ['new-1', 'new-2', 'item-blazer'],
      replace: true,
      folder: 'Uniforms',
    })
    expect((log.creates[2].body.types as string[]).sort()).toEqual(['bottom', 'top'])
    expect(showSuccessToast).toHaveBeenCalledWith('2 pieces stitched to Aurora’s design')
    expect(showSuccessToast).toHaveBeenCalledWith('Outfit “Board Meeting” assembled from 3 pieces')
  })

  it('leaves an unticked reused piece out of the outfit, and files at the root without a folder', async () => {
    const log = installFetch([[done()]])
    renderModal({ folder: '' })
    await designOnce()
    fireEvent.click(screen.getByLabelText('Navy Blazer'))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 Items + Outfit' }))

    await waitFor(() => expect(log.creates).toHaveLength(3))
    expect(log.creates[2].body.componentItemIds).toEqual(['new-1', 'new-2'])
    expect(log.creates[0].body).not.toHaveProperty('folder')
  })

  it('offers an outfit of one new piece and one reused, and none for a single piece alone', async () => {
    const one = { ...PROPOSAL, items: [PROPOSAL.items[0]] }
    installFetch([[done(one)]])
    renderModal()
    await designOnce()
    expect(screen.getByRole('button', { name: 'Import 1 Item + Outfit' })).toBeEnabled()
    fireEvent.click(screen.getByLabelText('Navy Blazer'))
    expect(screen.getByRole('button', { name: 'Import 1 Item' })).toBeEnabled()
  })

  it('keeps the design on screen when nothing could be created', async () => {
    installFetch([[done()]])
    const { onClose } = renderModal()
    await designOnce()
    ;(global.fetch as jest.Mock).mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'The loom is jammed' }),
      text: async () => JSON.stringify({ error: 'The loom is jammed' }),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 Items + Outfit' }))
    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('wardrobe-design-review')).toBeInTheDocument()
  })
})

describe('describeAuroraActivity', () => {
  const line = (name: string, args: Record<string, unknown> = {}) => describeAuroraActivity({ name, arguments: args })

  it('words each tool', () => {
    expect(line('search_web', { query: '"1968 Pan Am uniform"' })).toBe('Enquiring abroad about “1968 Pan Am uniform”')
    expect(line('search', { query: 'funeral' })).toBe('Leafing through the stores for “funeral”')
    expect(line('doc_read_file', { path: 'Notes/ch9.md' })).toBe('Opening Notes/ch9.md')
    expect(line('lookup_character', { character: 'Mara' })).toBe('Taking Mara’s measure')
    expect(line('read_messages')).toBe('Recalling a conversation')
    expect(line('run_sql', { sql: 'select 1' })).toBe('Consulting the ledgers')
    expect(line('submit_final_response')).toBe('Pinning the design')
    expect(line('mystery')).toBe('Working with mystery')
  })

  it('shows only the host of a fetched page', () => {
    expect(line('curl', { url: 'https://example.org/archive/uniforms?q=secret' })).toBe('Reading example.org')
    expect(line('curl', { url: 'not a url' })).toBe('Reading not a url')
    expect(line('curl')).toBe('Reading a page')
  })
})

describe('describeWebReach', () => {
  const reach = (searchConfigured: boolean, profileAllowsSearch: boolean, curlConfigured: boolean) =>
    describeWebReach({ searchConfigured, profileAllowsSearch, curlConfigured })

  it('says nothing when all of it is to hand', () => {
    expect(reach(true, true, true)).toBeNull()
  })

  it('names the missing half, and the reason for it', () => {
    expect(reach(true, true, false)).toMatch(/search the web but not open the pages/)
    expect(reach(true, false, true)).toMatch(/profile does not permit web search/)
    expect(reach(false, true, true)).toMatch(/no search provider is configured/)
    expect(reach(false, false, false)).toMatch(/No search provider is configured and no page-fetching/)
    expect(reach(true, false, false)).toMatch(/profile does not permit web search and no page-fetching/)
  })
})
