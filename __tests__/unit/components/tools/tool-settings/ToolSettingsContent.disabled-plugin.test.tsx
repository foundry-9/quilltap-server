/**
 * Under a switched-off plugin group, the subgroup and tool checkboxes are
 * disabled and their clicks change nothing (#323) — they used to look live
 * while silently rewriting the stored disable lists.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolSettingsContent } from '@/components/tools/tool-settings/ToolSettingsContent'
import type { AvailableTool } from '@/components/tools/tool-settings/types'

const TOOLS: AvailableTool[] = [
  {
    id: 'mcp_direct',
    name: 'Direct Tool',
    description: 'A tool directly in the plugin',
    source: 'plugin',
    pluginName: 'mcp',
  },
  {
    id: 'mcp_fs_read',
    name: 'Read File',
    description: 'A tool in a subgroup',
    source: 'plugin',
    pluginName: 'mcp',
    subgroupId: 'filesystem',
    subgroupDisplayName: 'Filesystem',
  },
]

function renderContent(disabledGroups: string[], disabledTools: string[] = []) {
  const onDisabledToolsChange = jest.fn()
  const onDisabledGroupsChange = jest.fn()
  render(
    <ToolSettingsContent
      availableTools={TOOLS}
      disabledTools={new Set(disabledTools)}
      disabledGroups={new Set(disabledGroups)}
      onDisabledToolsChange={onDisabledToolsChange}
      onDisabledGroupsChange={onDisabledGroupsChange}
    />,
  )
  return { onDisabledToolsChange, onDisabledGroupsChange }
}

describe('ToolSettingsContent with a disabled plugin group', () => {
  it('disables the tool and subgroup checkboxes and ignores clicks on them', () => {
    const { onDisabledToolsChange, onDisabledGroupsChange } = renderContent(['plugin:mcp'])

    const direct = screen.getByLabelText(/Direct Tool/) as HTMLInputElement
    const nested = screen.getByLabelText(/Read File/) as HTMLInputElement
    const subgroup = screen.getByRole('checkbox', { name: 'Toggle all Filesystem' })

    expect(direct).toBeDisabled()
    expect(nested).toBeDisabled()
    expect(subgroup).toBeDisabled()

    fireEvent.click(direct)
    fireEvent.click(nested)
    fireEvent.click(subgroup)

    expect(onDisabledToolsChange).not.toHaveBeenCalled()
    expect(onDisabledGroupsChange).not.toHaveBeenCalled()
  })

  it('keeps the plugin group checkbox itself usable', () => {
    const { onDisabledGroupsChange } = renderContent(['plugin:mcp'])

    const group = screen
      .getAllByRole('checkbox', { name: /^Toggle all / })
      .find(el => el.getAttribute('aria-label') !== 'Toggle all Filesystem')!
    expect(group).not.toBeDisabled()

    fireEvent.click(group)
    expect(onDisabledGroupsChange).toHaveBeenCalledWith(new Set())
  })

  it('disables tools under a switched-off subgroup but leaves the subgroup checkbox live', () => {
    const { onDisabledToolsChange, onDisabledGroupsChange } = renderContent(['plugin:mcp:subgroup:filesystem'])

    const nested = screen.getByLabelText(/Read File/) as HTMLInputElement
    const direct = screen.getByLabelText(/Direct Tool/) as HTMLInputElement
    const subgroup = screen.getByRole('checkbox', { name: 'Toggle all Filesystem' })

    expect(nested).toBeDisabled()
    expect(direct).not.toBeDisabled()
    expect(subgroup).not.toBeDisabled()

    fireEvent.click(subgroup)
    expect(onDisabledGroupsChange).toHaveBeenCalledWith(new Set())
    expect(onDisabledToolsChange).toHaveBeenCalled()
  })

  it('still toggles tools when nothing above them is off', () => {
    const { onDisabledToolsChange } = renderContent([])

    fireEvent.click(screen.getByLabelText(/Read File/))
    expect(onDisabledToolsChange).toHaveBeenCalledWith(new Set(['mcp_fs_read']))
  })
})
