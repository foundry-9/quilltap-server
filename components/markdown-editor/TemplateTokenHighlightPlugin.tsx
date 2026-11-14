'use client'

/**
 * Tints `{{char}}` / `{{user}}` template tokens — and the character's and
 * partner's names, which the page's template tools can turn into them — inside
 * a Lexical editor, without touching the editor's document.
 *
 * It paints with the CSS Custom Highlight API: after every editor update it
 * walks the editable root's text nodes, builds DOM `Range`s over the matches
 * and hands them to two named highlights (`qt-template-char`,
 * `qt-template-user`, styled in `app/globals.css`). No Lexical node is created
 * or transformed, so the Markdown bridge, history and autosave see exactly the
 * text the user typed. The highlight registry is document-wide, so every
 * mounted editor contributes its own ranges to a shared pool and removes them
 * on unmount. Where the API is absent the plugin does nothing.
 *
 * @module components/markdown-editor/TemplateTokenHighlightPlugin
 */

import { useEffect, useId } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

type Kind = 'char' | 'user'

const HIGHLIGHT_NAMES: Record<Kind, string> = {
  char: 'qt-template-char',
  user: 'qt-template-user',
}

/** Ranges contributed by each mounted editor, keyed by its instance id. */
const pool = new Map<string, Record<Kind, Range[]>>()

interface HighlightRegistry {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

function registry(): { highlights: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  if (typeof window === 'undefined') return null
  const css = (window as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
  const Highlight = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!css?.highlights || !Highlight) return null
  return { highlights: css.highlights, Highlight }
}

function repaint(): void {
  const reg = registry()
  if (!reg) return
  for (const kind of ['char', 'user'] as const) {
    const ranges = [...pool.values()].flatMap((entry) => entry[kind])
    if (ranges.length === 0) reg.highlights.delete(HIGHLIGHT_NAMES[kind])
    else reg.highlights.set(HIGHLIGHT_NAMES[kind], new reg.Highlight(...ranges))
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the matcher once per name pair: tokens always, names when given. */
function buildMatcher(characterName?: string | null, userName?: string | null): {
  regex: RegExp
  kindOf: (match: string) => Kind
} {
  const parts = ['\\{\\{char\\}\\}', '\\{\\{user\\}\\}']
  const charName = characterName?.trim()
  const partnerName = userName?.trim()
  if (charName) parts.push(escapeRegex(charName))
  if (partnerName && partnerName.toLowerCase() !== charName?.toLowerCase()) parts.push(escapeRegex(partnerName))
  const regex = new RegExp(parts.join('|'), 'gi')
  return {
    regex,
    kindOf: (match) => {
      const lower = match.toLowerCase()
      if (lower === '{{char}}') return 'char'
      if (lower === '{{user}}') return 'user'
      return charName && lower === charName.toLowerCase() ? 'char' : 'user'
    },
  }
}

export interface TemplateTokenHighlightPluginProps {
  /** The character's own name — a candidate for `{{char}}`. */
  characterName?: string | null
  /** The default partner's name — a candidate for `{{user}}`. */
  userName?: string | null
}

export function TemplateTokenHighlightPlugin({ characterName, userName }: TemplateTokenHighlightPluginProps) {
  const [editor] = useLexicalComposerContext()
  const instanceId = useId()

  useEffect(() => {
    if (!registry()) return
    const { regex, kindOf } = buildMatcher(characterName, userName)
    let frame: number | null = null

    const scan = () => {
      frame = null
      const root = editor.getRootElement()
      const found: Record<Kind, Range[]> = { char: [], user: [] }
      if (root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? ''
          regex.lastIndex = 0
          for (let m = regex.exec(text); m; m = regex.exec(text)) {
            const range = document.createRange()
            range.setStart(node, m.index)
            range.setEnd(node, m.index + m[0].length)
            found[kindOf(m[0])].push(range)
          }
        }
      }
      pool.set(instanceId, found)
      repaint()
    }

    const schedule = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(scan)
    }

    schedule()
    const unregister = editor.registerUpdateListener(schedule)
    return () => {
      unregister()
      if (frame !== null) window.cancelAnimationFrame(frame)
      pool.delete(instanceId)
      repaint()
    }
  }, [editor, instanceId, characterName, userName])

  return null
}
