'use client'

/**
 * ModelPicker
 *
 * A small inline dropdown for choosing the Brahma Console's connection profile
 * (model). Placed in the dialog header so the operator can switch engines at
 * any time without leaving the conversation — the same chat continues with the
 * new model. Shows provider + model so it's clear which engine is live.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { BrahmaConnectionProfile } from '@/components/providers/brahma-console-provider'

interface ModelPickerProps {
  profiles: BrahmaConnectionProfile[]
  activeId: string | null
  onSelect: (id: string) => void
  disabled?: boolean
}

export function ModelPicker({ profiles, activeId, onSelect, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const active = profiles.find(p => p.id === activeId) || null

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSelect = useCallback((id: string) => {
    onSelect(id)
    setOpen(false)
  }, [onSelect])

  const label = active ? active.name : 'Choose a model'
  const sublabel = active ? `${active.provider} · ${active.modelName}` : undefined

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || profiles.length === 0}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs qt-hover-accent qt-text-secondary transition-colors max-w-[180px]"
        title={sublabel ? `${label} (${sublabel})` : label}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name="brahma-console" className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{label}</span>
        <Icon name="chevron-down" className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && profiles.length > 0 && (
        <div
          className="absolute right-0 mt-1 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded qt-bg-surface qt-border-default border shadow-lg py-1"
          role="listbox"
        >
          {profiles.map(profile => {
            const isActive = profile.id === activeId
            return (
              <button
                key={profile.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(profile.id)}
                className="flex items-start gap-2 w-full px-3 py-1.5 text-left text-xs qt-hover-accent transition-colors"
              >
                <Icon
                  name="check"
                  className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isActive ? '' : 'opacity-0'}`}
                />
                <span className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{profile.name}</span>
                  <span className="truncate qt-text-secondary">{profile.provider} · {profile.modelName}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
