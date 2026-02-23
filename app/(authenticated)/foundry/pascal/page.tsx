'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { useSubsystemInfo } from '@/components/providers/theme-provider'

export default function PascalPage() {
  const info = useSubsystemInfo('pascal')
  const foundryInfo = useSubsystemInfo('foundry')

  return (
    <div className="qt-page-container" style={info.backgroundImage ? { '--story-background-url': `url(${info.backgroundImage})` } as React.CSSProperties : undefined}>
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">{foundryInfo.name}</Link>
          <span className="mx-2">/</span>
          <span>{info.name}</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">{info.name}</h1>
        <p className="qt-text-muted mt-2">{info.description}</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Coming Soon" description="Pascal the Croupier is setting up the table" defaultOpen>
          <div className="qt-text-muted space-y-3">
            <p>
              Pascal the Croupier &mdash; dealer of fates, spinner of wheels, keeper of every tally &mdash;
              is presently arranging the green baize and polishing the dice. When the house opens for
              business, you shall find here the controls for random number generation, dice rolls,
              coin flips, game state tracking, inventories, scoreboards, and all manner of ludic apparatus.
            </p>
            <p>
              In the meantime, Pascal&rsquo;s services are already available in any chat: simply ask your
              character to roll dice, flip a coin, or spin the bottle, and the Croupier will oblige.
            </p>
          </div>
        </CollapsibleCard>
      </div>
    </div>
  )
}
