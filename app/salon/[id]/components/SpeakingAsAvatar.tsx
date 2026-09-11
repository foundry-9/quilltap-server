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
 */

import { getAvatarSrc, type AvatarImageSource } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/icon'

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
   * True when In Their Own Words is armed for this seat — a typed line goes to
   * the character for a restatement you review before it posts. Purely a cue:
   * the badge says what will happen, it does not make it happen.
   */
  voiceRehearsal?: boolean
}

export function SpeakingAsAvatar({
  name,
  title,
  src,
  canType,
  className = '',
  voiceRehearsal = false,
}: Readonly<SpeakingAsAvatarProps>) {
  const avatarSrc = getAvatarSrc(src ?? null)
  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      className={`qt-speaking-as-avatar relative self-stretch aspect-[4/5] max-h-40 flex-shrink-0 overflow-hidden qt-bg-muted flex items-center justify-center transition-[filter,opacity] duration-200 ${
        canType ? 'opacity-100' : 'opacity-60 brightness-50'
      } ${className}`}
      style={{ borderRadius: 'var(--radius-md)' }}
      title={
        voiceRehearsal
          ? `Speaking as ${name} — your draft goes to ${name} to say in their own words first`
          : canType
            ? `Speaking as ${name}`
            : `Speaking as ${name} — waiting for the room`
      }
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
  )
}

export default SpeakingAsAvatar
