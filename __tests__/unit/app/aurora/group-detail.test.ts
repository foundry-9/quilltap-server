/**
 * The group page: a refetch never overwrites an edited form (#170), a save
 * refreshes the Aurora group list on the same client, and a member change
 * re-reads the members.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { queryKeys } from '@/lib/query/keys'
import { useGroupDetail } from '@/app/aurora/groups/hooks/useGroupDetail'
import { useGroupMembers } from '@/app/aurora/groups/hooks/useGroupMembers'
import { useGroups } from '@/app/aurora/hooks/useGroups'

jest.mock('@/lib/toast', () => ({ showSuccessToast: jest.fn(), showErrorToast: jest.fn() }))

let group: Record<string, unknown>
let memberIds: string[]
const puts: Array<Record<string, unknown>> = []
const characters = [
  { id: 'c1', name: 'Bertie' },
  { id: 'c2', name: 'Jeeves' },
]

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

describe('group page', () => {
  beforeEach(() => {
    puts.length = 0
    group = { id: 'g1', name: 'Drones Club', description: 'Idle', instructions: '', color: '', icon: '' }
    memberIds = ['c1']
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/v1/characters')) return json({ characters })
      if (url === '/api/v1/groups') return json({ groups: [{ ...group, _count: { members: memberIds.length } }] })
      if (url.includes('action=members')) {
        return json({ members: characters.filter((c) => memberIds.includes(c.id)) })
      }
      if (url.includes('action=addMember')) {
        memberIds = [...memberIds, JSON.parse(init!.body as string).characterId]
        return json({ success: true })
      }
      if (method === 'PUT') {
        const body = JSON.parse(init!.body as string)
        puts.push(body)
        group = { ...group, ...body }
      }
      return json({ group })
    })
  })

  it('keeps an edited form across a refetch, and a save refreshes the group list', async () => {
    const { wrapper, queryClient } = createQueryWrapper()
    const detail = renderHook(() => useGroupDetail('g1'), { wrapper })
    const list = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(detail.result.current.formData.name).toBe('Drones Club'))
    await waitFor(() => expect(list.result.current.groups[0]?.memberCount).toBe(1))

    act(() => { detail.result.current.setFormData((f) => ({ ...f, name: 'The Drones' })) })
    await act(async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.groups.all }) })
    expect(detail.result.current.formData.name).toBe('The Drones')

    await act(async () => { await detail.result.current.save() })
    expect(puts[0]).toMatchObject({ name: 'The Drones', description: 'Idle', instructions: null })
    await waitFor(() => expect(list.result.current.groups[0]?.name).toBe('The Drones'))
  })

  it('adding a member re-reads the members and the list count', async () => {
    const { wrapper } = createQueryWrapper()
    const members = renderHook(() => useGroupMembers('g1'), { wrapper })
    const list = renderHook(() => useGroups(), { wrapper })
    await waitFor(() => expect(members.result.current.members.map((m) => m.id)).toEqual(['c1']))
    await waitFor(() => expect(members.result.current.allCharacters).toHaveLength(2))

    let ok = false
    await act(async () => { ok = await members.result.current.addMember('c2') })
    expect(ok).toBe(true)
    await waitFor(() => expect(members.result.current.members.map((m) => m.id)).toEqual(['c1', 'c2']))
    await waitFor(() => expect(list.result.current.groups[0]?.memberCount).toBe(2))
  })
})
