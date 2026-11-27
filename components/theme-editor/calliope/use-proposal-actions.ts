'use client'

/**
 * What Calliope's proposals do to the open draft (Spec J Stage 3). Try wears
 * a proposal in the preview and leaves the draft untouched; Keep applies its
 * operations through the editor — tokens, primitives and choices as one edit
 * (one undo step), the stylesheet through its own save, begun first when the
 * draft has none.
 *
 * @module components/theme-editor/calliope/use-proposal-actions
 */

import { useCallback, useMemo, type MutableRefObject } from 'react'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { applyChangeSet } from '@/lib/themes/assist/change-set'
import type { EditorStore } from '../editor-store'
import type { EditFn } from '../TokenRow'
import type { CalliopeProposalActions } from './CalliopePanel'
import { keepProposal, tryProposal, type TriedProposal } from './api'

interface ProposalActionsOptions {
  tried: TriedProposal | null
  setTried: (tried: TriedProposal | null) => void
  /** Turns the preview on, so a tried proposal is seen. */
  resumePreview: () => void
  /** Sends everything unsaved: she judged the saved draft. */
  flushAll: () => Promise<void>
  hasStylesheet: boolean
  /** The stylesheet as edited, ahead of the render that shows it. */
  cssRef: MutableRefObject<string>
  store: EditorStore
  edit: EditFn
  /** Attaches a stylesheet to a draft that has none; false when it could not. */
  beginStylesheet: () => Promise<boolean>
  onCssChange: (text: string) => void
}

export function useCalliopeProposalActions({
  tried,
  setTried,
  resumePreview,
  flushAll,
  hasStylesheet,
  cssRef,
  store,
  edit,
  beginStylesheet,
  onCssChange,
}: ProposalActionsOptions): CalliopeProposalActions {
  const stopTrying = useCallback(() => setTried(null), [setTried])
  return useMemo<CalliopeProposalActions>(
    () => ({
      tryingId: tried?.proposalId ?? null,
      onStopTrying: stopTrying,
      onTry: async (chatId, proposal) => {
        // She judged the saved draft: send what is typed first.
        await flushAll()
        try {
          setTried(await tryProposal(chatId, proposal.id))
          resumePreview()
        } catch (err) {
          showErrorToast(apiErrorMessage(err, 'The proposal could not be tried.'))
        }
      },
      onKeep: async (chatId, proposal) => {
        await flushAll()
        let operations
        try {
          operations = (await keepProposal(chatId, proposal.id)).operations
        } catch (err) {
          showErrorToast(apiErrorMessage(err, 'The proposal could not be kept.'))
          return
        }
        setTried(null)
        const css = hasStylesheet ? cssRef.current : null
        const applied = applyChangeSet({ tokens: store.get().tokens, css }, { operations })
        if (!applied.ok) {
          showErrorToast(`The proposal could not be applied: ${applied.reason}`)
          return
        }
        // Tokens, primitives and choices: one edit, so one undo step.
        if (applied.tokensChanged) {
          edit(`calliope:${proposal.id}`, (snapshot) => {
            const again = applyChangeSet({ tokens: snapshot.tokens, css }, { operations })
            return again.ok ? again.tokens : snapshot.tokens
          })
        }
        // The stylesheet: through its own save (begun first when the draft has none).
        if (applied.cssChanged && applied.css !== null) {
          if (!hasStylesheet && !(await beginStylesheet())) {
            showErrorToast('The proposal’s stylesheet could not be begun; its tokens were kept.')
            return
          }
          onCssChange(applied.css)
        }
        showSuccessToast(`Kept “${proposal.title}”.`)
      },
    }),
    [tried, stopTrying, setTried, resumePreview, flushAll, hasStylesheet, cssRef, store, edit, beginStylesheet, onCssChange],
  )
}
