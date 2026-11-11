/**
 * The per-chat tool picker reads `lib/tools/tool-picker.ts`: each built-in's
 * display metadata, definition and availability rules sit in one entry.
 */

import { BUILT_IN_TOOL_PICKER, toolAvailability, type ListedToolPickerEntry, type ToolAvailabilityContext } from '../tool-picker'

const everything: ToolAvailabilityContext = {
  hasImageProfile: true,
  hasProject: true,
  hasDocumentStores: true,
  allowsWebSearch: true,
  webSearchConfigured: true,
  isMultiCharacter: true,
  canDressThemselves: true,
  canCreateOutfits: true,
  canManageInventory: true,
}

const listed = (id: string) => BUILT_IN_TOOL_PICKER[id] as ListedToolPickerEntry

describe('tool picker availability', () => {
  it('every listed tool is available when the chat has everything', () => {
    for (const entry of Object.values(BUILT_IN_TOOL_PICKER)) {
      if (entry.listed) expect(toolAvailability(entry, everything)).toEqual({ available: true })
    }
  })

  it('doc_copy_file needs a project with stores, like its siblings', () => {
    expect(toolAvailability(listed('doc_copy_file'), { ...everything, hasProject: false })).toEqual({
      available: false,
      unavailableReason: 'Chat must be associated with a project',
    })
    expect(toolAvailability(listed('doc_copy_file'), { ...everything, hasDocumentStores: false }).available).toBe(false)
  })

  it('web search names the first missing piece', () => {
    expect(toolAvailability(listed('search_web'), { ...everything, allowsWebSearch: false })).toMatchObject({
      unavailableReason: 'Web search must be enabled in the connection profile',
    })
    expect(toolAvailability(listed('search_web'), { ...everything, webSearchConfigured: false })).toMatchObject({
      unavailableReason: expect.stringContaining('No search provider configured'),
    })
  })

  it('character capability flags gate their tools', () => {
    expect(toolAvailability(listed('wardrobe_wear'), { ...everything, canDressThemselves: false }).available).toBe(false)
    expect(toolAvailability(listed('wardrobe_create'), { ...everything, canCreateOutfits: false }).available).toBe(false)
    expect(toolAvailability(listed('inventory_give'), { ...everything, canManageInventory: false }).available).toBe(false)
  })

  it('serves a schema for tools the old hand map missed', () => {
    expect(listed('keep_image').definition.function.parameters).toBeDefined()
  })
})
