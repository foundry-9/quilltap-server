/**
 * Bug 243: the job child must not run a job before its plugin registry has
 * loaded, or a BUILTIN embed fails with "Provider 'BUILTIN' not found in
 * registry".
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

import {
  resetPluginReadinessForTests,
  startPluginInitialization,
  whenPluginsReady,
} from '@/lib/background-jobs/child/plugin-readiness'

describe('child plugin readiness', () => {
  beforeEach(() => resetPluginReadinessForTests())

  it('resolves at once when no load was started', async () => {
    await expect(whenPluginsReady(10)).resolves.toBeUndefined()
  })

  it('holds a job until the plugin load settles', async () => {
    let finish!: () => void
    const registry: string[] = []
    startPluginInitialization(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            registry.push('BUILTIN')
            resolve()
          }
        }),
    )

    let ran = false
    const job = whenPluginsReady(5_000).then(() => {
      ran = true
      return registry.includes('BUILTIN')
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(ran).toBe(false)

    finish()
    await expect(job).resolves.toBe(true)
  })

  it('releases jobs when the load fails', async () => {
    startPluginInitialization(() => Promise.reject(new Error('scan failed')))
    await expect(whenPluginsReady(5_000)).resolves.toBeUndefined()
  })

  it('runs the job anyway after the timeout when the load hangs', async () => {
    startPluginInitialization(() => new Promise(() => {}))
    const started = Date.now()
    await whenPluginsReady(30)
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('starts the load only once', async () => {
    const init = jest.fn().mockResolvedValue(undefined)
    await startPluginInitialization(init)
    await startPluginInitialization(init)
    expect(init).toHaveBeenCalledTimes(1)
  })
})
