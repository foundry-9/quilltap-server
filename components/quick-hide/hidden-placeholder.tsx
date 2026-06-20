import React from 'react'
import { Icon } from '@/components/ui/icon'

interface HiddenPlaceholderProps {
  label?: string
}

export function HiddenPlaceholder({ label }: HiddenPlaceholderProps) {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed qt-border-default qt-bg-muted/30 px-6 py-8 text-center">
        <Icon name="eye-off" className="h-12 w-12 qt-text-secondary" />
        <div>
          <p className="qt-heading-4 text-foreground">Hidden</p>
          {label && (
            <p className="text-sm qt-text-secondary">
              {label}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
