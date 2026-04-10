import { describe, expect, it } from '@jest/globals'

import {
  buildTextBlockSystemInstructions,
  checkShouldUseTextBlockTools,
  determineTextBlockToolOptions,
  parseTextBlocksFromResponse,
} from '@/lib/services/chat-message/pseudo-tool.service'

describe('pseudo-tool.service', () => {
  it('prefers text-block tools only when native tools are unavailable or explicitly forced', () => {
    expect(checkShouldUseTextBlockTools(true)).toBe(false)
    expect(checkShouldUseTextBlockTools(false)).toBe(true)
    expect(checkShouldUseTextBlockTools(true, 'text-block')).toBe(true)
    expect(checkShouldUseTextBlockTools(false, 'native')).toBe(false)
  })

  it('enables wardrobe and help options based on chat capabilities', () => {
    const enabled = determineTextBlockToolOptions(
      'img-profile-1',
      true,
      true,
      false,
      true,
      undefined,
      false
    )

    expect(enabled).toMatchObject({
      imageGeneration: true,
      webSearch: true,
      whisper: true,
      fileManagement: false,
      projectInfo: false,
      helpSearch: true,
      helpSettings: true,
      helpNavigate: true,
      wardrobeList: true,
      wardrobeUpdateOutfit: true,
      wardrobeCreateItem: false,
    })
  })

  it('documents newly added wardrobe tools in text-block instructions', () => {
    const instructions = buildTextBlockSystemInstructions({
      whisper: false,
      memorySearch: true,
      imageGeneration: false,
      webSearch: false,
      state: true,
      rng: true,
      fileManagement: false,
      projectInfo: false,
      helpSearch: false,
      helpSettings: false,
      helpNavigate: false,
      createNote: true,
      wardrobeList: true,
      wardrobeUpdateOutfit: true,
      wardrobeCreateItem: true,
    })

    expect(instructions).toContain('[[WARDROBE /]]')
    expect(instructions).toContain('[[EQUIP slot="top"')
    expect(instructions).toContain('[[CREATE_WARDROBE_ITEM title="Red Scarf"')
    expect(instructions).not.toContain('[[SEARCH_WEB]]')
  })

  it('parses wardrobe text-block markers into executable tool calls', () => {
    const response = [
      'First I will check my options.',
      '[[WARDROBE /]]',
      'Then I will change clothes.',
      '[[EQUIP slot="top" title="Charcoal Sweater" /]]',
      '[[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories"]]A soft crimson scarf with golden tassels[[/CREATE_WARDROBE_ITEM]]',
    ].join('\n')

    expect(parseTextBlocksFromResponse(response)).toEqual([
      {
        name: 'list_wardrobe',
        arguments: {},
      },
      {
        name: 'update_outfit_item',
        arguments: {
          slot: 'top',
          item_title: 'Charcoal Sweater',
        },
      },
      {
        name: 'create_wardrobe_item',
        arguments: {
          title: 'Red Scarf',
          types: 'accessories',
          content: 'A soft crimson scarf with golden tassels',
        },
      },
    ])
  })
})
