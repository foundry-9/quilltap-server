'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { StandaloneDangerousContent } from '@/components/settings/chat-settings/StandaloneDangerousContent'

export default function DangermousePage() {
  return (
    <div className="qt-page-container">
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>Dangermouse</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">Dangermouse</h1>
        <p className="qt-text-muted mt-2">Dangerous content detection and routing settings</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Dangerous Content Settings" description="Configure content detection, routing, and display behavior" defaultOpen>
          <StandaloneDangerousContent />
        </CollapsibleCard>
      </div>
    </div>
  )
}
