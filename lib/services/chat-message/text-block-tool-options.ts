/**
 * Text-block tool options that are not derived from a chat's configuration.
 *
 * Kept apart from `pseudo-tool.service` so the surfaces that use it do not
 * pull the text-block parser in with it.
 *
 * @module lib/services/chat-message/text-block-tool-options
 */

import { inventoryToolFlags } from '@/lib/tools/inventory-tool-flags'
import type { TextBlockEnabledToolOptions } from './pseudo-tool.service'

/**
 * Text-block tool options for a surface with no character and no chat to act
 * on (the consoles, the one-shot research loops): everything is off but what
 * the caller names — store search, web search and the research kit.
 */
export function researchOnlyTextBlockToolOptions(reach: {
  search: boolean
  webSearch: boolean
  researchKit?: TextBlockEnabledToolOptions['researchKit']
}): TextBlockEnabledToolOptions {
  return {
    imageGeneration: false,
    search: reach.search,
    webSearch: reach.webSearch,
    whisper: false,
    state: false,
    rng: false,
    projectInfo: false,
    helpSearch: false,
    helpSettings: false,
    helpNavigate: false,
    createNote: false,
    wardrobeList: false,
    wardrobeRead: false,
    wardrobeWear: false,
    wardrobeTakeOff: false,
    wardrobeRollback: false,
    wardrobeHistory: false,
    wardrobeCreate: false,
    wardrobeUpdate: false,
    wardrobeArchive: false,
    ...inventoryToolFlags(false),
    ...(reach.researchKit !== undefined ? { researchKit: reach.researchKit } : {}),
  }
}
