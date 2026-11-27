'use client'

import { BaseModal } from '@/components/ui/BaseModal'
import { ImageProfileForm } from './ImageProfileForm'
import type { ApiKeyRow, ImageProfileRow } from '@/lib/hooks/use-profiles'


interface ImageProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  profile?: ImageProfileRow
  apiKeys: ApiKeyRow[]
  /** Provider to preselect on a new profile (the per-provider card's Add menu). */
  initialProvider?: string
}

export function ImageProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
  initialProvider,
}: ImageProfileModalProps) {
  const handleSuccess = () => {
    onSuccess()
    onClose()
  }

  const handleCancel = () => {
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
        initialProvider={initialProvider}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </BaseModal>
  )
}

export default ImageProfileModal
