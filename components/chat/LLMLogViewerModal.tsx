'use client'

import { useState, useMemo } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import type { LLMLog } from '@/lib/schemas/types'
import { RequestTab, ResponseTab, UsageTab } from '@/components/chat/LLMInspectorEntry'

interface LLMLogViewerModalProps {
  isOpen: boolean
  onClose: () => void
  logs: LLMLog[]
}

type TabType = 'request' | 'response' | 'usage'

export default function LLMLogViewerModal({
  isOpen,
  onClose,
  logs,
}: Readonly<LLMLogViewerModalProps>) {
  const [activeTab, setActiveTab] = useState<TabType>('request')
  const [selectedLogIndex, setSelectedLogIndex] = useState(0)

  // Ensure selectedLogIndex is valid for current logs
  const safeLogIndex = useMemo(() => {
    if (logs.length === 0) return 0
    return Math.min(selectedLogIndex, logs.length - 1)
  }, [selectedLogIndex, logs.length])

  if (!isOpen || logs.length === 0) return null

  const currentLog = logs[safeLogIndex]

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="LLM Request/Response Log"
      maxWidth="3xl"
      showCloseButton
      className="flex flex-col"
    >
      <div className="flex flex-col h-full">
        {/* Log selector if multiple logs */}
        {logs.length > 1 && (
          <div className="px-4 py-3 border-b qt-border mb-4">
            <label htmlFor="log-select" className="block text-sm qt-text-secondary mb-2">
              Select Log
            </label>
            <select
              id="log-select"
              value={safeLogIndex}
              onChange={(e) => setSelectedLogIndex(parseInt(e.target.value, 10))}
              className="w-full qt-input"
            >
              {logs.map((log, index) => (
                <option key={log.id} value={index}>
                  {new Date(log.createdAt).toLocaleTimeString()} - {log.type} ({log.provider}/{log.modelName})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Log metadata */}
        <div className="px-4 py-2 border-b qt-border text-xs qt-text-secondary">
          {new Date(currentLog.createdAt).toLocaleString()}
        </div>

        {/* Tabs */}
        <div className="flex border-b qt-border">
          {(['request', 'response', 'usage'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 qt-label transition-colors border-b-2 ${
                activeTab === tab
                  ? 'qt-border-primary qt-text'
                  : 'border-transparent qt-text-secondary hover:qt-text'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 text-sm">
          {activeTab === 'request' && <RequestTab log={currentLog} />}
          {activeTab === 'response' && <ResponseTab log={currentLog} />}
          {activeTab === 'usage' && <UsageTab log={currentLog} />}
        </div>
      </div>
    </BaseModal>
  )
}
