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
  children: (activeTab: string) => React.ReactNode
}

export function EntityTabs({ tabs, defaultTab, persistToUrl = true, contentClassName, children }: EntityTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tabFromUrl = searchParams.get('tab')
  const fallbackTab = defaultTab || tabs[0]?.id

  // When persistToUrl is true, derive activeTab from URL; otherwise use local state
  const urlTab = tabFromUrl && tabs.some(t => t.id === tabFromUrl) ? tabFromUrl : fallbackTab
  const [localTab, setLocalTab] = useState(fallbackTab)

  const activeTab = persistToUrl ? urlTab : localTab

  const handleTabChange = (tabId: string) => {
    if (persistToUrl) {
      const params = new URLSearchParams(searchParams.toString())
      if (tabId === fallbackTab) {
        params.delete('tab')
      } else {
        params.set('tab', tabId)
      }
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
        <nav className="qt-tab-group" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`qt-tab ${activeTab === tab.id ? 'qt-tab-active' : ''}`}
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
