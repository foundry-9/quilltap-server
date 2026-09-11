'use client'

/**
 * In Their Own Words — the review dialog for an impersonated seat's line.
 *
 * The operator typed a line while wearing a character's seat; this is where
 * they read it back in that character's voice before it posts. Nothing has
 * reached the chat yet, and nothing will until a footer button says so:
 * **Send** posts the proposal (edited or not), **Regenerate** asks again,
 * **Edit original** returns to the composer with the draft intact, **Send as
 * written** posts the operator's own words, and **Cancel** changes nothing.
 *
 * The last two are never disabled once a preview has failed — a dead provider
 * must not trap a draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { VoiceRewriteReviewPanel } from '@/components/chat/VoiceRewriteReviewPanel'
import { getAvatarSrc, type AvatarImageSource } from '@/components/ui/Avatar'
import { showErrorToast } from '@/lib/toast'

interface ProfileCard {
  id: string
  name: string
  modelName: string
  isDefault: boolean
}

export interface ImpersonationVoiceDialogProps {
  isOpen: boolean
  /** The seat being spoken for. */
  characterName: string
  characterTitle?: string | null
  avatarSrc?: AvatarImageSource | null
  /** The profile and model the server actually rewrote through, once known. */
  profileName?: string | null
  modelName?: string | null
  /** The character's named system prompts; the picker only shows for 2+. */
  systemPrompts?: Array<{ id: string; name: string; isDefault?: boolean }>
  /** The seat's own selection, used as the prompt picker's initial value. */
  selectedSystemPromptId?: string | null
  /** The operator's draft. Editable here; the hook owns the text. */
  seed: string
  onSeedChange: (value: string) => void
  proposal: string
  onProposalChange: (value: string) => void
  generating: boolean
  profileOverride: string | null
  systemPromptOverride: string | null
  onSend: (final: string) => void
  onSendAsWritten: () => void
  onRegenerate: () => void
  onChangeProfile: (profileId: string | null) => void
  onChangeSystemPrompt: (systemPromptId: string | null) => void
  onEditOriginal: () => void
  onCancel: () => void
}

export default function ImpersonationVoiceDialog({
  isOpen,
  characterName,
  characterTitle,
  avatarSrc,
  profileName,
  modelName,
  systemPrompts = [],
  selectedSystemPromptId,
  seed,
  onSeedChange,
  proposal,
  onProposalChange,
  generating,
  profileOverride,
  systemPromptOverride,
  onSend,
  onSendAsWritten,
  onRegenerate,
  onChangeProfile,
  onChangeSystemPrompt,
  onEditOriginal,
  onCancel,
}: ImpersonationVoiceDialogProps) {
  // The draft is editable here, but the hook owns the text — a second copy
  // would need an effect to stay in step with it.
  const [profiles, setProfiles] = useState<ProfileCard[]>([])
  const proposalRef = useRef<HTMLDivElement>(null)

  // Bring the proposal into view the moment it arrives. On a short screen the
  // draft and the pickers can push it below the fold, and a review dialog that
  // opens with its answer off-screen is not reviewing anything.
  useEffect(() => {
    if (generating) return
    proposalRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [generating])

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/v1/connection-profiles')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        setProfiles(
          (data.profiles || []).map((p: Record<string, unknown>) => ({
            id: String(p.id),
            name: String(p.name ?? ''),
            modelName: String(p.modelName ?? ''),
            isDefault: Boolean(p.isDefault),
          })),
        )
      })
      .catch((err) => {
        showErrorToast(`Failed to load connection profiles: ${err.message}`)
      })
  }, [isOpen])

  const avatar = getAvatarSrc(avatarSrc ?? null)
  const initial = characterName.charAt(0).toUpperCase()
  const showPromptPicker = systemPrompts.length > 1
  const canSend = !generating && proposal.trim().length > 0

  const voiceLine = useMemo(() => {
    if (!profileName && !modelName) return null
    return modelName ? `Spoken through ${profileName} — ${modelName}` : `Spoken through ${profileName}`
  }, [profileName, modelName])

  const handleProposalKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSend) {
        e.preventDefault()
        onSend(proposal)
      }
    },
    [canSend, onSend, proposal],
  )

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={generating ? () => {} : onCancel}
      title={`In ${characterName}'s own words`}
      storageKey="quilltap:impersonation-voice-geometry"
      // Taller than the announcement dialog's 600: there the proposal is an
      // optional second act, here it is the whole point, and at 600 it opens
      // below the fold. FloatingDialog clamps to the viewport, so a short
      // screen still gets a dialog that fits.
      initialGeometry={{ width: 640, height: 720 }}
      minWidth={420}
      minHeight={460}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-4">
          {/* Seat header */}
          <div className="mb-4 flex items-center gap-3">
            {avatar ? (
              <img
                src={avatar}
                alt=""
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full qt-bg-secondary flex items-center justify-center flex-shrink-0">
                <span className="font-bold qt-text-secondary">{initial}</span>
              </div>
            )}
            <div className="min-w-0">
              <div className="font-medium truncate">{characterName}</div>
              {characterTitle && (
                <div className="text-xs qt-text-secondary truncate">{characterTitle}</div>
              )}
              {voiceLine && <div className="qt-text-xs truncate">{voiceLine}</div>}
            </div>
          </div>

          {/* The operator's draft */}
          <div className="mb-4">
            <label className="block text-sm qt-text-primary mb-2">Your draft</label>
            <MarkdownLexicalEditor
              value={seed}
              onChange={onSeedChange}
              disabled={generating}
              namespace="ImpersonationVoiceDialogSeed"
              ariaLabel="Your draft"
            />
          </div>

          {/* Voice pickers — changing either re-runs on the current draft. */}
          <div className="mb-4 space-y-3">
            <div>
              <label htmlFor="impersonation-voice-profile" className="block text-sm qt-text-primary mb-2">
                How should they say it?
              </label>
              <select
                id="impersonation-voice-profile"
                value={profileOverride ?? ''}
                onChange={(e) => onChangeProfile(e.target.value || null)}
                className="qt-input w-full"
                disabled={generating}
              >
                <option value="">Their own voice{profileName ? ` (${profileName})` : ''}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.modelName}
                    {p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {showPromptPicker && (
              <div>
                <label htmlFor="impersonation-voice-prompt" className="block text-sm qt-text-primary mb-2">
                  System prompt
                </label>
                <select
                  id="impersonation-voice-prompt"
                  value={systemPromptOverride ?? selectedSystemPromptId ?? ''}
                  onChange={(e) => onChangeSystemPrompt(e.target.value || null)}
                  className="qt-input w-full"
                  disabled={generating}
                >
                  {systemPrompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* The proposal */}
          <div ref={proposalRef} onKeyDown={handleProposalKeyDown}>
            <VoiceRewriteReviewPanel
              characterName={characterName}
              generating={generating}
              value={proposal}
              onChange={onProposalChange}
              namespace="ImpersonationVoiceDialogPreview"
              ariaLabel={`What ${characterName} will say`}
            />
            {!generating && proposal.trim().length === 0 && (
              <div className="qt-text-xs mt-2">
                Nothing came back. Send your own words as written, or go back and rewrite them.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t qt-border-default px-4 py-3 flex items-center justify-end gap-2 flex-wrap">
          <button
            type="button"
            onClick={onCancel}
            className="qt-button qt-button-secondary"
            disabled={generating}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onEditOriginal}
            className="qt-button qt-button-secondary"
            disabled={generating}
          >
            Edit original
          </button>
          <button
            type="button"
            onClick={onSendAsWritten}
            className="qt-button qt-button-secondary"
            disabled={generating}
          >
            Send as written
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            className="qt-button qt-button-secondary"
            disabled={generating || seed.trim().length === 0}
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={() => onSend(proposal)}
            className="qt-button qt-button-primary"
            disabled={!canSend}
          >
            {generating ? 'Rehearsing…' : 'Send'}
          </button>
        </div>
      </div>
    </FloatingDialog>
  )
}
