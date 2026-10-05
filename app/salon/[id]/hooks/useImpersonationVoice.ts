'use client'

/**
 * In Their Own Words — interception of the composer's submit for an
 * impersonated seat.
 *
 * When the instance setting is not `off` and the seat the composer will
 * attribute the message to is one the human is *impersonating* (the Bug 44
 * overlay, not an owner seat), the draft does not go straight to the chat. It
 * is stashed and the review dialog opens. Under `ask` the dialog waits on the
 * draft alone — no model is called until the operator asks for a restatement —
 * and under `always` the seat's own model starts restating it at once. Nothing
 * reaches the chat until the operator chooses, and every exit from the dialog
 * that does not send leaves the draft exactly where it was, because only
 * `sendMessage` clears the editor.
 *
 * Only an explicit Restate / Regenerate press (or opening under `always`) ever
 * spends a model call; changing a picker just drops a stale proposal.
 *
 * @module app/salon/[id]/hooks/useImpersonationVoice
 */

import { useCallback, useRef, useState } from 'react'
import { parseCarinaQuery } from '@/lib/chat/carina-parser'
import { showErrorToast } from '@/lib/toast'
import type { ImpersonationVoiceMode } from '@/lib/schemas/settings.types'
import type { AttachedFile, PendingToolResult } from '../types'

/** The minimum a gate decision needs to know about the speaking seat. */
export interface RehearsalSeat {
  id: string
  type: 'CHARACTER'
  controlledBy?: 'llm' | 'user'
}

export interface ShouldRehearseArgs {
  /** `chatSettings.impersonationVoiceMode`. */
  mode: ImpersonationVoiceMode
  /** The seat the composer will attribute this message to (`speakingSeat`). */
  seat: RehearsalSeat | null
  impersonatingParticipantIds: readonly string[]
  text: string
  /** True when the send carries only attachments / tool results and no prose. */
  hasAttachmentsOnly: boolean
  /** Set for the one resubmit that "Send as written" triggers. */
  bypassOnce: boolean
}

/**
 * The gate. True only when every condition holds; pure, so it can be tested
 * and reasoned about without a render.
 *
 * An owner seat (`controlledBy: 'user'`) never qualifies, even when it also
 * appears in the overlay list: the overlay is the one signal that says "this
 * character has a voice of their own that a model normally supplies".
 */
export function shouldRehearseImpersonatedLine({
  mode,
  seat,
  impersonatingParticipantIds,
  text,
  hasAttachmentsOnly,
  bypassOnce,
}: ShouldRehearseArgs): boolean {
  if (mode === 'off') return false
  if (bypassOnce) return false
  if (!seat) return false
  if (seat.type !== 'CHARACTER') return false
  if (seat.controlledBy === 'user') return false
  if (!impersonatingParticipantIds.includes(seat.id)) return false
  if (text.trim().length === 0) return false
  if (hasAttachmentsOnly) return false
  // A Carina address is machinery, not a line: `@Name:` routes to an answerer
  // and must survive verbatim. Rewriting it would rewrite the address.
  if (parseCarinaQuery(text)) return false
  return true
}

/** Everything the dialog needs about the seat it is rehearsing for. */
export interface RehearsalTarget {
  participantId: string
  characterName: string
  characterTitle?: string | null
  avatarSrc?: { defaultImage?: { id: string; filepath: string; url?: string } | null; avatarUrl?: string | null } | null
  /** The seat's own profile, used as the picker's default label. */
  profileName?: string | null
  modelName?: string | null
  systemPrompts?: Array<{ id: string; name: string; isDefault?: boolean }>
  selectedSystemPromptId?: string | null
}

/**
 * `draft` — open on the operator's words, no restatement requested (or the one
 * on screen was dropped by a picker change). `generating` / `review` — a
 * restatement is in flight / on screen (possibly empty after a failure).
 */
export type ImpersonationVoiceStage = 'idle' | 'draft' | 'generating' | 'review'

interface PendingSend {
  seed: string
  attachedFiles: AttachedFile[]
  pendingToolResults: PendingToolResult[]
}

/** What `sendMessage` needs, minus the text and the event. */
export interface SendMessageArgs {
  setInput: (v: string) => void
  setPendingToolResults: (results: PendingToolResult[]) => void
  clearDraft: () => void
}

export interface UseImpersonationVoiceOptions {
  chatId: string
  /** The streaming hook's `sendMessage`, called with a null event. */
  sendMessage: (
    e: React.FormEvent | null,
    input: string,
    setInput: (v: string) => void,
    attachedFiles: AttachedFile[],
    pendingToolResults: PendingToolResult[],
    setPendingToolResults: (results: PendingToolResult[]) => void,
    clearDraft: () => void,
  ) => void | Promise<void>
  /** Put the cursor back in the composer when the operator returns to it. */
  focusComposer: () => void
}

export function useImpersonationVoice({
  chatId,
  sendMessage,
  focusComposer,
}: UseImpersonationVoiceOptions) {
  const [pending, setPending] = useState<PendingSend | null>(null)
  const [target, setTarget] = useState<RehearsalTarget | null>(null)
  const [stage, setStage] = useState<ImpersonationVoiceStage>('idle')
  const [proposal, setProposal] = useState('')
  const [profileOverride, setProfileOverride] = useState<string | null>(null)
  const [systemPromptOverride, setSystemPromptOverride] = useState<string | null>(null)
  const [resolvedVoice, setResolvedVoice] = useState<{ profileName: string; modelName: string } | null>(null)
  const sendArgsRef = useRef<SendMessageArgs | null>(null)
  // Mirrors `pending` so the restate / send callbacks read the live draft
  // without a stale closure, and without the dialog holding a second copy of
  // the text (which would need an effect to stay in step).
  const pendingRef = useRef<PendingSend | null>(null)
  // One-shot: set immediately before a send dispatched from the dialog, so the
  // gate lets it through if it is ever consulted on the way out. Consumed by
  // the next `intercept` and cleared on every `close`, so it cannot leak into a
  // later submit and skip a rehearsal the operator expected.
  const bypassOnceRef = useRef(false)

  const isOpen = pending !== null

  const writePending = useCallback((next: PendingSend | null) => {
    pendingRef.current = next
    setPending(next)
  }, [])

  /** The draft editor writes straight through — the hook owns the text. */
  const setSeed = useCallback(
    (value: string) => {
      const current = pendingRef.current
      if (!current) return
      writePending({ ...current, seed: value })
    },
    [writePending],
  )

  const runPreview = useCallback(
    async (seed: string, profileId: string | null, systemPromptId: string | null, participantId: string) => {
      setStage('generating')
      setProposal('')
      try {
        const res = await fetch(`/api/v1/chats/${chatId}?action=impersonation-voice-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participantId,
            seedMarkdown: seed.trim(),
            connectionProfileId: profileId || undefined,
            systemPromptId: systemPromptId || undefined,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          showErrorToast(err.message || err.error || `Failed (HTTP ${res.status})`)
          // Stay in review with an empty proposal: a dead provider must never
          // trap the operator's draft behind a dialog with nothing to press.
          setStage('review')
          return
        }

        const data = await res.json()
        setProposal(String(data.proposedMarkdown || '').trim())
        if (data.profileName || data.modelName) {
          setResolvedVoice({
            profileName: String(data.profileName ?? ''),
            modelName: String(data.modelName ?? ''),
          })
        }
        setStage('review')
      } catch (error) {
        showErrorToast(
          error instanceof Error ? error.message : 'Failed to restate the line in character',
        )
        setStage('review')
      }
    },
    [chatId],
  )

  /**
   * Called from the composer's `onSubmit` before the send. Returns true when it
   * has taken the submit over (and has already called `preventDefault`).
   */
  const intercept = useCallback(
    (
      e: React.FormEvent,
      args: {
        text: string
        seat: RehearsalSeat | null
        seatTarget: RehearsalTarget | null
        mode: ImpersonationVoiceMode
        impersonatingParticipantIds: readonly string[]
        attachedFiles: AttachedFile[]
        pendingToolResults: PendingToolResult[]
        sendArgs: SendMessageArgs
      },
    ): boolean => {
      const hasAttachmentsOnly =
        args.text.trim().length === 0
        && (args.attachedFiles.length > 0 || args.pendingToolResults.length > 0)

      const armed = shouldRehearseImpersonatedLine({
        mode: args.mode,
        seat: args.seat,
        impersonatingParticipantIds: args.impersonatingParticipantIds,
        text: args.text,
        hasAttachmentsOnly,
        bypassOnce: bypassOnceRef.current,
      })

      // The bypass is consumed by the submit it was set for, whether or not
      // anything else about the gate would have fired.
      bypassOnceRef.current = false

      if (!armed || !args.seatTarget) return false

      e.preventDefault()
      writePending({
        seed: args.text,
        attachedFiles: args.attachedFiles,
        pendingToolResults: args.pendingToolResults,
      })
      setTarget(args.seatTarget)
      setProfileOverride(null)
      setSystemPromptOverride(null)
      setResolvedVoice(null)
      sendArgsRef.current = args.sendArgs
      if (args.mode === 'always') {
        void runPreview(args.text, null, null, args.seatTarget.participantId)
      } else {
        // `ask`: the operator speaks for the character unless they say
        // otherwise, so no model is called until they press Restate.
        setStage('draft')
      }
      return true
    },
    [runPreview, writePending],
  )

  const close = useCallback(() => {
    pendingRef.current = null
    // Cleared on every close so a one-shot bypass can never outlive the dialog
    // and silently skip the *next* rehearsal.
    bypassOnceRef.current = false
    setPending(null)
    setTarget(null)
    setStage('idle')
    setProposal('')
    setProfileOverride(null)
    setSystemPromptOverride(null)
    setResolvedVoice(null)
    sendArgsRef.current = null
  }, [])

  const send = useCallback(
    (final: string) => {
      const stash = pendingRef.current
      const sendArgs = sendArgsRef.current
      if (!stash || !sendArgs) return
      // `sendMessage` clears the editor and the draft itself, so both Send
      // variants leave the composer empty exactly as a normal send does.
      bypassOnceRef.current = true
      void sendMessage(
        null,
        final,
        sendArgs.setInput,
        stash.attachedFiles,
        stash.pendingToolResults,
        sendArgs.setPendingToolResults,
        sendArgs.clearDraft,
      )
      close()
    },
    [sendMessage, close],
  )

  const sendAsWritten = useCallback(() => {
    const stash = pendingRef.current
    if (stash) send(stash.seed)
  }, [send])

  /**
   * Restate (first time) or Regenerate (again) — the only operator action that
   * spends a model call. Uses the draft the operator can see right now, so an
   * edit in the dialog is carried into the attempt.
   */
  const restate = useCallback(() => {
    const stash = pendingRef.current
    if (!target || !stash || stash.seed.trim().length === 0) return
    void runPreview(stash.seed, profileOverride, systemPromptOverride, target.participantId)
  }, [target, profileOverride, systemPromptOverride, runPreview])

  /**
   * A picker change makes any proposal on screen stale: drop it and wait for
   * the operator to ask again, rather than spending a call they did not request.
   */
  const dropStaleProposal = useCallback(() => {
    setProposal('')
    // The voice the last call reported is no longer the one that would speak.
    setResolvedVoice(null)
    setStage('draft')
  }, [])

  const changeProfile = useCallback(
    (profileId: string | null) => {
      setProfileOverride(profileId)
      dropStaleProposal()
    },
    [dropStaleProposal],
  )

  const changeSystemPrompt = useCallback(
    (systemPromptId: string | null) => {
      setSystemPromptOverride(systemPromptId)
      dropStaleProposal()
    },
    [dropStaleProposal],
  )

  /** Back to the composer — the draft is still in the editor, untouched. */
  const editOriginal = useCallback(() => {
    close()
    focusComposer()
  }, [close, focusComposer])

  const cancel = useCallback(() => {
    close()
    focusComposer()
  }, [close, focusComposer])

  return {
    isOpen,
    stage,
    seed: pending?.seed ?? '',
    setSeed,
    target,
    proposal,
    setProposal,
    profileOverride,
    systemPromptOverride,
    resolvedVoice,
    intercept,
    send,
    sendAsWritten,
    restate,
    changeProfile,
    changeSystemPrompt,
    editOriginal,
    cancel,
  }
}

export type ImpersonationVoiceState = ReturnType<typeof useImpersonationVoice>
