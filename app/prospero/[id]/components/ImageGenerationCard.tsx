'use client'

/**
 * Image Generation Card
 *
 * Card displaying avatar generation and story background settings for a project.
 */

import type { Project, BackgroundDisplayMode } from '../types'

interface ImageGenerationCardProps {
  project: Project
  onAvatarGenerationChange: (enabled: boolean | null) => void
  onBackgroundDisplayModeChange: (mode: BackgroundDisplayMode) => void
  expanded: boolean
  onToggle: () => void
}

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

export function ImageGenerationCard({
  project,
  onAvatarGenerationChange,
  onBackgroundDisplayModeChange,
  expanded,
  onToggle,
}: ImageGenerationCardProps) {
  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <ImageIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Image Generation</h3>
            <p className="qt-text-small qt-text-secondary">
              Avatars &amp; story backgrounds
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default p-4 space-y-4">
          {/* Avatar Generation Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="text-sm font-medium text-foreground mb-1">Avatar Generation</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              Auto-generate character avatars when outfits change in new chats.
            </p>
            <select
              value={project.defaultAvatarGenerationEnabled === null || project.defaultAvatarGenerationEnabled === undefined ? 'inherit' : project.defaultAvatarGenerationEnabled ? 'enabled' : 'disabled'}
              onChange={(e) => {
                const value = e.target.value
                onAvatarGenerationChange(value === 'inherit' ? null : value === 'enabled')
              }}
              className="qt-input w-full max-w-xs"
            >
              <option value="inherit">Inherit from global</option>
              <option value="enabled">Enabled by default</option>
              <option value="disabled">Disabled by default</option>
            </select>
          </div>

          {/* Story Backgrounds Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="text-sm font-medium text-foreground mb-1">Story Backgrounds</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              Choose how the project background is displayed. Backgrounds are generated from chat titles and characters.
            </p>
            <select
              value={project.backgroundDisplayMode || 'theme'}
              onChange={(e) => onBackgroundDisplayModeChange(e.target.value as BackgroundDisplayMode)}
              className="qt-input w-full max-w-xs"
            >
              <option value="theme">Use theme background (no image)</option>
              <option value="latest_chat">Latest chat background</option>
              <option value="project">Project-generated background</option>
              <option value="static">Static uploaded image</option>
            </select>
            <p className="qt-text-xs qt-text-secondary mt-2">
              {project.backgroundDisplayMode === 'latest_chat' && 'Shows the most recent background from any chat in this project.'}
              {project.backgroundDisplayMode === 'project' && 'Uses a background generated specifically for this project.'}
              {project.backgroundDisplayMode === 'static' && 'Uses a manually uploaded background image.'}
              {(!project.backgroundDisplayMode || project.backgroundDisplayMode === 'theme') && 'No background image, uses your theme colors.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
