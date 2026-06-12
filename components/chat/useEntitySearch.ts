'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
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

  const { data: charactersData } = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) => apiFetch<{ characters: Array<{ id: string; name: string }> }>('/api/v1/characters', { signal }),
    enabled: isOpen,
  })

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
