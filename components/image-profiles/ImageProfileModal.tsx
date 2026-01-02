'use client'

import { clientLogger } from '@/lib/client-logger'
import { BaseModal } from '@/components/ui/BaseModal'
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
  const handleSuccess = () => {
    clientLogger.debug('Image profile saved via modal', { isEditing: !!profile })
    onSuccess()
    onClose()
  }

  const handleCancel = () => {
    clientLogger.debug('Image profile modal cancelled')
    onClose()
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleCancel}
      title={profile ? 'Edit Image Profile' : 'Create Image Profile'}
      maxWidth="2xl"
    >
      <ImageProfileForm
        profile={profile}
        apiKeys={apiKeys}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </BaseModal>
  )
}

export default ImageProfileModal
