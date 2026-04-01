'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import { StandaloneStoryBackgrounds } from '@/components/settings/chat-settings/StandaloneStoryBackgrounds'
import { useSubsystemInfo } from '@/components/providers/theme-provider'

export default function LanternPage() {
  const info = useSubsystemInfo('lantern')
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
        <CollapsibleCard title="Image Profiles" description="Configure image generation providers and models">
          <ImageProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Story Backgrounds" description="Configure automatic story background image generation">
          <StandaloneStoryBackgrounds />
        </CollapsibleCard>
      </div>
    </div>
  )
}
