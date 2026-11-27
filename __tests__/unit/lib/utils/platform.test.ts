/**
 * @jest-environment jsdom
 */

import { isMacPlatform } from '@/lib/utils/platform'

function withPlatform(platform: string, fn: () => void) {
  const spy = jest.spyOn(window.navigator, 'platform', 'get').mockReturnValue(platform)
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
}

describe('isMacPlatform', () => {
  it('is true on a macOS platform, whatever its case', () => {
    withPlatform('MacIntel', () => expect(isMacPlatform()).toBe(true))
    withPlatform('macintosh', () => expect(isMacPlatform()).toBe(true))
  })

  it('is false elsewhere', () => {
    withPlatform('Win32', () => expect(isMacPlatform()).toBe(false))
    withPlatform('Linux x86_64', () => expect(isMacPlatform()).toBe(false))
  })
})
