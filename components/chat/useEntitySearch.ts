'use client'

import { useState, useEffect, useRef } from 'react'
import { showErrorToast } from '@/lib/toast'
import { useClickOutside } from '@/hooks/useClickOutside'

export interface EntityOption {
  id: string
  name: string
  type: 'character'
}

export function useEntitySearch(isOpen: boolean) {
  const [allEntities, setAllEntities] = useState<EntityOption[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadAllEntities = async () => {
    try {
      const charactersRes = await fetch('/api/v1/characters')

      if (!charactersRes.ok) {
        throw new Error('Failed to load characters')
      }

      const charactersData = await charactersRes.json()
      const characters = charactersData.characters || []

      const entities: EntityOption[] = characters.map((c: any) => ({
        id: c.id,
        name: c.name,
        type: 'character' as const,
      }))

      // Sort alphabetically
      entities.sort((a, b) => a.name.localeCompare(b.name))

      setAllEntities(entities)
    } catch (error) {
      console.error('Error loading entities', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to load characters')
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadAllEntities()
    }
  }, [isOpen])

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
