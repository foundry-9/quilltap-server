/**
 * Shared constants and the candidate-grouping helper for the WardrobeItemEditor
 * component picker.
 */

import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import type { CandidateItem, CandidateGroup } from './types'

export const GROUP_LABEL: Record<CandidateGroup, string> = {
  top: 'Tops',
  bottom: 'Bottoms',
  footwear: 'Footwear',
  accessories: 'Accessories',
  multi: 'Multi-slot',
}

export const GROUP_ORDER: CandidateGroup[] = ['top', 'bottom', 'footwear', 'accessories', 'multi']

export const TYPE_BADGE_CLASS: Record<WardrobeItemType, string> = {
  top: 'qt-badge-wardrobe-top',
  bottom: 'qt-badge-wardrobe-bottom',
  footwear: 'qt-badge-wardrobe-footwear',
  accessories: 'qt-badge-wardrobe-accessories',
}

export function getCandidateGroup(c: CandidateItem): CandidateGroup {
  if (c.types.length > 1) return 'multi'
  return (c.types[0] as CandidateGroup) ?? 'multi'
}
