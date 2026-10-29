/** @jest-environment node */
/**
 * Text-block create calls for wardrobe and inventory: the block's body is the
 * item's description, and the picture field arrives under its own name
 * (`cue` → `image_prompt`, `looks` → `image_description`).
 */
import {
  convertTextBlockToToolCallRequest,
  parseTextBlockCalls,
} from '@/lib/tools/legacy/text-block-parser'

function convertOne(text: string) {
  const [call] = parseTextBlockCalls(text)
  return convertTextBlockToToolCallRequest(call)
}

describe('text-block create calls', () => {
  it('maps a wardrobe body to description and cue to image_prompt', () => {
    const req = convertOne(
      '[[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories" cue="long crimson wool scarf, golden tassels"]]' +
      'A soft crimson scarf[[/CREATE_WARDROBE_ITEM]]'
    )
    expect(req.name).toBe('wardrobe_create')
    expect(req.arguments).toMatchObject({
      title: 'Red Scarf',
      image_prompt: 'long crimson wool scarf, golden tassels',
      description: 'A soft crimson scarf',
    })
    expect(req.arguments).not.toHaveProperty('content')
  })

  it('maps an inventory body to description and looks to image_description', () => {
    const req = convertOne(
      '[[CREATE_INVENTORY_ITEM name="compass" looks="dented brass pocket compass"]]A compass[[/CREATE_INVENTORY_ITEM]]'
    )
    expect(req.name).toBe('inventory_create')
    expect(req.arguments).toMatchObject({
      name: 'compass',
      image_description: 'dented brass pocket compass',
      description: 'A compass',
    })
  })
})
