/**
 * The job child opens its databases before any job runs. Connecting the
 * backend is what opens the mount index; a job that reached a mount-index
 * repository first found "Mount index database not initialized" and marked
 * live chunks FAILED.
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

import { initializeChildRuntime } from '@/lib/background-jobs/child/child-startup'
import {
  resetPluginReadinessForTests,
  startPluginInitialization,
  whenPluginsReady,
} from '@/lib/background-jobs/child/plugin-readiness'

describe('initializeChildRuntime', () => {
  beforeEach(() => resetPluginReadinessForTests())

  it('connects the database before loading plugins', async () => {
    const order: string[] = []
    await initializeChildRuntime({
      initDatabase: async () => {
        await Promise.resolve()
        order.push('database')
      },
      initPlugins: async () => {
        order.push('plugins')
      },
    })
    expect(order).toEqual(['database', 'plugins'])
  })

  it('still loads plugins when the database connect fails, and never rejects', async () => {
    const initPlugins = jest.fn().mockResolvedValue(undefined)
    await expect(
      initializeChildRuntime({
        initDatabase: () => Promise.reject(new Error('locked')),
        initPlugins,
      }),
    ).resolves.toBeUndefined()
    expect(initPlugins).toHaveBeenCalledTimes(1)
  })

  it('swallows a plugin-load failure', async () => {
    await expect(
      initializeChildRuntime({
        initDatabase: async () => undefined,
        initPlugins: () => Promise.reject(new Error('boom')),
      }),
    ).resolves.toBeUndefined()
  })

  it('holds a job until the database is connected', async () => {
    let connect!: () => void
    let connected = false
    startPluginInitialization(() =>
      initializeChildRuntime({
        initDatabase: () =>
          new Promise<void>((resolve) => {
            connect = () => {
              connected = true
              resolve()
            }
          }),
        initPlugins: async () => undefined,
      }),
    )

    let ran = false
    const job = whenPluginsReady(5_000).then(() => {
      ran = true
      return connected
    })
    await Promise.resolve()
    expect(ran).toBe(false)

    connect()
    await expect(job).resolves.toBe(true)
  })
})
