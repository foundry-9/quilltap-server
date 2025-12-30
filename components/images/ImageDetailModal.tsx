/**
 * Re-export ImageDetailModal from refactored location
 * This file maintains backward compatibility while the component is refactored
 * into smaller, focused modules in the image-detail directory.
 */
'use client'

export { default } from './image-detail/ImageDetailModal'
export type { ImageDetailModalProps, ImageData, Character } from './image-detail/types'
