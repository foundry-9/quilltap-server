'use client'

import { useState, useCallback } from 'react'
import type { LLMLog } from '@/lib/schemas/types'

export interface ReattributeDialogState {
  isOpen: boolean
  messageId: string
  currentParticipantId: string | null
}

export interface FileWriteApprovalState {
  isOpen: boolean
  pendingWrite: {
    filename: string
    content?: string
    mimeType?: string
    folderPath: string
    projectId: string | null
  }
  projectName?: string
  /** The participant ID that made the write request, so we can trigger them to continue */
  respondingParticipantId?: string
}

export interface SudoApprovalState {
  isOpen: boolean
  pendingSudoCommand: {
    command: string
    parameters?: string[]
    timeout_ms?: number
  }
  /** The participant ID that made the sudo request, so we can trigger them to continue */
  respondingParticipantId?: string
}

export interface WorkspaceAcknowledgementState {
  isOpen: boolean
  /** The tool name that triggered the acknowledgement requirement */
  toolName?: string
  /** The participant ID, so we can trigger them to continue */
  respondingParticipantId?: string
}

export interface SelectLLMProfileDialogState {
  isOpen: boolean
  participantId: string
  character: {
    id: string
    name: string
    defaultImage?: { id: string; filepath: string; url?: string } | null
    avatarUrl?: string | null
    defaultConnectionProfileId?: string | null
  } | null
}

export function useModalState() {
  // Simple boolean modals
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [toolPaletteOpen, setToolPaletteOpen] = useState(false)
  const [chatSettingsModalOpen, setChatSettingsModalOpen] = useState(false)
  const [chatProjectModalOpen, setChatProjectModalOpen] = useState(false)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [searchReplaceModalOpen, setSearchReplaceModalOpen] = useState(false)
  const [bulkReplaceModalOpen, setBulkReplaceModalOpen] = useState(false)
  const [toolSettingsModalOpen, setToolSettingsModalOpen] = useState(false)
  const [runToolModalOpen, setRunToolModalOpen] = useState(false)
  const [stateEditorModalOpen, setStateEditorModalOpen] = useState(false)
  const [allLLMPauseModalOpen, setAllLLMPauseModalOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)

  // Complex modal states
  const [modalImage, setModalImage] = useState<{ src: string; filename: string; fileId?: string } | null>(null)
  const [reattributeDialogState, setReattributeDialogState] = useState<ReattributeDialogState | null>(null)
  const [fileWriteApprovalState, setFileWriteApprovalState] = useState<FileWriteApprovalState | null>(null)
  const [selectLLMProfileDialogState, setSelectLLMProfileDialogState] = useState<SelectLLMProfileDialogState | null>(null)
  const [sudoApprovalState, setSudoApprovalState] = useState<SudoApprovalState | null>(null)
  const [workspaceAcknowledgementState, setWorkspaceAcknowledgementState] = useState<WorkspaceAcknowledgementState | null>(null)

  // LLM log viewer state
  const [llmLogViewerOpen, setLLMLogViewerOpen] = useState(false)
  const [llmLogsForViewer, setLLMLogsForViewer] = useState<LLMLog[]>([])
  const [selectedMessageIdForLogs, setSelectedMessageIdForLogs] = useState<string | null>(null)

  // Convenience open/close helpers
  const openGallery = useCallback(() => setGalleryOpen(true), [])
  const closeGallery = useCallback(() => setGalleryOpen(false), [])
  const openChatSettings = useCallback(() => setChatSettingsModalOpen(true), [])
  const closeChatSettings = useCallback(() => setChatSettingsModalOpen(false), [])
  const openChatProject = useCallback(() => setChatProjectModalOpen(true), [])
  const closeChatProject = useCallback(() => setChatProjectModalOpen(false), [])
  const openRename = useCallback(() => setRenameModalOpen(true), [])
  const closeRename = useCallback(() => setRenameModalOpen(false), [])
  const openGenerateImage = useCallback(() => setGenerateImageDialogOpen(true), [])
  const closeGenerateImage = useCallback(() => setGenerateImageDialogOpen(false), [])
  const openAddCharacter = useCallback(() => setAddCharacterDialogOpen(true), [])
  const closeAddCharacter = useCallback(() => setAddCharacterDialogOpen(false), [])
  const openSearchReplace = useCallback(() => setSearchReplaceModalOpen(true), [])
  const closeSearchReplace = useCallback(() => setSearchReplaceModalOpen(false), [])
  const openBulkReplace = useCallback(() => setBulkReplaceModalOpen(true), [])
  const closeBulkReplace = useCallback(() => setBulkReplaceModalOpen(false), [])
  const openToolSettings = useCallback(() => setToolSettingsModalOpen(true), [])
  const closeToolSettings = useCallback(() => setToolSettingsModalOpen(false), [])
  const openRunTool = useCallback(() => setRunToolModalOpen(true), [])
  const closeRunTool = useCallback(() => setRunToolModalOpen(false), [])
  const openStateEditor = useCallback(() => setStateEditorModalOpen(true), [])
  const closeStateEditor = useCallback(() => setStateEditorModalOpen(false), [])

  const closeLLMLogViewer = useCallback(() => {
    setLLMLogViewerOpen(false)
    setLLMLogsForViewer([])
    setSelectedMessageIdForLogs(null)
  }, [])

  return {
    // Simple boolean modals
    galleryOpen, setGalleryOpen,
    toolPaletteOpen, setToolPaletteOpen,
    chatSettingsModalOpen,
    chatProjectModalOpen,
    renameModalOpen,
    generateImageDialogOpen,
    addCharacterDialogOpen,
    searchReplaceModalOpen,
    bulkReplaceModalOpen,
    toolSettingsModalOpen,
    runToolModalOpen,
    stateEditorModalOpen,
    allLLMPauseModalOpen, setAllLLMPauseModalOpen,
    showPreview, setShowPreview,
    showParticipantSidebar, setShowParticipantSidebar,

    // Complex modal states
    modalImage, setModalImage,
    reattributeDialogState, setReattributeDialogState,
    fileWriteApprovalState, setFileWriteApprovalState,
    selectLLMProfileDialogState, setSelectLLMProfileDialogState,
    sudoApprovalState, setSudoApprovalState,
    workspaceAcknowledgementState, setWorkspaceAcknowledgementState,

    // LLM log viewer state
    llmLogViewerOpen,
    llmLogsForViewer, setLLMLogsForViewer,
    selectedMessageIdForLogs, setSelectedMessageIdForLogs,

    // Convenience helpers
    openGallery, closeGallery,
    openChatSettings, closeChatSettings,
    openChatProject, closeChatProject,
    openRename, closeRename,
    openGenerateImage, closeGenerateImage,
    openAddCharacter, closeAddCharacter,
    openSearchReplace, closeSearchReplace,
    openBulkReplace, closeBulkReplace,
    openToolSettings, closeToolSettings,
    openRunTool, closeRunTool,
    openStateEditor, closeStateEditor,
    closeLLMLogViewer,
    setLLMLogViewerOpen,
  }
}
