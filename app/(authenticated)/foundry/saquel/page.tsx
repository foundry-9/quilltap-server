'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { useSubsystemInfo } from '@/components/providers/theme-provider'

export default function SaquelPage() {
  const info = useSubsystemInfo('saquel')
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
        <CollapsibleCard title="Coming Soon" description="Saquel Ytzama is reviewing the vault inventory" defaultOpen>
          <div className="qt-text-muted space-y-3">
            <p>
              Saquel Ytzama &mdash; the Keeper of Secrets, guardian of the cipher-lock,
              the one who ensures that no confidence is ever betrayed &mdash; is presently
              cataloguing the contents of the vault. When the ledger is complete, you shall
              find here the controls for API key management, encryption settings, credential
              rotation, and all matters pertaining to the safekeeping of sensitive information.
            </p>
            <p>
              In the meantime, your API keys and encryption are managed securely through
              The Forge, where Saquel already stands watch over every secret entrusted
              to the system.
            </p>
          </div>
        </CollapsibleCard>
      </div>
    </div>
  )
}
