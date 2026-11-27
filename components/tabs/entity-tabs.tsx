'use client'

export interface Tab {
  id: string
  label: string
  icon?: React.ReactNode
}

interface EntityTabsProps {
  tabs: Tab[]
  /** Extra class name(s) applied to the tab content panel wrapper */
  contentClassName?: string
  /** The owner holds the active tab (and any URL sync); `onTabChange` reports clicks. */
  activeTab: string
  onTabChange: (tabId: string) => void
  /** Accessible name of the tab strip. */
  ariaLabel?: string
  children: (activeTab: string) => React.ReactNode
}

export function EntityTabs({
  tabs,
  contentClassName,
  activeTab,
  onTabChange,
  ariaLabel = 'Tabs',
  children,
}: EntityTabsProps) {
  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-6">
        {/* Scrolls sideways rather than wrapping or overflowing the page at phone width. */}
        <nav className="qt-tab-group overflow-x-auto" aria-label={ariaLabel}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`qt-tab flex-shrink-0 ${activeTab === tab.id ? 'qt-tab-active' : ''}`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <span className="qt-tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="qt-tab-divider"></div>
      </div>

      {/* Tab Content */}
      <div className={contentClassName}>
        {children(activeTab)}
      </div>
    </div>
  )
}
