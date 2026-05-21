import { describe, expect, it } from '@jest/globals'

import {
  buildTextBlockSystemInstructions,
  checkShouldUseTextBlockTools,
  determineTextBlockToolOptions,
  parseTextBlocksFromResponse,
} from '@/lib/services/chat-message/pseudo-tool.service'

describe('pseudo-tool.service', () => {
  it('uses a pseudo-tool surface whenever native isn\'t the resolved mode', () => {
    // 'auto' on a native model → native → no pseudo-tool surface.
    expect(checkShouldUseTextBlockTools(true)).toBe(false)
    // 'auto' on a non-native model → simple-json (post-flip default) →
    // continuationTools must still be suppressed, so the boolean is true.
    expect(checkShouldUseTextBlockTools(false)).toBe(true)
    // Explicit text-block override on a native model still chooses the
    // pseudo-tool surface.
    expect(checkShouldUseTextBlockTools(true, 'text-block')).toBe(true)
    // Forcing 'native' on a non-native model now falls back to simple-json
    // (a pseudo-tool surface), so the boolean is true. Previously this
    // returned false; the new behaviour is graceful degradation rather than
    // shipping a broken native request.
    expect(checkShouldUseTextBlockTools(false, 'native')).toBe(true)
    // Forcing 'native' on a native model continues to choose native.
    expect(checkShouldUseTextBlockTools(true, 'native')).toBe(false)
    // Explicit 'simple-json' override always chooses the pseudo-tool surface.
    expect(checkShouldUseTextBlockTools(true, 'simple-json')).toBe(true)
    expect(checkShouldUseTextBlockTools(false, 'simple-json')).toBe(true)
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
      search: true,
      imageGeneration: false,
      webSearch: false,
      state: true,
      rng: true,
      projectInfo: false,
      helpSearch: false,
      helpSettings: false,
      helpNavigate: false,
      createNote: true,
      wardrobeList: true,
      wardrobeUpdateOutfit: true,
      wardrobeChangeItem: true,
      wardrobeCreateItem: true,
    })

    expect(instructions).toContain('[[WARDROBE /]]')
    expect(instructions).toContain('[[CHANGE_ITEM mode="equip"')
    expect(instructions).toContain('[[SET_OUTFIT mode="wear"')
    expect(instructions).toContain('[[CREATE_WARDROBE_ITEM title="Red Scarf"')
    expect(instructions).not.toContain('[[SEARCH_WEB]]')
  })

  it('parses wardrobe text-block markers into executable tool calls', () => {
    const response = [
      'First I will check my options.',
      '[[WARDROBE /]]',
      'Then I will change clothes.',
      '[[CHANGE_ITEM mode="equip" title="Charcoal Sweater" /]]',
      'And put on the formal outfit.',
      '[[SET_OUTFIT mode="wear" title="Black Tie Ensemble" /]]',
      '[[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories"]]A soft crimson scarf with golden tassels[[/CREATE_WARDROBE_ITEM]]',
    ].join('\n')

    expect(parseTextBlocksFromResponse(response)).toEqual([
      {
        name: 'list_wardrobe',
        arguments: {},
      },
      {
        name: 'wardrobe_change_item',
        arguments: {
          mode: 'equip',
          item_title: 'Charcoal Sweater',
        },
      },
      {
        name: 'wardrobe_set_outfit',
        arguments: {
          mode: 'wear',
          item_title: 'Black Tie Ensemble',
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
