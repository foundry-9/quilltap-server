/**
 * @jest-environment jsdom
 */
import { SeatThumb } from '@/components/chat/SeatThumb'
import { ImagesHiddenProvider } from '@/components/quick-hide/images-hidden-context'
import { render } from '@testing-library/react'

describe('SeatThumb', () => {
  it('shows the avatar at the given size', () => {
    const { container } = render(<SeatThumb avatarUrl="/a.webp" sizeClass="w-6 h-6" />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/a.webp')
    expect(img?.className).toContain('w-6 h-6')
  })

  it('draws a plain disc when there is no avatar', () => {
    const { container } = render(<SeatThumb avatarUrl={null} sizeClass="w-5 h-5" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstElementChild?.className).toContain('w-5 h-5')
  })

  it('honours quick-hide', () => {
    const { container } = render(
      <ImagesHiddenProvider hidden>
        <SeatThumb avatarUrl="/a.webp" sizeClass="w-8 h-8" />
      </ImagesHiddenProvider>,
    )
    expect(container.querySelector('img')).toBeNull()
  })
})
