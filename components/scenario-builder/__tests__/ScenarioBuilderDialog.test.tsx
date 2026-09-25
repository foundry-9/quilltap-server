/**
 * Tests for the Scenario Builder dialog — "Ask the Host to set the scene."
 *
 * Uses global jest (not @jest/globals) so bare jest.mock factories hoist
 * cleanly, and `renderWithQuery` since the dialog reads its capabilities
 * probe and the save dialog's group list through TanStack Query. `fetch` is
 * jest-fetch-mock (enabled globally in jest.setup.ts); a custom router below
 * distinguishes the streaming build POST from the plain JSON endpoints.
 *
 * Heavy children (`MarkdownLexicalEditor`, `ThinkingBlock`, `QuillAnimation`)
 * are stubbed; `useConnectionProfiles` is mocked so the Model select has
 * deterministic contents without a network round trip.
 */

import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { ScenarioBuilderDialog, describeHostActivity } from '../ScenarioBuilderDialog'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

jest.mock('@/components/markdown-editor/MarkdownLexicalEditor', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    ariaLabel,
    remountKey,
  }: {
    value: string
    onChange: (v: string) => void
    ariaLabel?: string
    remountKey?: number
  }) => (
    <textarea
      key={remountKey}
      aria-label={ariaLabel}
      data-remount-key={remountKey}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

jest.mock('@/components/chat/ThinkingBlock', () => ({
  ThinkingBlock: ({ content }: { content: string }) => (content ? <div>{content}</div> : null),
}))

jest.mock('@/components/chat/QuillAnimation', () => ({
  QuillAnimation: () => <span data-testid="quill-animation" />,
}))

jest.mock('@/hooks/useConnectionProfiles', () => ({
  useConnectionProfiles: jest.fn(),
}))

import { useConnectionProfiles } from '@/hooks/useConnectionProfiles'

const mockUseConnectionProfiles = useConnectionProfiles as jest.MockedFunction<typeof useConnectionProfiles>

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    name: 'Sonnet',
    provider: 'anthropic',
    modelName: 'claude-sonnet-5',
    isDefault: false,
    allowToolUse: true,
    allowWebSearch: true,
    ...overrides,
  }
}

const DEFAULT_PROFILE = profile({ id: 'profile-default', name: 'The Usual', isDefault: true })
const NO_TOOLS_PROFILE = profile({ id: 'profile-no-tools', name: 'Cheap Model', allowToolUse: false })
const NO_WEB_PROFILE = profile({ id: 'profile-no-web', name: 'No Web', allowWebSearch: false })

function setProfiles(profiles: ReturnType<typeof profile>[]) {
  mockUseConnectionProfiles.mockReturnValue({
    profiles,
    loading: false,
    getProfileProvider: jest.fn(),
  } as never)
}

/** A `body` whose `getReader()` plays the given SSE frames, then closes. */
function sseBody(frames: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder()
  return {
    getReader() {
      let i = 0
      return {
        async read() {
          if (i >= frames.length) return { done: true, value: undefined }
          const value = encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`)
          return { done: false, value }
        },
        releaseLock() {},
        cancel: async () => {},
      }
    },
  }
}

interface FetchRouter {
  buildFrames: Array<Array<Record<string, unknown>>>
  buildBodies: Array<Record<string, unknown>>
  saveResponse: { ok: boolean; status: number; json: () => Promise<unknown> }
  groupsResponse: { groups: Array<{ id: string; name: string }> }
}

function installFetchRouter(overrides: Partial<FetchRouter> = {}): FetchRouter {
  const router: FetchRouter = {
    buildFrames: [],
    buildBodies: [],
    saveResponse: { ok: true, status: 200, json: async () => ({ path: 'Scenarios/a-scene.md' }) },
    groupsResponse: { groups: [] },
    ...overrides,
  }

  ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/scenario-builder') && url.includes('action=build')) {
      router.buildBodies.push(JSON.parse(String(init?.body)))
      const frames = router.buildFrames.shift() ?? []
      return { ok: true, status: 200, body: sseBody(frames) }
    }
    if (url.includes('/scenario-builder') && url.includes('action=capabilities')) {
      return { ok: true, status: 200, json: async () => ({ webSearchConfigured: true, curlConfigured: true }) }
    }
    if (url.includes('/groups?characterIds=')) {
      return { ok: true, status: 200, json: async () => router.groupsResponse }
    }
    if (init?.method === 'POST') {
      return router.saveResponse
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })

  return router
}

const CAST = [{ id: 'char-1', name: 'Alice' }]

function renderDialog(props: Partial<React.ComponentProps<typeof ScenarioBuilderDialog>> = {}) {
  const onUse = jest.fn()
  const onSaved = jest.fn()
  const onClose = jest.fn()
  const utils = renderWithQuery(
    <ScenarioBuilderDialog
      isOpen
      onClose={onClose}
      cast={CAST}
      onUse={onUse}
      onSaved={onSaved}
      {...props}
    />,
  )
  return { ...utils, onUse, onSaved, onClose }
}

function fillInputs() {
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'the Lantern Inn' } })
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: 'a rainy evening' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(global.fetch as jest.Mock).mockReset()
  setProfiles([DEFAULT_PROFILE])
})

describe('describeHostActivity', () => {
  it('describes a web search by its query', () => {
    expect(describeHostActivity({ name: 'search_web', arguments: { query: 'Gare du Nord' } })).toBe(
      'Consulting the wider world about “Gare du Nord”',
    )
  })

  it('describes curl by its url, falling back when absent', () => {
    expect(describeHostActivity({ name: 'curl', arguments: { url: 'https://example.com' } })).toBe(
      'Reading https://example.com',
    )
    expect(describeHostActivity({ name: 'curl', arguments: {} })).toBe(
      'Reading a page from the wider world',
    )
  })

  it('describes the document-store search tool', () => {
    expect(describeHostActivity({ name: 'search', arguments: { query: 'inn' } })).toBe(
      'Leafing through the stores for “inn”',
    )
  })

  it('describes doc_read_file by path or uri', () => {
    expect(describeHostActivity({ name: 'doc_read_file', arguments: { path: 'Knowledge/lore.md' } })).toBe(
      'Opening Knowledge/lore.md',
    )
    expect(describeHostActivity({ name: 'doc_read_file', arguments: {} })).toBe('Opening a document')
  })

  it('falls back to a generic line for an unrecognised tool', () => {
    expect(describeHostActivity({ name: 'mystery_tool', arguments: {} })).toBe(
      'Busying himself with mystery_tool',
    )
  })
})

describe('ScenarioBuilderDialog — model selection', () => {
  it('preselects the isDefault profile in the Model select', () => {
    setProfiles([profile({ id: 'p-a' }), DEFAULT_PROFILE])
    renderDialog()

    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe(DEFAULT_PROFILE.id)
  })

  it('renders a no-tools profile as a disabled option labelled "(no tools)"', () => {
    setProfiles([DEFAULT_PROFILE, NO_TOOLS_PROFILE])
    renderDialog()

    const option = screen.getByRole('option', { name: /Cheap Model \(no tools\)/ }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
  })
})

describe('ScenarioBuilderDialog — web-search warning', () => {
  it('shows the web-unreachable warning in real mode when the profile lacks allowWebSearch', () => {
    setProfiles([NO_WEB_PROFILE])
    renderDialog()

    fireEvent.click(screen.getByLabelText('Real'))

    expect(screen.getByRole('status')).toHaveTextContent(/wider world is out of reach/i)
  })

  it('does not show the warning in in-world mode', () => {
    setProfiles([NO_WEB_PROFILE])
    renderDialog()

    // Default mode is in-world with a non-empty cast.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('ScenarioBuilderDialog — running a build', () => {
  it('POSTs to the build endpoint with mode, location, time, profile, and cast ids', async () => {
    const router = installFetchRouter({
      buildFrames: [[{ done: true, scenario: 'Rain on the cobbles.' }]],
    })
    renderDialog()
    fillInputs()

    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))

    await waitFor(() => expect(router.buildBodies).toHaveLength(1))
    expect(router.buildBodies[0]).toMatchObject({
      mode: 'in-world',
      location: 'the Lantern Inn',
      time: 'a rainy evening',
      connectionProfileId: DEFAULT_PROFILE.id,
      characterIds: ['char-1'],
    })
  })

  it('shows the activity list and settles a tool call, then shows the draft on done', async () => {
    installFetchRouter({
      buildFrames: [
        [
          { toolsDetected: 1, toolNames: ['search'], toolArguments: [{ query: 'inn' }] },
          { toolResult: { index: 0, success: true } },
          { done: true, scenario: 'Rain on the cobbles.' },
        ],
      ],
    })
    renderDialog()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))

    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())
    expect(screen.getByLabelText('The scene')).toHaveValue('Rain on the cobbles.')
  })

  it('"Use this scene" calls onUse with the draft and closes the dialog', async () => {
    installFetchRouter({ buildFrames: [[{ done: true, scenario: 'Rain on the cobbles.' }]] })
    const { onUse, onClose } = renderDialog()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))

    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Use this scene' }))

    expect(onUse).toHaveBeenCalledWith('Rain on the cobbles.')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Revise re-POSTs with priorDraft and revision', async () => {
    const router = installFetchRouter({
      buildFrames: [
        [{ done: true, scenario: 'Rain on the cobbles.' }],
        [{ done: true, scenario: 'Rain on the cobbles, two hours later.' }],
      ],
    })
    renderDialog()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))
    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Revise'), { target: { value: 'move it two hours later' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }))

    await waitFor(() => expect(router.buildBodies).toHaveLength(2))
    expect(router.buildBodies[1]).toMatchObject({
      priorDraft: 'Rain on the cobbles.',
      revision: 'move it two hours later',
    })
    await waitFor(() =>
      expect(screen.getByLabelText('The scene')).toHaveValue('Rain on the cobbles, two hours later.'),
    )
  })

  it('a failed revise keeps the draft visible, shows the error, and leaves Use enabled', async () => {
    installFetchRouter({
      buildFrames: [[{ done: true, scenario: 'Rain on the cobbles.' }], [{ error: 'boom' }]],
    })
    renderDialog()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))
    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Revise'), { target: { value: 'try again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revise' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'))
    expect(screen.getByLabelText('The scene')).toHaveValue('Rain on the cobbles.')
    expect(screen.getByRole('button', { name: 'Use this scene' })).not.toBeDisabled()
  })
})

describe('ScenarioBuilderDialog — saving', () => {
  async function runToReview(scenario = 'Rain on the cobbles.') {
    installFetchRouter({ buildFrames: [[{ done: true, scenario }]] })
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))
    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())
  }

  it('"Save as scenario…" opens the save dialog', async () => {
    renderDialog()
    await runToReview()

    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario…' }))

    expect(screen.getByText('File this scene as a scenario')).toBeInTheDocument()
  })

  it('saving to Quilltap General POSTs {filename, name, body} and reports the saved path', async () => {
    const { onSaved } = renderDialog()
    await runToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario…' }))

    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/scenarios' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ path: 'Scenarios/rain.md' }) }
      }
      if (url.includes('/groups?characterIds=')) return { ok: true, status: 200, json: async () => ({ groups: [] }) }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rain on the cobbles' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ kind: 'general', path: 'Scenarios/rain.md' }))

    const [url, init] = (global.fetch as jest.Mock).mock.calls.find(
      ([u, i]: [string, RequestInit]) => u === '/api/v1/scenarios' && i?.method === 'POST',
    )
    expect(url).toBe('/api/v1/scenarios')
    expect(JSON.parse(String(init.body))).toEqual({
      filename: 'Rain on the cobbles',
      name: 'Rain on the cobbles',
      body: 'Rain on the cobbles.',
    })
  })

  it('saving to a character POSTs {title, content} to that character\'s scenarios endpoint', async () => {
    renderDialog()
    await runToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario…' }))

    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/characters/char-1/scenarios' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ scenario: { id: 'scn-1' } }) }
      }
      if (url.includes('/groups?characterIds=')) return { ok: true, status: 200, json: async () => ({ groups: [] }) }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: "Alice's Rain" } })
    fireEvent.change(screen.getByLabelText('Where it lives'), { target: { value: 'character:char-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(
          ([u, i]: [string, RequestInit]) => u === '/api/v1/characters/char-1/scenarios' && i?.method === 'POST',
        ),
      ).toBe(true),
    )
    const [, init] = (global.fetch as jest.Mock).mock.calls.find(
      ([u, i]: [string, RequestInit]) => u === '/api/v1/characters/char-1/scenarios' && i?.method === 'POST',
    )
    expect(JSON.parse(String(init.body))).toEqual({ title: "Alice's Rain", content: 'Rain on the cobbles.' })
  })

  it('a 400 response keeps the save dialog open and shows the error', async () => {
    renderDialog()
    await runToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario…' }))

    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/scenarios' && init?.method === 'POST') {
        return { ok: false, status: 400, json: async () => ({ error: 'That name is already in use.' }) }
      }
      if (url.includes('/groups?characterIds=')) return { ok: true, status: 200, json: async () => ({ groups: [] }) }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rain on the cobbles' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That name is already in use.'))
    expect(screen.getByText('File this scene as a scenario')).toBeInTheDocument()
  })
})

describe('ScenarioBuilderDialog — launched from a scenarios shelf', () => {
  /** Layers the every-home list endpoints (and a group save) over the base router. */
  function mockEverywhereLists() {
    const base = (global.fetch as jest.Mock).getMockImplementation()
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/projects') {
        return { ok: true, status: 200, json: async () => ({ projects: [{ id: 'proj-1', name: 'The Estate' }] }) }
      }
      if (url === '/api/v1/groups') {
        return { ok: true, status: 200, json: async () => ({ groups: [{ id: 'grp-1', name: 'Aeronauts Club' }] }) }
      }
      if (url === '/api/v1/characters') {
        return { ok: true, status: 200, json: async () => ({ characters: [{ id: 'char-9', name: 'Riya' }] }) }
      }
      if (url === '/api/v1/groups/grp-1/scenarios' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ path: 'Scenarios/rain.md' }) }
      }
      return base!(url, init)
    })
  }

  function renderShelf(props: Partial<React.ComponentProps<typeof ScenarioBuilderDialog>> = {}) {
    const onSaved = jest.fn()
    const onClose = jest.fn()
    renderWithQuery(
      <ScenarioBuilderDialog
        isOpen
        onClose={onClose}
        cast={[]}
        groupIds={['grp-1']}
        saveTargets="everywhere"
        defaultSaveTarget="group:grp-1"
        onSaved={onSaved}
        {...props}
      />,
    )
    return { onSaved, onClose }
  }

  it('sends the named group ids and defaults to in-world', async () => {
    const router = installFetchRouter()
    router.buildFrames.push([{ done: true, scenario: 'Rain on the cobbles.' }])
    renderShelf()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))

    await waitFor(() => expect(router.buildBodies).toHaveLength(1))
    expect(router.buildBodies[0]).toMatchObject({ mode: 'in-world', characterIds: [], groupIds: ['grp-1'] })
  })

  it('offers no "Use this scene"; Save is the primary action', async () => {
    const router = installFetchRouter()
    router.buildFrames.push([{ done: true, scenario: 'Rain on the cobbles.' }])
    renderShelf()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))
    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Use this scene' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save as scenario…' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('Save lists every home, preselects the shelf, and files it there', async () => {
    const router = installFetchRouter()
    router.buildFrames.push([{ done: true, scenario: 'Rain on the cobbles.' }])
    const { onSaved } = renderShelf()
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))
    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())

    mockEverywhereLists()
    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario…' }))

    await waitFor(() => expect(screen.getByRole('option', { name: 'Group: Aeronauts Club' })).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'Project: The Estate' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: /Riya.s scenarios/ })).toBeInTheDocument())
    expect((screen.getByLabelText('Where it lives') as HTMLSelectElement).value).toBe('group:grp-1')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({ kind: 'group', groupId: 'grp-1', path: 'Scenarios/rain.md' }),
    )
  })

  it('saving to another project posts to that project', async () => {
    const router = installFetchRouter()
    router.buildFrames.push([{ done: true, scenario: 'Rain on the cobbles.' }])
    const { onSaved } = renderShelf({ groupIds: undefined, defaultSaveTarget: 'general' })
    fillInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Set the scene' }))
    await waitFor(() => expect(screen.getByLabelText('The scene')).toBeInTheDocument())

    mockEverywhereLists()
    const base = (global.fetch as jest.Mock).getMockImplementation()
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/projects/proj-1/scenarios' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ path: 'Scenarios/rain.md' }) }
      }
      return base!(url, init)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as scenario…' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Project: The Estate' })).toBeInTheDocument())
    expect((screen.getByLabelText('Where it lives') as HTMLSelectElement).value).toBe('general')

    fireEvent.change(screen.getByLabelText('Where it lives'), { target: { value: 'project:proj-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({ kind: 'project', projectId: 'proj-1', path: 'Scenarios/rain.md' }),
    )
  })
})
