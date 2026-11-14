/**
 * The Providers card (Settings → Connections → Providers, D10).
 *
 * *By provider*: one card per configured provider — keys first, then every
 * profile that uses it with a kind badge, and an Add menu that opens the kind's
 * own modal with the provider preselected. A provider no key names but a
 * profile does (keyless Ollama) still gets a card.
 *
 * *By kind*: the four kind cards as they always were; a deep link to one of
 * them (`focusCard`) opens *By kind* with that card open. The view choice
 * survives a remount (localStorage).
 *
 * The modals and the kind cards are stubbed: their own suites cover them, and
 * what is pinned here is the regrouping and the wiring. One test renders the
 * real API key modal to show the preselection reaching its provider picker.
 */

import React from 'react'
import { screen, fireEvent, waitFor, within, render } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ProvidersCard, PROVIDERS_VIEW_STORAGE_KEY } from '@/components/settings/cards/providers-card'

jest.mock('@/components/providers/theme-provider', () => ({
  useSubsystemInfo: (id: string) => ({ name: `Persona ${id}`, description: `${id} desc`, thumbnail: null }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

jest.mock('@/hooks/useAutoAssociate', () => ({
  useAutoAssociate: () => () => undefined,
}))

jest.mock('@/components/settings/cards/connections-cards', () => ({
  ApiKeysCard: () => <div data-testid="kind-api-keys">API keys list</div>,
  ConnectionProfilesCard: () => <div data-testid="kind-connection-profiles">Connection list</div>,
  ImageProfilesCard: () => <div data-testid="kind-image-profiles">Image list</div>,
  EmbeddingProfilesCard: () => <div data-testid="kind-embedding-profiles">Embedding list</div>,
}))

jest.mock('@/components/settings/api-keys/ApiKeyModal', () => ({
  ApiKeyModal: ({ isOpen, initialProvider }: { isOpen: boolean; initialProvider?: string }) =>
    isOpen ? <div role="dialog" aria-label="key modal">key modal for {initialProvider ?? '(none)'}</div> : null,
}))

jest.mock('@/components/settings/connection-profiles/useConnectionProfileModal', () => {
  const ReactActual = jest.requireActual('react')
  return {
    useConnectionProfileModal: () => {
      const [state, setState] = ReactActual.useState(null)
      return {
        openNew: (provider?: string) => setState({ provider }),
        openEdit: (profile: { name: string }) => setState({ editing: profile.name }),
        modal: state ? (
          <div role="dialog" aria-label="connection modal">
            {state.editing ? `editing ${state.editing}` : `connection modal for ${state.provider ?? '(none)'}`}
          </div>
        ) : null,
      }
    },
  }
})

jest.mock('@/components/image-profiles/ImageProfileModal', () => ({
  ImageProfileModal: ({ initialProvider, profile }: { initialProvider?: string; profile?: { name: string } }) => (
    <div role="dialog" aria-label="image modal">
      {profile ? `editing ${profile.name}` : `image modal for ${initialProvider ?? '(none)'}`}
    </div>
  ),
}))

jest.mock('@/components/settings/embedding-profiles/ProfileModal', () => ({
  ProfileModal: ({ initialProvider, profile }: { initialProvider?: string; profile?: { name: string } | null }) => (
    <div role="dialog" aria-label="embedding modal">
      {profile ? `editing ${profile.name}` : `embedding modal for ${initialProvider ?? '(none)'}`}
    </div>
  ),
}))

const KEYS = [
  {
    id: 'key-openai',
    provider: 'OPENAI',
    label: 'My OpenAI Key',
    isActive: true,
    lastUsed: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    keyPreview: 'sk-…abcd',
  },
]

const PROVIDERS = [
  {
    name: 'OPENAI',
    displayName: 'OpenAI',
    type: 'llm',
    configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
    capabilities: { chat: true, imageGeneration: true, embeddings: true, webSearch: true },
  },
  {
    name: 'OLLAMA',
    displayName: 'Ollama',
    type: 'llm',
    configRequirements: { requiresApiKey: false, requiresBaseUrl: true },
    capabilities: { chat: true, imageGeneration: false, embeddings: true, webSearch: false },
  },
]

function route(path: string, action: string | null): { status: number; body: unknown } {
  const json = (body: unknown) => ({ status: 200, body })
    if (path === '/api/v1/api-keys') return json({ apiKeys: KEYS, count: KEYS.length })
    if (path === '/api/v1/providers') return json({ providers: PROVIDERS })
    if (path === '/api/v1/connection-profiles') {
      return json({
        profiles: [
          { id: 'cp-1', name: 'GPT Daily', provider: 'OPENAI', apiKeyId: 'key-openai', modelName: 'gpt-5', parameters: {}, isDefault: true },
          { id: 'cp-2', name: 'Local Llama', provider: 'OLLAMA', modelName: 'llama3', parameters: {}, isDefault: false },
        ],
      })
    }
    if (path === '/api/v1/image-profiles') {
      return json({
        profiles: [
          { id: 'ip-1', name: 'Gallery', provider: 'OPENAI', apiKeyId: 'key-openai', modelName: 'gpt-image-1', parameters: {}, isDefault: false },
        ],
      })
    }
    if (path === '/api/v1/embedding-profiles' && action === 'list-providers') {
      return json({ providers: ['BUILTIN', 'OPENAI', 'OLLAMA'] })
    }
    if (path === '/api/v1/embedding-profiles' && action === 'list-models') {
      return json({ OPENAI: [{ id: 'text-embedding-3-small', name: 'small' }] })
    }
    if (path === '/api/v1/embedding-profiles') {
      return json({
        profiles: [
          // No provider field: grouped by its key's provider.
          { id: 'ep-1', name: 'Recall', provider: '', apiKeyId: 'key-openai', modelName: 'text-embedding-3-small', isDefault: true },
        ],
      })
    }
  return { status: 404, body: { error: `unexpected ${path}` } }
}

function stubRoutes() {
  jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const url = new URL(raw, 'http://localhost')
      const { status, body } = route(url.pathname, url.searchParams.get('action'))
      return Promise.resolve({
        ok: status < 400,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response)
    })
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  jest.restoreAllMocks()
  stubRoutes()
  window.localStorage.clear()
})

async function openProviderCard(name: string) {
  const header = await screen.findByRole('button', { name: new RegExp(`^${name}`) })
  expect(header).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(header)
  expect(header).toHaveAttribute('aria-expanded', 'true')
  return header.closest('section') as HTMLElement
}

describe('Providers → By provider', () => {
  it('renders one card per provider with its key, its badged profiles and an Add menu that preselects it', async () => {
    renderWithQuery(<ProvidersCard />)

    const card = await openProviderCard('OpenAI')

    // The key row, with Saquel's badge and its Test action
    expect(within(card).getByText('My OpenAI Key')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Test' })).toBeInTheDocument()
    expect(within(card).getByLabelText('Persona saquel')).toBeInTheDocument()

    // Three profiles, one of each kind, each badged
    const rows = within(card).getAllByRole('button').filter((b) => b.hasAttribute('data-kind'))
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['connection', 'image', 'embedding'])
    expect(rows[0]).toHaveTextContent('Connection')
    expect(rows[0]).toHaveTextContent('GPT Daily')
    expect(rows[0]).toHaveTextContent('gpt-5')
    expect(within(rows[0]).getByLabelText('Persona forge')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Gallery')
    expect(within(rows[1]).getByLabelText('Persona lantern')).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('Recall')
    expect(within(rows[2]).getByLabelText('Persona commonplace-book')).toBeInTheDocument()

    // Opening a profile opens its kind's modal for editing
    fireEvent.click(rows[1])
    expect(await screen.findByRole('dialog', { name: 'image modal' })).toHaveTextContent('editing Gallery')

    // The Add menu: every kind, each preselecting OpenAI
    const addButton = within(card).getByRole('button', { name: 'Add to OpenAI' })
    expect(addButton).toHaveAttribute('aria-haspopup', 'menu')

    const choose = async (label: string) => {
      fireEvent.click(addButton)
      const menu = await screen.findByRole('menu')
      fireEvent.click(within(menu).getByRole('menuitem', { name: label }))
    }

    await choose('API key')
    expect(await screen.findByRole('dialog', { name: 'key modal' })).toHaveTextContent('key modal for OPENAI')

    await choose('Connection profile')
    expect(await screen.findByRole('dialog', { name: 'connection modal' })).toHaveTextContent('connection modal for OPENAI')

    await choose('Image profile')
    expect(await screen.findByRole('dialog', { name: 'image modal' })).toHaveTextContent('image modal for OPENAI')

    await choose('Embedding profile')
    expect(await screen.findByRole('dialog', { name: 'embedding modal' })).toHaveTextContent('embedding modal for OPENAI')
  })

  it('gives a keyless provider named only by a profile its own card', async () => {
    renderWithQuery(<ProvidersCard />)

    const card = await openProviderCard('Ollama')
    expect(within(card).queryByText('Keys')).not.toBeInTheDocument()
    expect(within(card).getByText('Local Llama')).toBeInTheDocument()

    // Ollama takes no key and makes no images: those entries are offered disabled
    fireEvent.click(within(card).getByRole('button', { name: 'Add to Ollama' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'API key' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Image profile' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Connection profile' })).toBeEnabled()
  })

  it('ends with an Add a provider card offering the key modal and the Setup Wizard', async () => {
    renderWithQuery(<ProvidersCard />)
    await screen.findByRole('button', { name: /^OpenAI/ })

    expect(screen.getByRole('link', { name: 'Open the Setup Wizard' })).toHaveAttribute('href', '/settings/wizard')
    fireEvent.click(screen.getByRole('button', { name: 'Add an API key' }))
    expect(await screen.findByRole('dialog', { name: 'key modal' })).toHaveTextContent('key modal for (none)')
  })
})

describe('Providers → By kind', () => {
  it('renders the four existing kind cards', async () => {
    renderWithQuery(<ProvidersCard />)
    fireEvent.click(screen.getByRole('button', { name: 'By kind' }))

    for (const title of ['API Keys', 'Connection Profiles', 'Image Profiles', 'Embedding Profiles']) {
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeInTheDocument()
    }
  })

  it('opens By kind with Image Profiles open for focusCard="image-profiles"', async () => {
    window.localStorage.setItem(PROVIDERS_VIEW_STORAGE_KEY, 'provider')
    renderWithQuery(<ProvidersCard focusCard="image-profiles" />)

    expect(screen.getByRole('button', { name: 'By kind' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Image Profiles/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('kind-image-profiles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Connection Profiles/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('remembers the view across a remount', async () => {
    const first = renderWithQuery(<ProvidersCard />)
    expect(screen.getByRole('button', { name: 'By provider' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'By kind' }))
    expect(window.localStorage.getItem(PROVIDERS_VIEW_STORAGE_KEY)).toBe('kind')
    first.unmount()

    renderWithQuery(<ProvidersCard />)
    expect(screen.getByRole('button', { name: 'By kind' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /API Keys/ })).toBeInTheDocument()
  })
})

describe('ApiKeyModal preselection', () => {
  it('opens with the provider picker set to the preselected provider', async () => {
    const { ApiKeyModal } = jest.requireActual('@/components/settings/api-keys/ApiKeyModal')
    render(<ApiKeyModal isOpen onClose={() => undefined} onSuccess={() => undefined} initialProvider="OPENAI" />)

    const select = screen.getByLabelText(/Provider/) as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    expect(select.value).toBe('OPENAI')
  })
})
