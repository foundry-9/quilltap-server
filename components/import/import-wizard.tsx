'use client'

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { getErrorMessage } from '@/lib/error-utils'
import { SpeakerMapper } from './speaker-mapper'
import { MemoryCreationDialog } from './memory-creation-dialog'
import {
  parseSTFile,
  createDefaultMappings,
  validateMappings,
  type ParseResult,
  type ParsedSpeaker,
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
  personas: EntityOption[]
  profiles: ProfileOption[]
  onClose: () => void
  onImportComplete: (chatId: string) => void
}

/**
 * Multi-step import wizard for SillyTavern chats
 */
export function ImportWizard({
  characters,
  personas,
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
        personas
      )
      setMappings(defaultMappings)

      setStep('mapping')

      clientLogger.info('File analyzed', {
        filename: selectedFile.name,
        speakerCount: result.speakers.length,
        messageCount: result.messages.length,
        isGroupChat: result.isGroupChat,
      })
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to parse file')
      setError(errorMessage)
      setStep('file-select')
      clientLogger.error('Error analyzing file', { error: errorMessage })
    }
  }, [selectedFile, characters, personas])

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
      clientLogger.info('Chat imported', {
        chatId: imported.id,
        messageCount: imported._count?.messages,
      })
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to import chat')
      setError(errorMessage)
      setStep('mapping')
      showErrorToast(errorMessage)
      clientLogger.error('Error importing chat', { error: errorMessage })
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

  /**
   * Render step content
   */
  const renderStepContent = () => {
    switch (step) {
      case 'file-select':
        return (
          <div className="space-y-4">
            <div>
              <label className="block qt-text-label mb-2">
                Select SillyTavern chat file (JSON or JSONL)
              </label>
              <input
                type="file"
                accept=".json,.jsonl"
                onChange={handleFileSelect}
                className="block w-full qt-text-small file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-primary hover:file:bg-accent/80"
              />
            </div>

            {selectedFile && (
              <div className="qt-text-small">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive whitespace-pre-wrap">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
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
            </div>
          </div>
        )

      case 'analyzing':
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
            <p className="mt-4 text-muted-foreground">Analyzing file...</p>
          </div>
        )

      case 'mapping':
        return (
          <div className="space-y-4">
            {parseResult && (
              <div className="qt-text-small mb-4">
                Found {parseResult.messages.length} messages from {parseResult.speakers.length} speaker(s)
                {parseResult.isGroupChat && ' (Group Chat)'}
              </div>
            )}

            <SpeakerMapper
              speakers={parseResult?.speakers || []}
              mappings={mappings}
              characters={characters}
              personas={personas}
              profiles={profiles}
              defaultProfileId={defaultProfileId}
              onMappingChange={handleMappingChange}
              onDefaultProfileChange={setDefaultProfileId}
            />

            {/* Memory creation option */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createMemories}
                  onChange={(e) => setCreateMemories(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="qt-text-primary">Analyze messages for memories</div>
                  <div className="qt-text-small">
                    Queue each message for AI analysis to extract meaningful memories in the background
                  </div>
                </div>
              </label>
            </div>

            {error && (
              <div className="text-sm text-destructive whitespace-pre-wrap">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end">
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
            </div>
          </div>
        )

      case 'importing':
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
            <p className="mt-4 text-muted-foreground">Importing chat...</p>
          </div>
        )

      case 'complete':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-lg font-medium">Import Complete!</span>
            </div>

            <div className="qt-text-small">
              Imported {importedChat?._count?.messages || 0} messages
              {importedChat?.createdEntities?.characters?.length > 0 && (
                <>, created {importedChat.createdEntities.characters.length} new character(s)</>
              )}
              {importedChat?.createdEntities?.personas?.length > 0 && (
                <>, created {importedChat.createdEntities.personas.length} new persona(s)</>
              )}
              {importedChat?.memoryJobCount > 0 && (
                <>, queued {importedChat.memoryJobCount} messages for memory analysis</>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              {/* Only show memory dialog button if memories weren't already queued */}
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
            </div>
          </div>
        )
    }
  }

  return (
    <>
      <div className="qt-dialog-overlay p-4">
        <div className="qt-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
          <h3 className="qt-dialog-title mb-4">
            Import SillyTavern Chat
          </h3>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6 qt-text-small">
            <span className={step === 'file-select' ? 'text-primary font-medium' : ''}>
              1. Select File
            </span>
            <span>→</span>
            <span className={step === 'mapping' ? 'text-primary font-medium' : ''}>
              2. Map Speakers
            </span>
            <span>→</span>
            <span className={step === 'complete' ? 'text-primary font-medium' : ''}>
              3. Complete
            </span>
          </div>

          {renderStepContent()}
        </div>
      </div>

      {showMemoryDialog && importedChat && (
        <MemoryCreationDialog
          chat={importedChat}
          onClose={handleMemoryDialogClose}
        />
      )}
    </>
  )
}
