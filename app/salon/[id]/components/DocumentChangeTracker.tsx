'use client'

/**
 * DocumentChangeTracker - Lexical plugin that tracks changed lines and measures DOM positions.
 *
 * Listens to Lexical editor updates, diffs current block content against baseline,
 * and measures block element positions for the gutter.
 *
 * Scriptorium Phase 3.6
 *
 * @module app/salon/[id]/components/DocumentChangeTracker
 */

import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import type { LinePosition } from './DocumentGutter'

interface DocumentChangeTrackerProps {
  /** Content at document open / last save, used as diff baseline */
  baselineContent: string
  /** Called with the set of changed block indices */
  onChangedLines: (lines: Set<number>) => void
  /** Called with measured positions of each block element */
  onLinePositions: (positions: LinePosition[], totalHeight: number) => void
}

export default function DocumentChangeTracker({
  baselineContent,
  onChangedLines,
  onLinePositions,
}: DocumentChangeTrackerProps) {
  const [editor] = useLexicalComposerContext()
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const baselineRef = useRef(baselineContent)

  // Keep baselineRef in sync so the update listener always sees the latest baseline
  useEffect(() => {
    baselineRef.current = baselineContent
  }, [baselineContent])

  useEffect(() => {
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      // Clear any pending debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        // Read block text contents from the editor state
        let blockTexts: string[] = []
        editorState.read(() => {
          const root = $getRoot()
          blockTexts = root.getChildren().map((node) => node.getTextContent())
        })

        // Build baseline lines — split on single newlines, treating each non-empty
        // line as a potential block (simple heuristic matching Lexical's flat block model)
        const baselineLines = baselineRef.current.split('\n')

        // Diff: a block is changed if its text differs from the corresponding baseline line
        const changedSet = new Set<number>()
        const maxLen = Math.max(blockTexts.length, baselineLines.length)
        for (let i = 0; i < maxLen; i++) {
          const current = blockTexts[i] ?? ''
          const baseline = baselineLines[i] ?? ''
          if (current !== baseline) {
            changedSet.add(i)
          }
        }

        console.debug('[DocumentChangeTracker] Block diff complete', {
          currentBlocks: blockTexts.length,
          baselineLines: baselineLines.length,
          changedCount: changedSet.size,
        })

        onChangedLines(changedSet)

        // Measure DOM positions after the read, using rAF to ensure DOM is up to date
        requestAnimationFrame(() => {
          const rootElement = editor.getRootElement()
          if (!rootElement) {
            console.debug('[DocumentChangeTracker] No root element found for DOM measurement')
            return
          }

          const children = Array.from(rootElement.children) as HTMLElement[]
          const positions: LinePosition[] = children.map((child, index) => ({
            index,
            top: child.offsetTop,
            height: child.offsetHeight,
          }))

          const totalHeight = rootElement.scrollHeight

          console.debug('[DocumentChangeTracker] DOM measurement complete', {
            blockCount: positions.length,
            totalHeight,
          })

          onLinePositions(positions, totalHeight)
        })
      }, 300)
    })

    return () => {
      unregister()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [editor, onChangedLines, onLinePositions])

  // When baseline changes (e.g. after a save), re-run the diff immediately by
  // dispatching a no-op update that will be picked up by the update listener.
  // We trigger this by directly computing the diff from the current editor state.
  useEffect(() => {
    const currentState = editor.getEditorState()
    let blockTexts: string[] = []
    currentState.read(() => {
      const root = $getRoot()
      blockTexts = root.getChildren().map((node) => node.getTextContent())
    })

    const baselineLines = baselineContent.split('\n')
    const changedSet = new Set<number>()
    const maxLen = Math.max(blockTexts.length, baselineLines.length)
    for (let i = 0; i < maxLen; i++) {
      const current = blockTexts[i] ?? ''
      const baseline = baselineLines[i] ?? ''
      if (current !== baseline) {
        changedSet.add(i)
      }
    }

    console.debug('[DocumentChangeTracker] Baseline changed, re-diffing', {
      currentBlocks: blockTexts.length,
      baselineLines: baselineLines.length,
      changedCount: changedSet.size,
    })

    onChangedLines(changedSet)
  }, [baselineContent, editor, onChangedLines])

  return null
}
