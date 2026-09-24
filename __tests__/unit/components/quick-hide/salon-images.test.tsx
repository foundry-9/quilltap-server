/**
 * Quick-hide "Salon Images".
 *
 * The switch lives in QuickHideProvider beside the other quick-hide
 * toggles (localStorage-persisted, off by default). The Salon hands it down
 * through ImagesHiddenProvider, and the shared image sites (Avatar among
 * them) read it from there, so every page that
 * does not provide it keeps its images.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import { QuickHideProvider, useQuickHide } from '@/components/providers/quick-hide-provider'
import { ImagesHiddenProvider } from '@/components/quick-hide/images-hidden-context'
import Avatar from '@/components/ui/Avatar'
import LazyMessageContent from '@/components/chat/LazyMessageContent'

jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))

// The real MessageContent pulls in ESM-only react-markdown; the stand-in
// just marks which path LazyMessageContent took.
jest.mock('@/components/chat/MessageContent', () => ({
  __esModule: true,
  default: () => <div data-testid="full-render" />,
}))

jest.mock('@/hooks/useAvatarDisplay', () => ({
  useAvatarDisplay: () => ({ style: 'CIRCULAR' }),
}))

const STORAGE_KEY = 'quilltap.quickHide.hideSalonImages'
const fetchMock = global.fetch as jest.Mock

function Probe() {
  const { hideSalonImages, toggleHideSalonImages, clearAllHidden } = useQuickHide()
  return (
    <div>
      <button onClick={toggleHideSalonImages}>toggle</button>
      <button onClick={clearAllHidden}>clear</button>
      <span data-testid="images">{hideSalonImages ? 'hidden' : 'shown'}</span>
    </div>
  )
}

async function renderProbe() {
  render(
    <QuickHideProvider>
      <Probe />
    </QuickHideProvider>
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
}

describe('QuickHideProvider — hideSalonImages', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ tags: [] }) } as never)
    window.localStorage.clear()
  })

  it('shows images by default', async () => {
    await renderProbe()
    expect(screen.getByTestId('images')).toHaveTextContent('shown')
  })

  it('toggles and persists the choice to localStorage', async () => {
    await renderProbe()
    await act(async () => { screen.getByText('toggle').click() })
    expect(screen.getByTestId('images')).toHaveTextContent('hidden')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')

    await act(async () => { screen.getByText('toggle').click() })
    expect(screen.getByTestId('images')).toHaveTextContent('shown')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('restores a stored choice on load', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    await renderProbe()
    await waitFor(() => expect(screen.getByTestId('images')).toHaveTextContent('hidden'))
  })

  it('is reset by Clear All Hidden', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    await renderProbe()
    await waitFor(() => expect(screen.getByTestId('images')).toHaveTextContent('hidden'))
    await act(async () => { screen.getByText('clear').click() })
    expect(screen.getByTestId('images')).toHaveTextContent('shown')
  })
})

describe('ImagesHiddenProvider consumers', () => {
  it('Avatar paints the image outside the provider', () => {
    render(<Avatar name="Vera" src="/img/vera.webp" />)
    expect(screen.getByRole('img', { name: 'Vera' })).toHaveAttribute('src', '/img/vera.webp')
  })

  it('Avatar falls back to the initial when images are hidden', () => {
    render(
      <ImagesHiddenProvider hidden>
        <Avatar name="Vera" src="/img/vera.webp" />
      </ImagesHiddenProvider>
    )
    expect(screen.queryByRole('img', { name: 'Vera' })).toBeNull()
    expect(screen.getByText('V')).toBeInTheDocument()
  })


  it('LazyMessageContent keeps the pre-rendered fast path when images are shown', () => {
    const { container } = render(
      <LazyMessageContent content="x" renderedHtml={'<p><img src="/img/a.webp" alt="a"></p>'} />
    )
    expect(container.querySelector('img')).not.toBeNull()
    expect(screen.queryByTestId('full-render')).toBeNull()
  })

  it('LazyMessageContent routes pre-rendered HTML with an image to the full render when hidden', () => {
    const { container } = render(
      <ImagesHiddenProvider hidden>
        <LazyMessageContent content="x" renderedHtml={'<p><img src="/img/a.webp" alt="a"></p>'} />
      </ImagesHiddenProvider>
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('full-render')).toBeInTheDocument()
  })

  it('LazyMessageContent keeps the fast path for image-free HTML even when hidden', () => {
    render(
      <ImagesHiddenProvider hidden>
        <LazyMessageContent content="x" renderedHtml={'<p>plain words</p>'} />
      </ImagesHiddenProvider>
    )
    expect(screen.getByText('plain words')).toBeInTheDocument()
    expect(screen.queryByTestId('full-render')).toBeNull()
  })
})
