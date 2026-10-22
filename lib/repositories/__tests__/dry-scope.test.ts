/**
 * Dry scope — writes are discarded, reads pass through bound to the real
 * repository, the LLM log still lands, and nothing changes outside a scope.
 */

import { dryRepositories, dryScopeDiscardedWrites, isInDryScope, runDry } from '../dry-scope'
import type { RepositoryContainer } from '../factory'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() },
}))

class FakeRepo {
  rows = new Map<string, { id: string; v: number }>([['a', { id: 'a', v: 1 }]])
  writes = 0
  private async safeQuery<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }
  async findById(id: string) {
    return this.safeQuery(async () => this.rows.get(id) ?? null)
  }
  async update(id: string, patch: { v: number }) {
    this.writes++
    const row = { id, ...patch }
    this.rows.set(id, row)
    return row
  }
  async create(data: { v: number }) {
    this.writes++
    return { id: 'new', ...data }
  }
  async addMessage(_chatId: string, message: { id: string; content: string }) {
    this.writes++
    return message
  }
}

function container() {
  const real = { chats: new FakeRepo(), llmLogs: new FakeRepo() }
  return { real, dry: dryRepositories(real as unknown as RepositoryContainer) as unknown as typeof real }
}

describe('dry scope', () => {
  it('discards writes inside the scope and counts them', async () => {
    const { real, dry } = container()
    await runDry('test', async () => {
      expect(isInDryScope()).toBe(true)
      const updated = await dry.chats.update('a', { v: 2 })
      expect(updated).toBeUndefined()
      const created = await dry.chats.create({ v: 3 })
      expect(created).toMatchObject({ id: expect.any(String), v: 3 })
      const added = await dry.chats.addMessage('chat', { id: 'm1', content: 'hello' })
      expect(added).toEqual({ id: 'm1', content: 'hello' })
      expect(Object.fromEntries(dryScopeDiscardedWrites())).toEqual({ 'chats.update': 1, 'chats.create': 1, 'chats.addMessage': 1 })
    })
    expect(real.chats.writes).toBe(0)
    expect(real.chats.rows.get('a')?.v).toBe(1)
  })

  it('passes reads through, bound to the real repository (its private helpers included)', async () => {
    const { dry } = container()
    await runDry('test', async () => {
      expect(await dry.chats.findById('a')).toEqual({ id: 'a', v: 1 })
    })
  })

  it('lets the LLM log land', async () => {
    const { real, dry } = container()
    await runDry('test', async () => {
      await dry.llmLogs.create({ v: 9 })
    })
    expect(real.llmLogs.writes).toBe(1)
  })

  it('is transparent outside a scope', async () => {
    const { real, dry } = container()
    expect(isInDryScope()).toBe(false)
    await dry.chats.update('a', { v: 5 })
    expect(real.chats.rows.get('a')?.v).toBe(5)
  })
})
