'use client'

import { useRef } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { clientLogger } from '@/lib/client-logger'
import { ImageProfileForm } from './ImageProfileForm'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  apiKey?: ApiKey | null
}

interface ImageProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  profile?: ImageProfile
  apiKeys: ApiKey[]
}

export function ImageProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
}: ImageProfileModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  useClickOutside(modalRef, onClose, {
    enabled: isOpen,
    onEscape: onClose,
  })

  const handleSuccess = () => {
    clientLogger.debug('Image profile saved via modal', { isEditing: !!profile })
    onSuccess()
    onClose()
  }

  const handleCancel = () => {
    clientLogger.debug('Image profile modal cancelled')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="qt-dialog-overlay">
      <div ref={modalRef} className="qt-dialog max-w-2xl max-h-[90vh] flex flex-col">
        <div className="qt-dialog-header">
          <h2 className="qt-dialog-title">
            {profile ? 'Edit Image Profile' : 'Create Image Profile'}
          </h2>
        </div>

        <div className="qt-dialog-body flex-1 overflow-y-auto">
          <ImageProfileForm
            profile={profile}
            apiKeys={apiKeys}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  )
}

export default ImageProfileModal
