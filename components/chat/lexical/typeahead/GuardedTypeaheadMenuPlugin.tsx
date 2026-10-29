'use client'

/**
 * `LexicalTypeaheadMenuPlugin`, guarded against a menu orphaned by a deferred open.
 *
 * The plugin opens its menu inside `startTransition`, so the open commits after
 * the editor update that asked for it. When a second update removes the trigger
 * before that commit (an undo that brings `@Ri` back, then Cmd+A / Delete at
 * once), the second update runs the listener whose `closeTypeahead` still sees
 * `resolution === null` and — in Lexical 0.52 — returns without closing. The
 * deferred open then commits a resolution whose trigger is gone, and the menu
 * sits at the window's top-left until the next keystroke (bug 250).
 *
 * The guard re-checks after every open commits: it runs the consumer's own
 * `triggerFn` against the text before the caret, exactly as the plugin would on
 * its next update, and when nothing matches it remounts the plugin, which drops
 * the stale resolution. A menu whose trigger still holds is left alone.
 *
 * Every composer typeahead (mentions, emoji/Unicode, slash commands) renders
 * through this wrapper rather than the plugin directly.
 *
 * @module components/chat/lexical/typeahead/GuardedTypeaheadMenuPlugin
 */

import { useCallback, useEffect, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type {
  MenuOption,
  MenuResolution,
  TypeaheadMenuPluginProps,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $getSelection, $isRangeSelection, $isTextNode, type LexicalEditor } from 'lexical'

/** Whether the trigger still matches the latest editor state, read the way the plugin reads it. */
function triggerStillHolds(
  editor: LexicalEditor,
  triggerFn: TypeaheadMenuPluginProps<MenuOption>['triggerFn'],
): boolean {
  return editor.read('latest', () => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
    const anchor = selection.anchor
    if (anchor.type !== 'text') return false
    const node = anchor.getNode()
    if (!$isTextNode(node) || !node.isSimpleText()) return false
    return triggerFn(node.getTextContent().slice(0, anchor.offset), editor) !== null
  })
}

export function GuardedTypeaheadMenuPlugin<TOption extends MenuOption>(
  props: TypeaheadMenuPluginProps<TOption>,
) {
  const [editor] = useLexicalComposerContext()
  const { triggerFn, onOpen, onClose } = props
  // Bumped by every open; set inside the plugin's transition, so it commits with the menu.
  const [openCount, setOpenCount] = useState(0)
  // The plugin's key: bumping it remounts the plugin and discards a stale resolution.
  const [generation, setGeneration] = useState(0)

  const handleOpen = useCallback(
    (resolution: MenuResolution) => {
      setOpenCount((n) => n + 1)
      onOpen?.(resolution)
    },
    [onOpen],
  )

  useEffect(() => {
    if (openCount === 0 || editor.isComposing()) return
    if (triggerStillHolds(editor, triggerFn)) return
    console.debug('[Typeahead] Closing a menu whose trigger vanished before it opened')
    void onClose?.()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the check must read the editor after the open commits; remounting is the only close the plugin's stale callback cannot skip
    setGeneration((g) => g + 1)
  }, [openCount, editor, triggerFn, onClose])

  return <LexicalTypeaheadMenuPlugin<TOption> key={generation} {...props} onOpen={handleOpen} />
}

export default GuardedTypeaheadMenuPlugin
