/**
 * WelcomeSection
 *
 * The greeting at the head of the home page: one line, beside the quick
 * actions.
 */

import type { WelcomeSectionProps } from './types'

export function WelcomeSection({ displayName, firstVisit = false }: WelcomeSectionProps) {
  return (
    <div className="qt-homepage-welcome">
      <h1 className="qt-heading-2">
        {firstVisit ? 'Welcome to Quilltap' : 'Welcome back'}, <span className="qt-text-brand">{displayName}</span>!
      </h1>
    </div>
  )
}
