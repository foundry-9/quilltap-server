'use client'

/**
 * Project Tabs
 *
 * Tab navigation for project detail page.
 */

import type { TabType } from '../types'

interface ProjectTabsProps {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
  chatCount: number
  fileCount: number
  characterCount: number
}

const TABS: TabType[] = ['chats', 'files', 'characters', 'settings']

export function ProjectTabs({ activeTab, onTabChange, chatCount, fileCount, characterCount }: ProjectTabsProps) {
  const getTabLabel = (tab: TabType): string => {
    const base = tab.charAt(0).toUpperCase() + tab.slice(1)
    switch (tab) {
      case 'chats': return `${base} (${chatCount})`
      case 'files': return `${base} (${fileCount})`
      case 'characters': return `${base} (${characterCount})`
      default: return base
    }
  }

  return (
    <div className="flex gap-4 border-b qt-border-default/60 mt-6">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === tab
              ? 'qt-border-primary text-primary'
              : 'border-transparent qt-text-secondary hover:text-foreground'
          }`}
        >
          {getTabLabel(tab)}
        </button>
      ))}
    </div>
  )
}
