'use client'

/**
 * Sidebar Width Control Component
 *
 * Displays the current sidebar width and provides a reset button.
 * Width changes are made by dragging the sidebar resize handle.
 *
 * @module components/settings/appearance/SidebarWidthControl
 */

import { useSidebar, DEFAULT_SIDEBAR_WIDTH } from '@/components/providers/sidebar-provider'

/**
 * Renders the sidebar width control section
 */
export function SidebarWidthControl() {
  const { width, resetWidth } = useSidebar()
  const isDefault = width === DEFAULT_SIDEBAR_WIDTH

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2 text-foreground">Sidebar Width</h2>
      <p className="text-muted-foreground mb-4">
        Drag the right edge of the sidebar to resize it. The width is saved automatically.
      </p>

      <div className="flex items-center justify-between gap-4 p-4 border rounded-lg border-border bg-card">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 p-2 rounded-full bg-muted text-muted-foreground">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h7"
              />
            </svg>
          </div>
          <div>
            <div className="qt-text-primary font-medium">
              Current width: <span className="font-mono">{width}px</span>
            </div>
            <div className="qt-text-small">
              {isDefault ? (
                'Default width'
              ) : (
                <span>
                  {width > DEFAULT_SIDEBAR_WIDTH
                    ? `${width - DEFAULT_SIDEBAR_WIDTH}px wider than default`
                    : `${DEFAULT_SIDEBAR_WIDTH - width}px narrower than default`}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={resetWidth}
          disabled={isDefault}
          className={`
            px-4 py-2 text-sm font-medium rounded-md transition-colors
            ${isDefault
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }
          `}
        >
          Reset to Default
        </button>
      </div>
    </section>
  )
}
