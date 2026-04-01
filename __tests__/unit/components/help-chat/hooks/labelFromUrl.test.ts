/**
 * Tests for labelFromUrl function
 */

import { labelFromUrl } from '@/components/help-chat/hooks/useHelpChatStreaming'

describe('labelFromUrl', () => {
  // Base path tests
  it('converts /settings to Settings', () => {
    expect(labelFromUrl('/settings')).toBe('Settings')
  })

  it('converts /aurora to Characters', () => {
    expect(labelFromUrl('/aurora')).toBe('Characters')
  })

  it('converts /salon to Chats', () => {
    expect(labelFromUrl('/salon')).toBe('Chats')
  })

  it('converts /prospero to Projects', () => {
    expect(labelFromUrl('/prospero')).toBe('Projects')
  })

  it('converts /profile to Profile', () => {
    expect(labelFromUrl('/profile')).toBe('Profile')
  })

  it('converts /files to Files', () => {
    expect(labelFromUrl('/files')).toBe('Files')
  })

  it('converts /setup to Setup', () => {
    expect(labelFromUrl('/setup')).toBe('Setup')
  })

  it('passes through unknown paths', () => {
    expect(labelFromUrl('/unknown')).toBe('/unknown')
  })

  // Tab query parameter tests
  it('adds tab to settings path', () => {
    expect(labelFromUrl('/settings?tab=chat')).toBe('Settings → Chat')
  })

  it('adds tab to appearance', () => {
    expect(labelFromUrl('/settings?tab=appearance')).toBe('Settings → Appearance')
  })

  it('capitalizes tab name', () => {
    expect(labelFromUrl('/settings?tab=system')).toBe('Settings → System')
  })

  // Tab with hyphens
  it('converts hyphens to spaces in tab', () => {
    expect(labelFromUrl('/settings?tab=my-tab')).toBe('Settings → My tab')
  })

  // Section query parameter tests
  it('adds section after tab', () => {
    expect(labelFromUrl('/settings?tab=chat&section=dangerous-content')).toBe('Settings → Chat → Dangerous Content')
  })

  it('capitalizes section words', () => {
    expect(labelFromUrl('/settings?tab=system&section=data-management')).toBe('Settings → System → Data Management')
  })

  it('handles multiple hyphens in section', () => {
    expect(labelFromUrl('/settings?tab=appearance&section=theme-color-palette')).toBe('Settings → Appearance → Theme Color Palette')
  })

  // Section without tab
  it('adds section without tab', () => {
    expect(labelFromUrl('/settings?section=general')).toBe('Settings → General')
  })

  it('capitalizes single-word section', () => {
    expect(labelFromUrl('/settings?section=appearance')).toBe('Settings → Appearance')
  })

  // Edge cases
  it('handles paths with no query string', () => {
    expect(labelFromUrl('/settings')).toBe('Settings')
  })

  it('handles empty query string', () => {
    expect(labelFromUrl('/settings?')).toBe('Settings')
  })

  it('ignores unrelated query parameters', () => {
    expect(labelFromUrl('/settings?other=value&tab=chat')).toBe('Settings → Chat')
  })

  it('handles query parameters in different order', () => {
    expect(labelFromUrl('/settings?section=test&tab=chat')).toBe('Settings → Chat → Test')
  })

  // More complex scenarios
  it('aurora with tab and section', () => {
    expect(labelFromUrl('/aurora?tab=browse&section=sort-options')).toBe('Characters → Browse → Sort Options')
  })

  it('salon with settings tab', () => {
    expect(labelFromUrl('/salon?tab=settings')).toBe('Chats → Settings')
  })

  it('profile with complex section', () => {
    expect(labelFromUrl('/profile?section=account-security')).toBe('Profile → Account Security')
  })

  // Test case sensitivity
  it('lowercases query parameters for processing', () => {
    const result = labelFromUrl('/settings?tab=Chat')
    // URLSearchParams normalizes, but we'll get what the function produces
    expect(result).toBe('Settings → Chat')
  })

  // Word boundary tests
  it('handles single-letter words in hyphens', () => {
    expect(labelFromUrl('/settings?tab=a-b-c')).toBe('Settings → A b c')
  })

  it('preserves tab name format with underscores if present', () => {
    // URLSearchParams converts underscores to themselves, no special handling
    expect(labelFromUrl('/settings?tab=my_tab')).toBe('Settings → My_tab')
  })
})
