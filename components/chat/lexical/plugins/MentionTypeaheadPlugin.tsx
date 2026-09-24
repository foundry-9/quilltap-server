'use client'

/**
 * MentionTypeaheadPlugin
 *
 * Type `@` at the start of a word and a list of characters opens beneath the
 * cursor, narrowing as you type. Enter, Tab or a click takes the highlighted
 * name (the first, unless you have arrowed elsewhere); Space does the same once
 * at least one letter follows the `@`, and keeps its space. A bare `@` followed
 * by a space is left alone — `meet me @ 5` is not a summons.
 *
 * What lands is the character's plain name. The `@` goes, with one exception:
 * at the start of a line, where `@Name: question` / `@Name? question` is a
 * Carina query. There the `@` stays provisionally and the next keystrokes
 * decide — a `:` or `?` followed by a space keeps it, anything else drops it.
 * The rule lives in `classifyLineStartMention` (`lib/mentions/`); this file is
 * the adapter.
 *
 * Menu surface and keyboard handling are the shared typeahead shell's; Enter
 * runs at COMMAND_PRIORITY_CRITICAL for the same reason as CharTypeaheadPlugin
 * (KeyboardPlugin's HIGH-priority Enter would otherwise send the draft).
 *
 * @module components/chat/lexical/plugins/MentionTypeaheadPlugin
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { MenuRenderFn, MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $getNodeByKey,
  $getSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  HISTORY_MERGE_TAG,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
  type TextNode,
} from 'lexical'

import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import {
  canKeepLineStartAt,
  classifyLineStartMention,
  findMentionTrigger,
  rankMentionCandidates,
  type MentionCandidate,
} from '@/lib/mentions/mention-typeahead'
import {
  TypeaheadOption,
  useTypeaheadShell,
  toMenuTextMatch,
  $insertTypeaheadText,
} from '../typeahead/useTypeaheadShell'
import { $textBeforeCursor, $isGluedToPreviousRun } from '../typeahead/trigger-context'

/** Rows visible at once; the menu scrolls with the keyboard beyond this. */
const MENU_LIMIT = 10

const LISTBOX_ID = 'qt-mention-typeahead-listbox'
const EMPTY_LABEL = 'No such personage in the register'

interface CharactersResponse {
  characters?: MentionCandidate[]
}

/** A line-start `@Name` whose `@` is still awaiting its verdict. */
interface PendingLineStart {
  paragraphKey: string
  /** Which `\n`-separated line of the paragraph (soft line breaks count). */
  lineIndex: number
  name: string
}

/**
 * The paragraph and line a node starts, when it starts a line of a top-level
 * paragraph — the only place a Carina query can live. Lists, quotes, headings
 * and table cells all put markdown before the `@`, so they never qualify.
 */
function $lineStartOf(node: LexicalNode): { paragraph: ParagraphNode; lineIndex: number } | null {
  const parent = node.getParent()
  if (!$isParagraphNode(parent) || !$isRootNode(parent.getParent())) return null

  const previous = node.getPreviousSibling()
  if (previous !== null && !$isLineBreakNode(previous)) return null

  let lineIndex = 0
  for (let sibling = previous; sibling !== null; sibling = sibling.getPreviousSibling()) {
    if ($isLineBreakNode(sibling)) lineIndex += 1
  }
  return { paragraph: parent, lineIndex }
}

/** The first node of line `lineIndex` in `paragraph`, or null if the line is empty. */
function $firstNodeOfLine(paragraph: ParagraphNode, lineIndex: number): LexicalNode | null {
  let line = 0
  let atLineStart = lineIndex === 0
  for (const child of paragraph.getChildren()) {
    if (atLineStart) return $isLineBreakNode(child) ? null : child
    if ($isLineBreakNode(child)) {
      line += 1
      atLineStart = line === lineIndex
    }
  }
  return null
}

/** Remove the first character of `node`, keeping a caret inside it in place. */
function $dropLeadingCharacter(node: TextNode): void {
  const selection = $getSelection()
  const key = node.getKey()
  const shift = (point: { key: string; offset: number }) =>
    point.key === key && point.offset > 0 ? point.offset - 1 : null

  const anchorOffset = $isRangeSelection(selection) ? shift(selection.anchor) : null
  const focusOffset = $isRangeSelection(selection) ? shift(selection.focus) : null

  node.spliceText(0, 1, '')

  if ($isRangeSelection(selection)) {
    if (anchorOffset !== null) selection.anchor.set(key, anchorOffset, 'text')
    if (focusOffset !== null) selection.focus.set(key, focusOffset, 'text')
  }
}

interface SpaceCommitBindingProps {
  editor: LexicalEditor
  onSpace: () => boolean
}

/**
 * Registers the Space commit for as long as the menu is on screen. Living inside
 * the menu's render output ties the handler's lifetime to the menu's, and hands
 * it the menu's own highlighted index rather than a guess at it.
 */
function SpaceCommitBinding({ editor, onSpace }: SpaceCommitBindingProps): null {
  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent | null) => {
          if (event === null || event.key !== ' ') return false
          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
          if (editor.isComposing()) return false
          if (!onSpace()) return false
          event.preventDefault()
          return true
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    [editor, onSpace],
  )
  return null
}

export interface MentionTypeaheadPluginProps {
  /** Characters to list first — normally the current chat's cast. */
  priorityCharacterIds?: readonly string[]
}

export function MentionTypeaheadPlugin({
  priorityCharacterIds,
}: Readonly<MentionTypeaheadPluginProps>): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)

  // Same key and URL as the spellcheck dictionary feed, so the list is shared.
  // The endpoint already leaves archived characters out.
  const { data } = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<CharactersResponse>('/api/v1/characters', { signal }),
    enabled: query !== null,
  })

  const priorityKey = priorityCharacterIds?.join('|') ?? ''
  const prioritySet = useMemo(
    () => new Set(priorityKey ? priorityKey.split('|') : []),
    [priorityKey],
  )

  /** Set by the Space binding; read and cleared by the select it triggers. */
  const committingWithSpaceRef = useRef(false)
  /** The line-start `@Name` awaiting a keep-or-strip verdict, if any. */
  const pendingRef = useRef<PendingLineStart | null>(null)

  useEffect(() => editor.registerRootListener((next) => setRootElement(next)), [editor])

  const options = useMemo(() => {
    if (query === null || !data?.characters) return []
    return rankMentionCandidates(data.characters, query, prioritySet, MENU_LIMIT).map(
      (character) =>
        new TypeaheadOption<MentionCandidate>(
          {
            key: character.id,
            glyph: '@',
            label: character.name,
            detail: prioritySet.has(character.id) ? 'in this chat' : character.title || undefined,
          },
          character,
        ),
    )
  }, [data, query, prioritySet])

  const triggerFn = useCallback(
    (text: string, activeEditor: LexicalEditor): MenuTextMatch | null => {
      if (activeEditor.isComposing()) return null

      const match = findMentionTrigger(text)
      if (!match) return null

      const current = $textBeforeCursor()
      if (!current) return null
      if ($isGluedToPreviousRun(current.node, match.start)) return null

      // A just-completed line-start `@Name` is still a valid trigger; reopening
      // the menu on it would make the next Enter re-pick instead of send.
      const pending = pendingRef.current
      if (pending && match.start === 0 && match.query === pending.name) return null

      return toMenuTextMatch(text, match)
    },
    [],
  )

  const onSelectOption = useCallback(
    (
      option: TypeaheadOption<MentionCandidate>,
      nodeToReplace: TextNode | null,
      closeMenu: () => void,
    ) => {
      const name = option.payload.name
      const withSpace = committingWithSpaceRef.current
      committingWithSpaceRef.current = false

      editor.update(() => {
        if (!nodeToReplace) return
        const lineStart = $lineStartOf(nodeToReplace)

        // `@Name ` can never become a Carina query, so a Space commit drops the
        // `@` even at the start of a line — as does a name the Carina parser
        // cannot address (`Jean-Luc`, `Zoë`).
        if (lineStart && !withSpace && canKeepLineStartAt(name)) {
          $insertTypeaheadText(nodeToReplace, `@${name}`, { trailingSpace: false })
          pendingRef.current = {
            paragraphKey: lineStart.paragraph.getKey(),
            lineIndex: lineStart.lineIndex,
            name,
          }
        } else {
          $insertTypeaheadText(nodeToReplace, name, { trailingSpace: withSpace })
        }
      })
      closeMenu()
    },
    [editor],
  )

  /**
   * Judge the pending line-start `@` after every change. `strip` removes it in
   * an update merged into the keystroke's own history entry, so one undo takes
   * back the keystroke and the removal together.
   */
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        const pending = pendingRef.current
        if (!pending || tags.has(HISTORY_MERGE_TAG) || editor.isComposing()) return

        const verdict = editorState.read(() => {
          const paragraph = $getNodeByKey(pending.paragraphKey)
          if (!$isParagraphNode(paragraph)) return 'abandon'
          const line = paragraph.getTextContent().split('\n')[pending.lineIndex] ?? ''
          return classifyLineStartMention(line, pending.name)
        })

        if (verdict === 'pending') return
        pendingRef.current = null
        if (verdict !== 'strip') return

        editor.update(
          () => {
            const paragraph = $getNodeByKey(pending.paragraphKey)
            if (!$isParagraphNode(paragraph)) return
            const first = $firstNodeOfLine(paragraph, pending.lineIndex)
            if ($isTextNode(first) && first.getTextContent().startsWith('@')) {
              $dropLeadingCharacter(first)
            }
          },
          { tag: HISTORY_MERGE_TAG },
        )
      }),
    [editor],
  )

  const shellRenderFn = useTypeaheadShell<MentionCandidate>({
    listboxId: LISTBOX_ID,
    emptyLabel: EMPTY_LABEL,
    activeDescendantTarget: rootElement,
  })

  const menuRenderFn = useCallback<MenuRenderFn<TypeaheadOption<MentionCandidate>>>(
    (anchorElementRef, itemProps, matchingString) => {
      const onSpace = (): boolean => {
        // A bare `@` then Space is punctuation, not a request.
        if (matchingString.length === 0) return false
        const option = itemProps.options[itemProps.selectedIndex ?? 0]
        if (!option) return false

        // Consumed by onSelectOption. Not reset here: we are inside a command
        // listener, so Lexical defers the select's update until this returns.
        committingWithSpaceRef.current = true
        itemProps.selectOptionAndCleanUp(option)
        return true
      }

      return (
        <>
          <SpaceCommitBinding editor={editor} onSpace={onSpace} />
          {shellRenderFn(anchorElementRef, itemProps, matchingString)}
        </>
      )
    },
    [editor, shellRenderFn],
  )

  return (
    <LexicalTypeaheadMenuPlugin<TypeaheadOption<MentionCandidate>>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
      commandPriority={COMMAND_PRIORITY_CRITICAL}
    />
  )
}

export default MentionTypeaheadPlugin
