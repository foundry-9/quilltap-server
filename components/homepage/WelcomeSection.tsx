/**
 * WelcomeSection
 *
 * Server component that displays the welcome greeting with user's name.
 */

import type { WelcomeSectionProps } from './types'

export function WelcomeSection({ displayName }: WelcomeSectionProps) {
  return (
    <div className="text-center py-6">
      <h1 className="text-3xl font-bold mb-2">
        Welcome back, <span className="text-primary">{displayName}</span>!
      </h1>
      <p className="text-muted-foreground">
        What would you like to do today?
      </p>
    </div>
  )
}
