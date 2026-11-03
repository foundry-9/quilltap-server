'use client'

/**
 * SpeakingAsAvatar
 *
 * A persistent cue, seated inside the composer directly to the left of the
 * action-button cluster, of the character whose voice a typed message will
 * carry — the human's active "Speaking As" seat, resolved the same way the
 * server attributes the message (`findActiveUserParticipant`, impersonation
 * overlay aware; see Bug 45 / Bug 46).
 *
 * It stretches to the full height of the composer row (`self-stretch`, 4:5
 * portrait) and renders at full brightness when the human may type, dimming to
 * near-dark while a reply is in flight — so a glance tells the operator both
 * *who* they are speaking as and *whether* the floor is theirs.
 *
 * When the composer hands it an `establishedFact` control, a small toggle sits
 * in the portrait's bottom-left corner that arms Deus Ex Machina (the button
 * twin of `/deus`). It lives outside the dimmed layer, so it stays legible and
 * usable while a reply streams.
 */

import { getAvatarSrc, type AvatarImageSource } from '@/components/ui/Avatar'
import { useImagesHidden } from '@/components/quick-hide/images-hidden-context'
import { Icon } from '@/components/ui/icon'
import { Tooltip } from '@/components/ui/Tooltip'
import type { ImpersonationVoiceMode } from '@/lib/schemas/settings.types'

/** An armed In Their Own Words mode — what a send from this seat will do. */
export type VoiceRehearsalCue = Exclude<ImpersonationVoiceMode, 'off'>

/**
 * The one wording of the cue, shared by the portrait and the Send button so
 * the two can never describe different behaviour.
 */
export function voiceRehearsalTitle(cue: VoiceRehearsalCue, name: string, where: 'portrait' | 'send'): string {
  if (cue === 'always') {
    return where === 'portrait'
      ? `Speaking as ${name} — your draft goes to ${name} to say in their own words first`
      : `Sends your draft to ${name} to say in their own words first`
  }
  return where === 'portrait'
    ? `Speaking as ${name} — your draft opens for review; send it as written or have ${name} restate it`
    : `Opens your draft for review — send it as written or have ${name} restate it`
}

interface SpeakingAsAvatarProps {
  /** The character the human is currently speaking as. */
  name: string
  title?: string | null
  src?: AvatarImageSource | null
  /** Bright when the human may type now; dimmed to near-dark while a reply streams. */
  canType: boolean
  /** Extra wrapper classes (e.g. responsive show/hide from the composer). */
  className?: string
  /**
   * The armed In Their Own Words mode for this seat, or null — a typed line
   * opens the review dialog before it posts. Purely a cue: the badge says what
   * will happen, it does not make it happen.
   */
  voiceRehearsal?: VoiceRehearsalCue | null
  /**
   * The Deus Ex Machina toggle seated on the portrait — omitted, no toggle.
   * The composer owns the armed state; this only shows and flips it.
   */
  establishedFact?: EstablishedFactToggle | null
}

export interface EstablishedFactToggle {
  armed: boolean
  onToggle: () => void
  disabled?: boolean
}

export function SpeakingAsAvatar({
  name,
  title,
  src,
  canType,
  className = '',
  voiceRehearsal = null,
  establishedFact = null,
}: Readonly<SpeakingAsAvatarProps>) {
  const imagesHidden = useImagesHidden()
  const avatarSrc = imagesHidden ? null : getAvatarSrc(src ?? null)
  const initial = name.charAt(0).toUpperCase()

  const portraitTip = voiceRehearsal
    ? voiceRehearsalTitle(voiceRehearsal, name, 'portrait')
    : canType
      ? `Speaking as ${name}`
      : `Speaking as ${name} — waiting for the room`

  return (
    // The outer box carries the portrait's 4:5 sizing as the composer's flex
    // item (a nested aspect box would measure to nothing); the tooltip anchor
    // and the portrait fill it, and the toggle floats over its corner. A
    // stretched aspect box takes its width from its content, so a bare initial
    // would shrink it to a sliver — hence the floor when there is no picture.
    <div className={`relative flex self-stretch aspect-[4/5] max-h-40 flex-shrink-0${avatarSrc ? '' : ' min-w-24'} ${className}`}>
      <Tooltip content={portraitTip} anchorClassName="w-full h-full">
        <div
          className={`qt-speaking-as-avatar relative w-full h-full overflow-hidden qt-bg-muted flex items-center justify-center transition-[filter,opacity] duration-200 ${
            canType ? 'opacity-100' : 'opacity-60 brightness-50'
          }`}
          style={{ borderRadius: 'var(--radius-md)' }}
          aria-label={canType ? `Speaking as ${name}` : `Speaking as ${name}, waiting for the room`}
        >
          {avatarSrc ? (

            <img src={avatarSrc} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="font-bold qt-text-secondary text-lg">{initial}</span>
          )}
          {voiceRehearsal && (
            <span
              className="absolute bottom-0.5 right-0.5 qt-bg-muted qt-text-secondary p-0.5 flex items-center justify-center"
              style={{ borderRadius: 'var(--radius-sm)' }}
              aria-hidden="true"
            >
              <Icon name="thinking" className="w-3 h-3" />
            </span>
          )}
        </div>
      </Tooltip>
      {establishedFact && (
        <div className="absolute bottom-1 left-1">
          <Tooltip
            content={establishedFact.armed
              ? 'Deus Ex Machina is armed — your next line descends from the rafters as established fact. Click to stand it down.'
              : 'Deus Ex Machina — post your next line as established fact (or type /deus)'}
          >
            <button
              type="button"
              className="qt-chat-established-fact-toggle"
              // Keep the caret in the editor: arming is a mode, not a destination.
              onMouseDown={(e) => e.preventDefault()}
              onClick={establishedFact.onToggle}
              disabled={establishedFact.disabled}
              aria-pressed={establishedFact.armed}
              aria-label="Deus Ex Machina"
            >
              <Icon name="deus-ex-machina" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export default SpeakingAsAvatar
