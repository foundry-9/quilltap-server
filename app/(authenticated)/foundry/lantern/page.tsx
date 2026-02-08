'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import { StandaloneStoryBackgrounds } from '@/components/settings/chat-settings/StandaloneStoryBackgrounds'

export default function LanternPage() {
  return (
    <div className="qt-page-container" style={{ '--story-background-url': 'url(/images/lantern.png)' } as React.CSSProperties}>
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>The Lantern</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">The Lantern</h1>
        <p className="qt-text-muted mt-2">Image profiles and story background settings</p>
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
