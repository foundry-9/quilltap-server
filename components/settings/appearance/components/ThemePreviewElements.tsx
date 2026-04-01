/**
 * Theme Preview Elements Component
 *
 * Pure presentational component showing real UI elements to preview a theme.
 * Uses only qt-* classes to ensure theme variables are applied correctly.
 *
 * @module components/settings/appearance/components/ThemePreviewElements
 */

import { BrandName } from '@/components/ui/brand-name'

/**
 * Renders UI elements that showcase the theme's visual style
 *
 * This component is designed to be rendered inside a scoped theme container
 * that applies the theme's CSS variables.
 */
export function ThemePreviewElements() {
  return (
    <div className="p-4 space-y-4">
      {/* Heading - shows font family and foreground color */}
      <h2 className="qt-heading-2">
        Welcome to <BrandName />
      </h2>

      {/* Body text - shows typography */}
      <p className="qt-text-small">
        This is a preview of how the theme will look. The colors, fonts,
        and styles shown here will be applied throughout the application.
      </p>

      {/* Buttons - shows primary and secondary button styles */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="qt-button-primary">
          Primary
        </button>
        <button type="button" className="qt-button-secondary">
          Secondary
        </button>
        <button type="button" className="qt-button-ghost">
          Ghost
        </button>
      </div>

      {/* Input - shows input styling */}
      <input
        type="text"
        className="qt-input"
        placeholder="Text input placeholder..."
        readOnly
      />

      {/* Badges - shows badge colors */}
      <div className="flex flex-wrap gap-2">
        <span className="qt-badge-character">Character</span>
        <span className="qt-badge-chat">Chat</span>
        <span className="qt-badge-success">Success</span>
        <span className="qt-badge-secondary">Tag</span>
      </div>

      {/* Card - shows card/surface styling */}
      <div className="qt-card p-3">
        <h3 className="qt-card-title text-sm">Card Example</h3>
        <p className="qt-card-description text-xs mt-1">
          Cards use the card background and border colors.
        </p>
      </div>
    </div>
  )
}
