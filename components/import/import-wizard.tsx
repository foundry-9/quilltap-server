'use client'

import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { SpeakerMapper } from './speaker-mapper'
import { MemoryCreationDialog } from './memory-creation-dialog'
import {
  WizardLoadingStep,
  WizardCompleteStep,
} from '@/components/tools/import-export/components'
import {
  parseSTFile,
  createDefaultMappings,
  validateMappings,
  type ParseResult,
  type SpeakerMapping,
} from '@/lib/sillytavern/multi-char-parser'

/**
 * Import wizard steps
 */
type WizardStep = 'file-select' | 'analyzing' | 'mapping' | 'importing' | 'complete'

/**
 * Character/Persona data for dropdowns
 */
interface EntityOption {
  id: string
  name: string
  title?: string | null
}

interface ProfileOption {
  id: string
  name: string
}

/**
 * Import wizard props
 */
interface ImportWizardProps {
  characters: EntityOption[]
  profiles: ProfileOption[]
  onClose: () => void
  onImportComplete: (chatId: string) => void
}

const STEPS = [
  { key: 'file-select', label: 'Select File' },
  { key: 'mapping', label: 'Map Speakers' },
  { key: 'complete', label: 'Complete' },
] as const

function getStepIndex(step: WizardStep): number {
  if (step === 'file-select' || step === 'analyzing') return 0
  if (step === 'mapping' || step === 'importing') return 1
  return 2
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Multi-step import wizard for SillyTavern chats
 */
export function ImportWizard({
  characters,
  profiles,
  onClose,
  onImportComplete,
}: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('file-select')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [mappings, setMappings] = useState<SpeakerMapping[]>([])
  const [defaultProfileId, setDefaultProfileId] = useState<string>(profiles[0]?.id || '')
  const [importedChat, setImportedChat] = useState<any>(null)
  const [showMemoryDialog, setShowMemoryDialog] = useState(false)
  const [createMemories, setCreateMemories] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isProcessing = step === 'analyzing' || step === 'importing'

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setError(null)
    }
  }, [])

  /**
   * Handle file drop
   */
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const file = e.dataTransfer.files?.[0]
    if (file && (file.name.endsWith('.json') || file.name.endsWith('.jsonl'))) {
      setSelectedFile(file)
      setError(null)
    } else if (file) {
      setError('Please select a JSON or JSONL file')
    }
  }, [])

  /**
   * Analyze the selected file
   */
  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return

    setStep('analyzing')
    setError(null)

    try {
      const content = await selectedFile.text()
      const result = parseSTFile(content, selectedFile.name)

      setParseResult(result)

      // Create default mappings based on existing entities
      const defaultMappings = createDefaultMappings(
        result.speakers,
        characters,
      )
      setMappings(defaultMappings)

      setStep('mapping')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to parse file')
      setError(errorMessage)
      setStep('file-select')
      console.error('Error analyzing file', { error: errorMessage })
    }
  }, [selectedFile, characters])

  /**
   * Update a single mapping
   */
  const handleMappingChange = useCallback((index: number, updates: Partial<SpeakerMapping>) => {
    setMappings(prev => {
      const newMappings = [...prev]
      newMappings[index] = { ...newMappings[index], ...updates }
      return newMappings
    })
  }, [])

  /**
   * Execute the import
   */
  const handleImport = useCallback(async () => {
    if (!parseResult || mappings.length === 0 || !defaultProfileId) return

    // Validate mappings
    const validation = validateMappings(mappings, defaultProfileId)
    if (!validation.valid) {
      setError(validation.errors.join('\n'))
      return
    }

    setStep('importing')
    setError(null)

    try {
      // Build chat data in the expected format
      const chatData = {
        messages: parseResult.messages,
        chat_metadata: parseResult.metadata.chatMetadata,
        character_name: parseResult.metadata.characterName,
        user_name: parseResult.metadata.userName,
        create_date: parseResult.metadata.createDate,
      }

      const response = await fetch('/api/v1/chats?action=import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatData,
          mappings,
          defaultConnectionProfileId: defaultProfileId,
          triggerTitleGeneration: true,
          createMemories,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to import chat')
      }

      const imported = await response.json()
      setImportedChat(imported)
      setStep('complete')

      showSuccessToast('Chat imported successfully!')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to import chat')
      setError(errorMessage)
      setStep('mapping')
      showErrorToast(errorMessage)
      console.error('Error importing chat', { error: errorMessage })
    }
  }, [parseResult, mappings, defaultProfileId, createMemories])

  /**
   * Handle memory creation dialog close
   */
  const handleMemoryDialogClose = useCallback(() => {
    setShowMemoryDialog(false)
    if (importedChat?.id) {
      onImportComplete(importedChat.id)
    }
    onClose()
  }, [importedChat, onImportComplete, onClose])

  const handleClose = () => {
    if (!isProcessing) {
      onClose()
    }
  }

  /**
   * Build the completion description
   */
  const getCompletionDescription = (): string => {
    const parts: string[] = []
    parts.push(`Imported ${importedChat?._count?.messages || 0} messages`)
    if (importedChat?.createdEntities?.characters?.length > 0) {
      parts.push(`created ${importedChat.createdEntities.characters.length} new character(s)`)
    }
    if (importedChat?.createdEntities?.personas?.length > 0) {
      parts.push(`created ${importedChat.createdEntities.personas.length} new user character(s)`)
    }
    if (importedChat?.memoryJobCount > 0) {
      parts.push(`queued ${importedChat.memoryJobCount} messages for memory analysis`)
    }
    return parts.join(', ')
  }

  /**
   * Render step content
   */
  const renderStepContent = () => {
    switch (step) {
      case 'file-select':
        return (
          <div className="space-y-4">
            <p className="qt-text-small qt-text-secondary">
              Select a SillyTavern chat file (.json or .jsonl) to import.
            </p>

            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'qt-border-primary qt-bg-primary/10'
                  : selectedFile
                    ? 'qt-border-primary/50 qt-bg-primary/5'
                    : 'qt-border-default hover:qt-border-primary/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true) }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false) }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.jsonl"
                onChange={handleFileSelect}
                className="hidden"
              />
              <svg
                className="w-12 h-12 mx-auto mb-3 qt-text-secondary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-foreground font-medium">
                {selectedFile ? selectedFile.name : 'Drag and drop a chat file here'}
              </p>
              <p className="qt-text-secondary text-sm mt-1">
                {selectedFile
                  ? formatFileSize(selectedFile.size)
                  : 'or click to browse'}
              </p>
            </div>

            {error && (
              <div className="text-sm qt-text-destructive whitespace-pre-wrap">
                {error}
              </div>
            )}
          </div>
        )

      case 'analyzing':
        return <WizardLoadingStep message="Analyzing file..." />

      case 'mapping':
        return (
          <div className="space-y-4">
            {parseResult && (
              <div className="qt-text-small qt-text-secondary">
                Found {parseResult.messages.length} messages from {parseResult.speakers.length} speaker(s)
                {parseResult.isGroupChat && ' (Group Chat)'}
              </div>
            )}

            <SpeakerMapper
              speakers={parseResult?.speakers || []}
              mappings={mappings}
              characters={characters}
              profiles={profiles}
              defaultProfileId={defaultProfileId}
              onMappingChange={handleMappingChange}
              onDefaultProfileChange={setDefaultProfileId}
            />

            {/* Memory creation option */}
            <div className="border rounded-lg p-4 qt-bg-muted/30">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createMemories}
                  onChange={(e) => setCreateMemories(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="text-foreground font-medium">Analyze messages for memories</div>
                  <div className="qt-text-small qt-text-secondary">
                    Queue each message for AI analysis to extract meaningful memories in the background
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <div className="text-sm qt-text-destructive whitespace-pre-wrap">
                {error}
              </div>
            )}
          </div>
        )

      case 'importing':
        return <WizardLoadingStep message="Importing chat..." />

      case 'complete':
        return (
          <WizardCompleteStep
            title="Import Complete!"
            description={getCompletionDescription()}
          />
        )
    }
  }

  /**
   * Render footer buttons based on step
   */
  const renderFooter = () => {
    switch (step) {
      case 'file-select':
        return (
          <>
            <button
              type="button"
              onClick={handleClose}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!selectedFile}
              className="qt-button qt-button-primary"
            >
              Analyze File
            </button>
          </>
        )

      case 'mapping':
        return (
          <>
            <button
              type="button"
              onClick={() => {
                setStep('file-select')
                setParseResult(null)
                setMappings([])
              }}
              className="qt-button qt-button-secondary"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!defaultProfileId || mappings.length === 0}
              className="qt-button qt-button-primary"
            >
              Import Chat
            </button>
          </>
        )

      case 'complete':
        return (
          <>
            {!importedChat?.memoryJobCount && (
              <button
                type="button"
                onClick={() => setShowMemoryDialog(true)}
                className="qt-button qt-button-secondary"
              >
                Analyze for Memories...
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (importedChat?.id) {
                  onImportComplete(importedChat.id)
                }
                onClose()
              }}
              className="qt-button qt-button-primary"
            >
              Done
            </button>
          </>
        )

      default:
        return null
    }
  }

  if (typeof document === 'undefined') return null

  const currentStepIndex = getStepIndex(step)

  return createPortal(
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none"
        onClick={handleClose}
        disabled={isProcessing}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[61] pointer-events-auto w-[90vw] max-w-2xl">
        <div className="qt-dialog w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="qt-dialog-title">Import SillyTavern Chat</h2>
                <p className="qt-dialog-description mt-0.5">
                  Step {currentStepIndex + 1} of {STEPS.length}
                </p>
              </div>
              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="qt-text-secondary hover:text-foreground disabled:opacity-50"
                aria-label="Close dialog"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-1 mt-4">
              {STEPS.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1 flex-1">
                  <div className="flex items-center gap-2 flex-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center qt-text-label-xs flex-shrink-0 transition-colors ${
                        i < currentStepIndex
                          ? 'bg-primary text-primary-foreground'
                          : i === currentStepIndex
                            ? 'bg-primary text-primary-foreground'
                            : 'qt-bg-muted qt-text-secondary'
                      }`}
                    >
                      {i < currentStepIndex ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span className={`text-xs hidden sm:inline ${
                      i === currentStepIndex ? 'text-foreground font-medium' : 'qt-text-secondary'
                    }`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`h-px flex-1 min-w-4 ${
                      i < currentStepIndex ? 'bg-primary' : 'bg-border'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="qt-dialog-body overflow-y-auto flex-1">
            {renderStepContent()}
          </div>

          {/* Footer */}
          {renderFooter() && (
            <div className="qt-dialog-footer flex-shrink-0">
              {renderFooter()}
            </div>
          )}
        </div>
      </div>

      {showMemoryDialog && importedChat && (
        <MemoryCreationDialog
          chat={importedChat}
          onClose={handleMemoryDialogClose}
        />
      )}
    </>,
    document.body
  )
}
