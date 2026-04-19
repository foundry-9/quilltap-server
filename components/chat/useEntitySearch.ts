'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useClickOutside } from '@/hooks/useClickOutside'

export interface EntityOption {
  id: string
  name: string
  type: 'character'
}

export function useEntitySearch(isOpen: boolean) {
  const [searchTerm, setSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: charactersData } = useSWR<{ characters: Array<{ id: string; name: string }> }>(
    isOpen ? '/api/v1/characters' : null
  )

  const allEntities: EntityOption[] = charactersData?.characters
    ? charactersData.characters
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: 'character' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    : []

  const filteredEntities = allEntities.filter(e =>
    e.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleEntitySelect = (entity: EntityOption, onInsert: (name: string) => void) => {
    onInsert(entity.name)
    setIsDropdownOpen(false)
    setSearchTerm('')
  }

  useClickOutside(dropdownRef, () => setIsDropdownOpen(false), {
    enabled: isDropdownOpen,
  })

  return {
    filteredEntities,
    searchTerm,
    setSearchTerm,
    isDropdownOpen,
    setIsDropdownOpen,
    dropdownRef,
    handleEntitySelect,
  }
}
