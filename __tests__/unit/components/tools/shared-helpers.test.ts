/**
 * Small helpers shared across the tools and setup-wizard components: job
 * status colours, the memory checks of the import/export wizards, and the
 * provider capability filter.
 */

import { jobStatusColor } from '@/components/tools/tasks-queue/job-status'
import { previewHasMemories } from '@/components/tools/import-export/utils'
import { supportsMemories } from '@/components/tools/import-export/types'
import type { ImportPreviewUI } from '@/components/tools/import-export/types'
import { providersWithCapability } from '@/components/setup-wizard/useProviderWizardState'
import type { ProviderInfo } from '@/components/setup-wizard/useProviderWizardState'

describe('jobStatusColor', () => {
  it.each([
    ['PROCESSING', 'qt-text-info'],
    ['PENDING', 'qt-text-warning'],
    ['PAUSED', 'qt-text-warning'],
    ['FAILED', 'qt-text-destructive'],
    ['COMPLETED', 'qt-text-secondary'],
  ])('%s wears %s', (status, colour) => {
    expect(jobStatusColor(status)).toBe(colour)
  })
})

describe('previewHasMemories', () => {
  const preview = (entities: Record<string, unknown>) => ({ entities }) as unknown as ImportPreviewUI

  it('is true only for a positive memory count', () => {
    expect(previewHasMemories(preview({ memories: { count: 3 } }))).toBe(true)
    expect(previewHasMemories(preview({ memories: { count: 0 } }))).toBe(false)
    expect(previewHasMemories(preview({}))).toBe(false)
    expect(previewHasMemories(null)).toBe(false)
  })
})

describe('supportsMemories', () => {
  it('is true for characters and chats only', () => {
    expect(supportsMemories('characters')).toBe(true)
    expect(supportsMemories('chats')).toBe(true)
    expect(supportsMemories('tags')).toBe(false)
    expect(supportsMemories(null)).toBe(false)
  })
})

describe('providersWithCapability', () => {
  const provider = (id: string, capabilities: Partial<ProviderInfo['capabilities']>) =>
    ({
      id,
      capabilities: { chat: false, imageGeneration: false, embeddings: false, webSearch: false, ...capabilities },
    }) as ProviderInfo

  const availableProviders = [
    provider('a', { chat: true }),
    provider('b', { embeddings: true }),
    provider('c', { chat: true, imageGeneration: true }),
  ]

  it('returns the selected providers with the capability, in selection order', () => {
    const state = { selectedProviders: ['c', 'b', 'a'], availableProviders }
    expect(providersWithCapability(state, 'chat').map((p) => p.id)).toEqual(['c', 'a'])
    expect(providersWithCapability(state, 'embeddings').map((p) => p.id)).toEqual(['b'])
  })

  it('skips a selected id that is not available', () => {
    const state = { selectedProviders: ['missing', 'a'], availableProviders }
    expect(providersWithCapability(state, 'chat').map((p) => p.id)).toEqual(['a'])
  })
})
