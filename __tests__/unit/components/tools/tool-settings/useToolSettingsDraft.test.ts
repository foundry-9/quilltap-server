/**
 * The tool-settings draft shared by the chat and project dialogs, and the
 * group-id collector the content panel expands from.
 */

import { renderHook, act } from '@testing-library/react'
import { useToolSettingsDraft } from '@/components/tools/tool-settings/useToolSettingsDraft'
import { collectGroupIds, makeSubgroupPattern } from '@/components/tools/tool-settings/utils'
import type { ToolGroup } from '@/components/tools/tool-settings/types'

describe('useToolSettingsDraft', () => {
  it('starts from the stored lists and is clean', () => {
    const { result } = renderHook(() => useToolSettingsDraft(['b', 'a'], ['g']))
    expect([...result.current.disabledTools]).toEqual(['a', 'b'])
    expect([...result.current.disabledGroups]).toEqual(['g'])
    expect(result.current.dirty).toBe(false)
  })

  it('is dirty after a toggle and clean again after reset', () => {
    const { result } = renderHook(() => useToolSettingsDraft(['a'], []))
    act(() => result.current.setDisabledTools(new Set(['a', 'c'])))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.reset())
    expect([...result.current.disabledTools]).toEqual(['a'])
    expect(result.current.dirty).toBe(false)
  })

  it('treats a reordered toggle back to the stored set as clean', () => {
    const { result } = renderHook(() => useToolSettingsDraft(['a', 'b'], []))
    act(() => result.current.setDisabledTools(new Set(['b', 'a'])))
    expect(result.current.dirty).toBe(false)
  })

  it('keeps unsaved toggles when new arrays with the same values arrive', () => {
    const { result, rerender } = renderHook(
      ({ tools }: { tools: string[] }) => useToolSettingsDraft(tools, []),
      { initialProps: { tools: ['a'] } },
    )
    act(() => result.current.setDisabledGroups(new Set(['g'])))
    rerender({ tools: ['a'] })
    expect([...result.current.disabledGroups]).toEqual(['g'])
    expect(result.current.dirty).toBe(true)
  })
})

describe('collectGroupIds', () => {
  it('collects every group id and subgroup pattern', () => {
    const hierarchy: ToolGroup[] = [
      { id: 'built-in', displayName: 'Built-in', type: 'built-in', subgroups: [], tools: [] },
      {
        id: 'plugin:mcp',
        displayName: 'MCP',
        type: 'plugin',
        pluginName: 'mcp',
        subgroups: [{ id: 'server', displayName: 'Server', pluginName: 'mcp', tools: [] }],
        tools: [],
      },
    ]
    const { groupIds, subgroupIds } = collectGroupIds(hierarchy)
    expect([...groupIds]).toEqual(['built-in', 'plugin:mcp'])
    expect([...subgroupIds]).toEqual([makeSubgroupPattern('mcp', 'server')])
  })
})
