'use client'

/**
 * useAIWizard Hook
 *
 * State management for the AI character wizard.
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import { filterProfilesBySupportedMimeType, profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type {
  WizardStep,
  DescriptionSourceType,
  GeneratableField,
  AIWizardState,
  GeneratedCharacterData,
  AIWizardRequest,
  AIWizardResponse,
} from '../types'

interface UseAIWizardProps {
  characterId?: string
  characterName: string
  currentData: {
    title?: string
    description?: string
    personality?: string
    scenario?: string
    exampleDialogues?: string
    systemPrompt?: string
  }
  onApply: (data: GeneratedCharacterData) => void
  onClose: () => void
}

export function useAIWizard({
  characterId,
  characterName,
  currentData,
  onApply,
  onClose,
}: UseAIWizardProps) {
  // State
  const [currentStep, setCurrentStep] = useState<WizardStep>(1)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [primaryProfileId, setPrimaryProfileId] = useState('')
  const [descriptionSource, setDescriptionSource] = useState<DescriptionSourceType>('existing')
  const [uploadedImageId, setUploadedImageId] = useState<string | null>(null)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)
  const [selectedGalleryImageId, setSelectedGalleryImageId] = useState<string | null>(null)
  const [selectedGalleryImageUrl, setSelectedGalleryImageUrl] = useState<string | null>(null)
  const [visionProfileId, setVisionProfileId] = useState<string | null>(null)
  const [backgroundText, setBackgroundText] = useState('')
  const [selectedFields, setSelectedFields] = useState<Set<GeneratableField>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({
    currentField: null as GeneratableField | null,
    completedFields: [] as GeneratableField[],
    errors: {} as Record<string, string>,
  })
  const [generatedData, setGeneratedData] = useState<GeneratedCharacterData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch connection profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        setLoadingProfiles(true)
        const response = await fetch('/api/v1/connection-profiles')
        if (!response.ok) {
          throw new Error('Failed to fetch connection profiles')
        }
        const data = await response.json()
        const profileList = data.profiles || []
        setProfiles(profileList)

        // Auto-select default profile if available
        const defaultProfile = profileList.find((p: ConnectionProfile) => p.isDefault)
        if (defaultProfile) {
          setPrimaryProfileId(defaultProfile.id)
        } else if (profileList.length > 0) {
          setPrimaryProfileId(profileList[0].id)
        }
      } catch (err) {
        console.error('Failed to fetch profiles for AI wizard', {
          error: err instanceof Error ? err.message : String(err),
        })
        setError('Failed to load connection profiles')
      } finally {
        setLoadingProfiles(false)
      }
    }

    fetchProfiles()
  }, [])


  // Computed: Vision-capable profiles
  const visionProfiles = useMemo(() => {
    return filterProfilesBySupportedMimeType(profiles, 'image/jpeg')
  }, [profiles])

  // Computed: Check if primary profile supports vision
  const primaryProfile = useMemo(() => {
    return profiles.find((p) => p.id === primaryProfileId) || null
  }, [profiles, primaryProfileId])

  const primarySupportsVision = useMemo(() => {
    if (!primaryProfile) return false
    return profileSupportsMimeType(primaryProfile, 'image/jpeg')
  }, [primaryProfile])

  // Computed: Needs secondary vision profile?
  const needsVisionProfile = useMemo(() => {
    const isImageSource = descriptionSource === 'upload' || descriptionSource === 'gallery'
    return isImageSource && !primarySupportsVision
  }, [descriptionSource, primarySupportsVision])

  // Computed: Available fields (empty fields that can be generated)
  const availableFields = useMemo((): GeneratableField[] => {
    const fields: GeneratableField[] = []

    if (!currentData.title?.trim()) fields.push('title')
    if (!currentData.description?.trim()) fields.push('description')
    if (!currentData.personality?.trim()) fields.push('personality')
    if (!currentData.scenario?.trim()) fields.push('scenario')
    if (!currentData.exampleDialogues?.trim()) fields.push('exampleDialogues')
    if (!currentData.systemPrompt?.trim()) fields.push('systemPrompt')

    // Physical description is available if not skipping
    if (descriptionSource !== 'skip') {
      fields.push('physicalDescription')
    }

    return fields
  }, [currentData, descriptionSource])

  // Computed: Can proceed to next step?
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1:
        return !!primaryProfileId
      case 2:
        if (descriptionSource === 'skip' || descriptionSource === 'existing') {
          return true
        }
        if (descriptionSource === 'upload') {
          const hasImage = !!uploadedImageId
          const hasVisionIfNeeded = !needsVisionProfile || !!visionProfileId
          return hasImage && hasVisionIfNeeded
        }
        if (descriptionSource === 'gallery') {
          const hasImage = !!selectedGalleryImageId
          const hasVisionIfNeeded = !needsVisionProfile || !!visionProfileId
          return hasImage && hasVisionIfNeeded
        }
        return false
      case 3:
        return selectedFields.size > 0
      case 4:
        return true
      default:
        return false
    }
  }, [
    currentStep,
    primaryProfileId,
    descriptionSource,
    uploadedImageId,
    selectedGalleryImageId,
    needsVisionProfile,
    visionProfileId,
    selectedFields,
  ])

  // Actions
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step)
    setError(null)
  }, [])

  const nextStep = useCallback(() => {
    if (currentStep < 4) {
      setCurrentStep((prev) => (prev + 1) as WizardStep)
      setError(null)
    }
  }, [currentStep])

  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep)
      setError(null)
    }
  }, [currentStep])

  const handleImageUpload = useCallback((imageId: string, imageUrl: string) => {
    setUploadedImageId(imageId)
    setUploadedImageUrl(imageUrl)
  }, [])

  const handleGallerySelect = useCallback((imageId: string, imageUrl: string) => {
    setSelectedGalleryImageId(imageId)
    setSelectedGalleryImageUrl(imageUrl)
  }, [])

  const toggleField = useCallback((field: GeneratableField) => {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
      } else {
        next.add(field)
      }
      return next
    })
  }, [])

  const selectAllFields = useCallback(() => {
    setSelectedFields(new Set(availableFields))
  }, [availableFields])

  const clearAllFields = useCallback(() => {
    setSelectedFields(new Set())
  }, [])

  // Generate content
  const startGeneration = useCallback(async () => {
    if (selectedFields.size === 0) {
      setError('Please select at least one field to generate')
      return
    }

    setGenerating(true)
    setError(null)
    setGenerationProgress({
      currentField: null,
      completedFields: [],
      errors: {},
    })

    try {
      // Determine image ID if using image source
      let imageId: string | undefined
      if (descriptionSource === 'upload' && uploadedImageId) {
        imageId = uploadedImageId
      } else if (descriptionSource === 'gallery' && selectedGalleryImageId) {
        imageId = selectedGalleryImageId
      }

      const request: AIWizardRequest = {
        primaryProfileId,
        visionProfileId: needsVisionProfile ? visionProfileId ?? undefined : undefined,
        sourceType: descriptionSource,
        imageId,
        characterName,
        existingData: currentData,
        background: backgroundText,
        fieldsToGenerate: Array.from(selectedFields),
        characterId,
      }

      const response = await fetch('/api/v1/characters?action=ai-wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const result: AIWizardResponse = await response.json()

      if (!response.ok) {
        throw new Error((result as { error?: string }).error || 'Generation failed')
      }

      setGeneratedData(result.generated)
      setGenerationProgress({
        currentField: null,
        completedFields: Array.from(selectedFields),
        errors: result.errors || {},
      })
    } catch (err) {
      let errorMessage = 'Generation failed'
      if (err instanceof Error) {
        errorMessage = err.message
      } else if (typeof err === 'string') {
        errorMessage = err
      }
      setError(errorMessage)
      console.error('AI Wizard generation failed', { error: errorMessage, rawError: String(err) })
    } finally {
      setGenerating(false)
    }
  }, [
    selectedFields,
    characterName,
    descriptionSource,
    uploadedImageId,
    selectedGalleryImageId,
    primaryProfileId,
    needsVisionProfile,
    visionProfileId,
    currentData,
    backgroundText,
    characterId,
  ])

  // Apply generated data
  const applyGenerated = useCallback(() => {
    if (generatedData) {
      onApply(generatedData)
      onClose()
    }
  }, [generatedData, onApply, onClose])

  // Reset wizard
  const reset = useCallback(() => {
    setCurrentStep(1)
    setDescriptionSource('existing')
    setUploadedImageId(null)
    setUploadedImageUrl(null)
    setSelectedGalleryImageId(null)
    setSelectedGalleryImageUrl(null)
    setVisionProfileId(null)
    setBackgroundText('')
    setSelectedFields(new Set())
    setGenerating(false)
    setGenerationProgress({
      currentField: null,
      completedFields: [],
      errors: {},
    })
    setGeneratedData(null)
    setError(null)
  }, [])

  return {
    // State
    currentStep,
    profiles,
    loadingProfiles,
    primaryProfileId,
    primaryProfile,
    descriptionSource,
    uploadedImageId,
    uploadedImageUrl,
    selectedGalleryImageId,
    selectedGalleryImageUrl,
    visionProfileId,
    visionProfiles,
    needsVisionProfile,
    primarySupportsVision,
    backgroundText,
    selectedFields,
    availableFields,
    generating,
    generationProgress,
    generatedData,
    error,
    canProceed,

    // Actions
    goToStep,
    nextStep,
    prevStep,
    setPrimaryProfileId,
    setDescriptionSource,
    handleImageUpload,
    handleGallerySelect,
    setVisionProfileId,
    setBackgroundText,
    toggleField,
    selectAllFields,
    clearAllFields,
    startGeneration,
    applyGenerated,
    reset,
  }
}
