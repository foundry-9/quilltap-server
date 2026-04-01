/**
 * AI Wizard Types
 *
 * Type definitions for the character AI wizard feature.
 */

import type { ConnectionProfile } from '@/lib/schemas/types'

// ============================================================================
// WIZARD STATE
// ============================================================================

export type WizardStep = 1 | 2 | 3 | 4

export type DescriptionSourceType = 'existing' | 'upload' | 'gallery' | 'document' | 'skip'

export type GeneratableField =
  | 'name'
  | 'title'
  | 'description'
  | 'personality'
  | 'scenario'
  | 'exampleDialogues'
  | 'systemPrompt'
  | 'physicalDescription'

export interface GenerationProgress {
  currentField: GeneratableField | null
  completedFields: GeneratableField[]
  snippets: Record<string, string>
  errors: Record<string, string>
}

export interface GeneratedPhysicalDescription {
  name: string
  shortPrompt: string
  mediumPrompt: string
  longPrompt: string
  completePrompt: string
  fullDescription: string
}

export interface GeneratedCharacterData {
  name?: string
  title?: string
  description?: string
  personality?: string
  scenario?: string
  exampleDialogues?: string
  systemPrompt?: string
  physicalDescription?: GeneratedPhysicalDescription
}

export interface AIWizardState {
  isOpen: boolean
  currentStep: WizardStep

  // Step 1: Profile Selection
  primaryProfileId: string
  profiles: ConnectionProfile[]
  loadingProfiles: boolean

  // Step 2: Description Source
  descriptionSource: DescriptionSourceType
  uploadedImageId: string | null
  uploadedImageUrl: string | null
  selectedGalleryImageId: string | null
  selectedGalleryImageUrl: string | null
  uploadedDocumentId: string | null
  uploadedDocumentName: string | null
  visionProfileId: string | null
  needsVisionProfile: boolean

  // Step 3: Field Selection + Background
  backgroundText: string
  selectedFields: Set<GeneratableField>
  availableFields: GeneratableField[]

  // Step 4: Generation
  generating: boolean
  generationProgress: GenerationProgress
  generatedData: GeneratedCharacterData | null

  // General
  error: string | null
}

// ============================================================================
// API TYPES
// ============================================================================

export interface AIWizardRequest {
  primaryProfileId: string
  visionProfileId?: string

  sourceType: DescriptionSourceType
  imageId?: string
  documentId?: string

  characterName: string
  existingData?: {
    title?: string
    description?: string
    personality?: string
    scenario?: string
    exampleDialogues?: string
    systemPrompt?: string
  }

  background: string

  fieldsToGenerate: GeneratableField[]

  characterId?: string
}

export interface AIWizardResponse {
  success: boolean
  generated: GeneratedCharacterData
  errors?: Record<string, string>
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export interface AIWizardModalProps {
  isOpen: boolean
  onClose: () => void
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
}

export interface ProfileSelectionStepProps {
  profiles: ConnectionProfile[]
  loading: boolean
  selectedProfileId: string
  onSelectProfile: (profileId: string) => void
  error: string | null
}

export interface DescriptionSourceStepProps {
  source: DescriptionSourceType
  onSourceChange: (source: DescriptionSourceType) => void
  uploadedImageId: string | null
  uploadedImageUrl: string | null
  onImageUpload: (imageId: string, imageUrl: string) => void
  selectedGalleryImageId: string | null
  selectedGalleryImageUrl: string | null
  onGallerySelect: (imageId: string, imageUrl: string) => void
  uploadedDocumentId: string | null
  uploadedDocumentName: string | null
  onDocumentUpload: (documentId: string, documentName: string) => void
  needsVisionProfile: boolean
  visionProfileId: string | null
  visionProfiles: ConnectionProfile[]
  onVisionProfileSelect: (profileId: string) => void
  characterId?: string
}

export interface FieldSelectionStepProps {
  backgroundText: string
  onBackgroundChange: (text: string) => void
  availableFields: GeneratableField[]
  selectedFields: Set<GeneratableField>
  onFieldToggle: (field: GeneratableField) => void
  currentData: Record<string, string | undefined>
  canGeneratePhysicalDescription: boolean
}

export interface GenerationStepProps {
  generating: boolean
  progress: GenerationProgress
  generatedData: GeneratedCharacterData | null
  onRetry: (field: GeneratableField) => void
  onApply: () => void
  onClose: () => void
}

// ============================================================================
// FIELD METADATA
// ============================================================================

export const FIELD_LABELS: Record<GeneratableField, string> = {
  name: 'Name',
  title: 'Title',
  description: 'Description',
  personality: 'Personality',
  scenario: 'Scenario',
  exampleDialogues: 'Example Dialogues',
  systemPrompt: 'System Prompt',
  physicalDescription: 'Physical Description',
}

export const FIELD_DESCRIPTIONS: Record<GeneratableField, string> = {
  name: 'The character\'s name',
  title: 'A short epithet or title (e.g., "The Wanderer")',
  description: 'Character appearance, background, and key traits',
  personality: 'Personality traits and behavioral patterns',
  scenario: 'Setting and context for conversations',
  exampleDialogues: 'Example conversations to guide AI responses',
  systemPrompt: 'Custom system instructions for AI roleplay',
  physicalDescription: 'Detailed physical description for image generation',
}
