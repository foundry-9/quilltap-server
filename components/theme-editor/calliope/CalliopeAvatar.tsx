'use client'

/**
 * Calliope's picture, for her panel, her messages and the editor's button
 * (Spec J Stage 3). Its own module so the button never loads her transcript.
 *
 * @module components/theme-editor/calliope/CalliopeAvatar
 */

import { CALLIOPE_AVATAR } from './api'

export function CalliopeAvatar({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <span className={`qt-avatar ${className}`}>
      <img src={CALLIOPE_AVATAR} alt="" className="qt-avatar-image" />
    </span>
  )
}
