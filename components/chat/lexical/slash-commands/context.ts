/**
 * What the composer hands the `/` command menu: the handlers its commands run.
 *
 * The decisions (which commands exist, how they rank) live in
 * `lib/slash-commands/`; this is the composer's side of the contract — the
 * gutter's own handlers, the two shared tool dialogs, and the immediate-run
 * path for tools with nothing to complete.
 *
 * @module components/chat/lexical/slash-commands/context
 */

import type { ComposerAction } from '@/lib/slash-commands'
import { requestRngPendingResult, type RngPendingResult, type RngRequestArgs } from '@/components/chat/rng-request'
import { showErrorToast } from '@/lib/toast'

/** A custom tool as the slash menu names it to the dialog or the run route. */
export interface SlashCustomToolRef {
  name: string
  asCharacterId: string | null
}

export interface SlashCommandContext {
  chatId: string
  /**
   * What the composer wired. `tool`, `pascal` and `roll` are derived from the
   * dialog openers below and need not appear here.
   */
  actions: Partial<Record<ComposerAction, () => void>>
  /** Open Run Tool — on a tool's form when given an id. */
  openRunTool: (toolId?: string) => void
  /** Open Pascal's table — on a tool's form when given one. */
  openCustomTool: (initial?: SlashCustomToolRef) => void
  /** Run a built-in tool that declares no parameters, at once. */
  runBuiltInNow: (toolId: string) => Promise<void>
  /** Run a custom tool that declares no parameters, at once. */
  runCustomNow: (tool: SlashCustomToolRef) => Promise<void>
  /** Whether the chat resolves a Pascal roster (`/pascal` is listed only then). */
  customToolsAvailable: boolean
}

const QUICK_ROLLS: Record<'d6' | 'd20' | 'coin' | 'bottle', RngRequestArgs> = {
  d6: { type: 6, rolls: 1 },
  d20: { type: 20, rolls: 1 },
  coin: { type: 'flip_coin', rolls: 1 },
  bottle: { type: 'spin_the_bottle', rolls: 1 },
}

/**
 * `/d6`, `/d20`, `/coin`, `/bottle`: the dice button's own preview request,
 * landing as the same pending-result chip.
 */
export function buildQuickRollActions(
  chatId: string,
  onPendingResult: (result: RngPendingResult) => void,
): Partial<Record<ComposerAction, () => void>> {
  const actions: Partial<Record<ComposerAction, () => void>> = {}
  for (const [action, args] of Object.entries(QUICK_ROLLS) as Array<[keyof typeof QUICK_ROLLS, RngRequestArgs]>) {
    actions[action] = () => {
      requestRngPendingResult(chatId, args)
        .then(onPendingResult)
        .catch((err: unknown) => {
          showErrorToast(err instanceof Error ? err.message : 'The dice would not roll')
        })
    }
  }
  return actions
}
