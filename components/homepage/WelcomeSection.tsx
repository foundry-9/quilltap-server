/**
 * WelcomeSection
 *
 * Server component that displays the welcome greeting with user's name.
 */

import type { WelcomeSectionProps } from './types'

export function WelcomeSection({ displayName, firstVisit = false }: WelcomeSectionProps) {
  return (
    <div className="text-center py-6">
      <h1 className="qt-heading-1 mb-2">
        {firstVisit ? 'Welcome to Quilltap' : 'Welcome back'}, <span className="qt-text-brand">{displayName}</span>!
      </h1>
      <p className="qt-text-secondary">
        What would you like to do today?
      </p>
    </div>
  )
}
