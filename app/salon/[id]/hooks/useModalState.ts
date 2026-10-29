'use client'

import { useState, useCallback } from 'react'

export interface ReattributeDialogState {
  isOpen: boolean
  messageId: string
  currentParticipantId: string | null
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

/**
 * What the Run Tool dialog was asked to open onto. `toolId` null is the plain
 * list; the nonce changes on every request so the same tool can be re-selected.
 */
export interface RunToolRequest {
  toolId: string | null
  nonce: number
}

/** What Pascal's custom-tool dialog was asked to open onto. */
export interface CustomToolRequest {
  tool: { name: string; asCharacterId: string | null } | null
  nonce: number
}

export function useModalState() {
  // Simple boolean modals
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [chatProjectModalOpen, setChatProjectModalOpen] = useState(false)
  const [continueChatModalOpen, setContinueChatModalOpen] = useState(false)
  const [mergeConversationModalOpen, setMergeConversationModalOpen] = useState(false)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [generateImageDialogOpen, setGenerateImageDialogOpen] = useState(false)
  const [addCharacterDialogOpen, setAddCharacterDialogOpen] = useState(false)
  const [searchReplaceModalOpen, setSearchReplaceModalOpen] = useState(false)
  const [bulkReplaceModalOpen, setBulkReplaceModalOpen] = useState(false)
  const [toolSettingsModalOpen, setToolSettingsModalOpen] = useState(false)
  const [runToolModalOpen, setRunToolModalOpen] = useState(false)
  const [runToolRequest, setRunToolRequest] = useState<RunToolRequest>({ toolId: null, nonce: 0 })
  const [customToolDialogOpen, setCustomToolDialogOpen] = useState(false)
  const [customToolRequest, setCustomToolRequest] = useState<CustomToolRequest>({ tool: null, nonce: 0 })
  const [stateEditorModalOpen, setStateEditorModalOpen] = useState(false)
  const [allLLMPauseModalOpen, setAllLLMPauseModalOpen] = useState(false)
  const [libraryFilePickerOpen, setLibraryFilePickerOpen] = useState(false)
  const [standaloneGenerateImageOpen, setStandaloneGenerateImageOpen] = useState(false)
  const [insertAnnouncementOpen, setInsertAnnouncementOpen] = useState(false)
  const [composeMailOpen, setComposeMailOpen] = useState(false)
  const [informOpen, setInformOpen] = useState(false)
  const [editEnclaveModalOpen, setEditEnclaveModalOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showParticipantSidebar, setShowParticipantSidebar] = useState(true)

  // Complex modal states
  const [modalImage, setModalImage] = useState<{ src: string; filename: string; fileId?: string } | null>(null)
  const [reattributeDialogState, setReattributeDialogState] = useState<ReattributeDialogState | null>(null)
  const [selectLLMProfileDialogState, setSelectLLMProfileDialogState] = useState<SelectLLMProfileDialogState | null>(null)


  // Convenience open/close helpers
  const openGallery = useCallback(() => setGalleryOpen(true), [])
  const closeGallery = useCallback(() => setGalleryOpen(false), [])
  const openChatProject = useCallback(() => setChatProjectModalOpen(true), [])
  const closeChatProject = useCallback(() => setChatProjectModalOpen(false), [])
  const openContinueChat = useCallback(() => setContinueChatModalOpen(true), [])
  const closeContinueChat = useCallback(() => setContinueChatModalOpen(false), [])
  const openMergeConversation = useCallback(() => setMergeConversationModalOpen(true), [])
  const closeMergeConversation = useCallback(() => setMergeConversationModalOpen(false), [])
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
  /** Open Run Tool — on a tool's form when `toolId` is given (the `/` commands), else on the list. */
  const openRunTool = useCallback((toolId?: string) => {
    setRunToolRequest(prev => ({ toolId: typeof toolId === 'string' ? toolId : null, nonce: prev.nonce + 1 }))
    setRunToolModalOpen(true)
  }, [])
  const closeRunTool = useCallback(() => setRunToolModalOpen(false), [])
  /**
   * Open Pascal's table — on a tool's form when `initial` is given. Without one
   * the dialog lands wherever it remembers being (its own memory, untouched).
   */
  const openCustomTool = useCallback((initial?: { name: string; asCharacterId: string | null }) => {
    setCustomToolRequest(prev => ({ tool: initial ?? null, nonce: prev.nonce + 1 }))
    setCustomToolDialogOpen(true)
  }, [])
  const closeCustomTool = useCallback(() => setCustomToolDialogOpen(false), [])
  const openStateEditor = useCallback(() => setStateEditorModalOpen(true), [])
  const closeStateEditor = useCallback(() => setStateEditorModalOpen(false), [])
  const openLibraryFilePicker = useCallback(() => setLibraryFilePickerOpen(true), [])
  const closeLibraryFilePicker = useCallback(() => setLibraryFilePickerOpen(false), [])
  const openStandaloneGenerateImage = useCallback(() => setStandaloneGenerateImageOpen(true), [])
  const closeStandaloneGenerateImage = useCallback(() => setStandaloneGenerateImageOpen(false), [])
  const openInsertAnnouncement = useCallback(() => setInsertAnnouncementOpen(true), [])
  const closeInsertAnnouncement = useCallback(() => setInsertAnnouncementOpen(false), [])
  const openComposeMail = useCallback(() => setComposeMailOpen(true), [])
  const closeComposeMail = useCallback(() => setComposeMailOpen(false), [])
  const openInform = useCallback(() => setInformOpen(true), [])
  const closeInform = useCallback(() => setInformOpen(false), [])
  const openEditEnclave = useCallback(() => setEditEnclaveModalOpen(true), [])
  const closeEditEnclave = useCallback(() => setEditEnclaveModalOpen(false), [])

  return {
    // Simple boolean modals
    galleryOpen, setGalleryOpen,
    chatProjectModalOpen,
    continueChatModalOpen,
    mergeConversationModalOpen,
    renameModalOpen,
    generateImageDialogOpen,
    addCharacterDialogOpen,
    searchReplaceModalOpen,
    bulkReplaceModalOpen,
    toolSettingsModalOpen,
    runToolModalOpen,
    runToolRequest,
    customToolDialogOpen,
    customToolRequest,
    stateEditorModalOpen,
    allLLMPauseModalOpen, setAllLLMPauseModalOpen,
    showPreview, setShowPreview,
    showParticipantSidebar, setShowParticipantSidebar,

    // Complex modal states
    modalImage, setModalImage,
    reattributeDialogState, setReattributeDialogState,
    selectLLMProfileDialogState, setSelectLLMProfileDialogState,

    // Convenience helpers
    openGallery, closeGallery,
    openChatProject, closeChatProject,
    openContinueChat, closeContinueChat,
    openMergeConversation, closeMergeConversation,
    openRename, closeRename,
    openGenerateImage, closeGenerateImage,
    openAddCharacter, closeAddCharacter,
    openSearchReplace, closeSearchReplace,
    openBulkReplace, closeBulkReplace,
    openToolSettings, closeToolSettings,
    openRunTool, closeRunTool,
    openCustomTool, closeCustomTool,
    openStateEditor, closeStateEditor,
    libraryFilePickerOpen,
    openLibraryFilePicker, closeLibraryFilePicker,
    standaloneGenerateImageOpen,
    openStandaloneGenerateImage, closeStandaloneGenerateImage,
    insertAnnouncementOpen,
    openInsertAnnouncement, closeInsertAnnouncement,
    composeMailOpen,
    openComposeMail, closeComposeMail,
    informOpen,
    openInform, closeInform,
    editEnclaveModalOpen,
    openEditEnclave, closeEditEnclave,
  }
}
