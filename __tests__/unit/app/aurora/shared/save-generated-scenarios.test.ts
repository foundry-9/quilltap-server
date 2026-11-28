/**
 * #273: a scenario that fails to save is counted and logged, so both AI
 * Wizard callers can say so instead of dropping it silently.
 */

import { saveGeneratedScenarios, scenarioFailureMessage } from '@/app/aurora/shared/save-generated-scenarios'

function res(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body }
}

let errorSpy: jest.SpyInstance
const originalFetch = global.fetch
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  global.fetch = originalFetch
})

describe('saveGeneratedScenarios', () => {
  it('counts a non-OK response as a failure and logs it', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(201, { scenario: { id: 'sc1', title: 'A', content: 'a', createdAt: 't', updatedAt: 't' } }))
      .mockResolvedValueOnce(res(500, { error: 'boom' })) as unknown as typeof fetch

    const result = await saveGeneratedScenarios('c1', [
      { title: 'A', content: 'a' },
      { title: 'B', content: 'b' },
    ])

    expect(result.saved).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.scenarios.map((s) => s.id)).toEqual(['sc1'])
    expect(errorSpy).toHaveBeenCalledWith('Failed to create scenario', expect.objectContaining({ status: 500, error: 'boom' }))
  })

  it('counts a thrown request as a failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    const result = await saveGeneratedScenarios('c1', [{ title: 'A', content: 'a' }])
    expect(result).toEqual({ saved: 0, failed: 1, scenarios: [] })
  })

  it('words the failure toast by count', () => {
    expect(scenarioFailureMessage(1)).toBe('1 scenario could not be saved.')
    expect(scenarioFailureMessage(3)).toBe('3 scenarios could not be saved.')
  })
})
