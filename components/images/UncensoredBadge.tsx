'use client'

/**
 * UncensoredBadge — the gallery's mark on a picture an uncensored profile drew.
 *
 * Every gallery (the chat gallery and its album views, Aurora's album, avatar
 * rolls and wardrobe pictures, `/photos`, the image picker) draws this one
 * component from the entry's `generationModeration`, which the server fills
 * in by content hash (`lib/photos/uncensored-images.ts`). Renders nothing for
 * a moderated or unknown picture. The caller positions it.
 */

import { Icon } from '@/components/ui/icon'
import {
  isUncensoredGeneration,
  type GenerationModeration,
} from '@/lib/schemas/file.types'

const DETAIL: Record<Exclude<GenerationModeration, 'moderated'>, string> = {
  'uncensored-profile': 'Painted by an uncensored studio of your own choosing',
  'uncensored-routed': 'Sent round to the uncensored studio by the Concierge before the brush was lifted',
  'uncensored-failover': 'The house painter declined; the uncensored studio took up the brush instead',
}

interface UncensoredBadgeProps {
  moderation: GenerationModeration | null | undefined
  /** Positioning classes from the caller (e.g. `absolute top-1 left-1`). */
  className?: string
}

export function UncensoredBadge({ moderation, className = '' }: UncensoredBadgeProps) {
  if (!moderation || !isUncensoredGeneration(moderation)) return null
  const detail = DETAIL[moderation as Exclude<GenerationModeration, 'moderated'>]
  return (
    <span
      className={`qt-uncensored-badge ${className}`.trim()}
      title={detail}
      data-generation-moderation={moderation}
    >
      <Icon name="alert-triangle" className="w-3 h-3" />
      <span>Uncensored</span>
      <span className="sr-only">: {detail}</span>
    </span>
  )
}

export default UncensoredBadge
