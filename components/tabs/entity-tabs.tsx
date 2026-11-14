'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export interface Tab {
  id: string
  label: string
  icon?: React.ReactNode
}

interface EntityTabsProps {
  tabs: Tab[]
  defaultTab?: string
  persistToUrl?: boolean
  /** Extra class name(s) applied to the tab content panel wrapper */
  contentClassName?: string
  /**
   * Controlled mode: the owner holds the active tab (and any URL sync), and
   * `onTabChange` reports clicks. `persistToUrl` is ignored when set.
   */
  activeTab?: string
  onTabChange?: (tabId: string) => void
  /** Accessible name of the tab strip. */
  ariaLabel?: string
  children: (activeTab: string) => React.ReactNode
}

export function EntityTabs({
  tabs,
  defaultTab,
  persistToUrl = true,
  contentClassName,
  activeTab: controlledTab,
  onTabChange,
  ariaLabel = 'Tabs',
  children,
}: EntityTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tabFromUrl = searchParams.get('tab')
  const fallbackTab = defaultTab || tabs[0]?.id

  // When persistToUrl is true, derive activeTab from URL; otherwise use local state
  const urlTab = tabFromUrl && tabs.some(t => t.id === tabFromUrl) ? tabFromUrl : fallbackTab
  const [localTab, setLocalTab] = useState(fallbackTab)

  const controlled = controlledTab !== undefined
  const activeTab = controlled ? controlledTab : persistToUrl ? urlTab : localTab

  const handleTabChange = (tabId: string) => {
    if (controlled) {
      onTabChange?.(tabId)
    } else if (persistToUrl) {
      const params = new URLSearchParams(searchParams.toString())
      if (tabId === fallbackTab) {
        params.delete('tab')
      } else {
        params.set('tab', tabId)
      }
      // Clear section deep-link when switching tabs
      params.delete('section')
      const newUrl = params.toString() ? `${pathname}?${params}` : pathname
      router.replace(newUrl, { scroll: false })
    } else {
      setLocalTab(tabId)
    }
  }

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
              onClick={() => handleTabChange(tab.id)}
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
