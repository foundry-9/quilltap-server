'use client'

import { useCallback, useState } from 'react'

/**
 * Settings-tab modal state. Captures the common pattern of "open / close /
 * mutate-after-success" with optional payload that's cleared on close.
 *
 * Use the generic parameter when the modal needs to know *which* item it's
 * editing — `openModal(item)` stashes it, `closeModal()` clears it. Pass
 * nothing to `openModal()` for the create-new case.
 *
 * @example
 *   // Simple open/close with refresh on success
 *   const { isOpen, openModal, closeModal, handleSuccess } =
 *     useModalState(() => mutateData())
 *
 * @example
 *   // With an "edit this item" payload
 *   const { isOpen, payload, openModal, closeModal } =
 *     useModalState<Profile>(() => refresh())
 *   // ...
 *   openModal(existingProfile)   // edit
 *   openModal()                   // create
 */
export interface UseModalStateResult<T> {
  isOpen: boolean
  payload: T | null
  openModal: (payload?: T) => void
  closeModal: () => void
  handleSuccess: () => void
}

export function useModalState<T = void>(
  onSuccess?: () => unknown,
): UseModalStateResult<T> {
  const [isOpen, setIsOpen] = useState(false)
  const [payload, setPayload] = useState<T | null>(null)

  const openModal = useCallback((p?: T) => {
    setPayload(p === undefined ? null : p)
    setIsOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setIsOpen(false)
    setPayload(null)
  }, [])

  const handleSuccess = useCallback(() => {
    if (onSuccess) void onSuccess()
  }, [onSuccess])

  return { isOpen, payload, openModal, closeModal, handleSuccess }
}
