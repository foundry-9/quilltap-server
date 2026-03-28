'use client'

import ImageModal from '@/components/chat/ImageModal'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import ChatSettingsModal from '@/components/chat/ChatSettingsModal'
import ChatProjectModal from '@/components/chat/ChatProjectModal'
import ChatRenameModal from '@/components/chat/ChatRenameModal'
import GenerateImageDialog from '@/components/chat/GenerateImageDialog'
import AddCharacterDialog from '@/components/chat/AddCharacterDialog'
import ReattributeMessageDialog from '@/components/chat/ReattributeMessageDialog'
import BulkCharacterReplaceModal from '@/components/chat/BulkCharacterReplaceModal'
import ChatToolSettingsModal from '@/components/chat/ChatToolSettingsModal'
import StateEditorModal from '@/components/state/StateEditorModal'
import RunToolModal from '@/components/chat/RunToolModal'
import { SearchReplaceModal } from '@/components/tools/search-replace'
import type { SearchReplaceResult } from '@/components/tools/search-replace/types'
import AllLLMPauseModal from '@/components/chat/AllLLMPauseModal'
import FileWriteApprovalModal from '@/components/chat/FileWriteApprovalModal'
import FileConflictDialog from '@/components/chat/FileConflictDialog'
import SelectLLMProfileDialog from '@/components/chat/SelectLLMProfileDialog'
import { MemoryCascadeDialog } from '@/components/ui/MemoryCascadeDialog'
import { showInfoToast } from '@/lib/toast'
import { getNextPauseThreshold } from '@/lib/chat/turn-manager'
import type { Chat, Message } from '../types'
import SudoApprovalModal from '@/components/chat/SudoApprovalModal'
import WorkspaceAcknowledgementModal from '@/components/chat/WorkspaceAcknowledgementModal'
import type { ReattributeDialogState, FileWriteApprovalState, SudoApprovalState, WorkspaceAcknowledgementState, SelectLLMProfileDialogState } from '../hooks/useModalState'

interface ChatModalsProps {
  chatId: string
  chat: Chat | null
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setChat: (fn: (prev: Chat | null) => Chat | null) => void
  fetchChat: () => Promise<void>
  fetchChatPhotoCount: () => Promise<void>
  setAttachedFiles: (fn: React.SetStateAction<any[]>) => void
  // Modal state
  modalImage: { src: string; filename: string; fileId?: string } | null
  setModalImage: (img: { src: string; filename: string; fileId?: string } | null) => void
  galleryOpen: boolean
  closeGallery: () => void
  chatSettingsModalOpen: boolean
  closeChatSettings: () => void
  chatProjectModalOpen: boolean
  closeChatProject: () => void
  renameModalOpen: boolean
  closeRename: () => void
  generateImageDialogOpen: boolean
  closeGenerateImage: () => void
  addCharacterDialogOpen: boolean
  closeAddCharacter: () => void
  searchReplaceModalOpen: boolean
  closeSearchReplace: () => void
  bulkReplaceModalOpen: boolean
  closeBulkReplace: () => void
  toolSettingsModalOpen: boolean
  closeToolSettings: () => void
  runToolModalOpen: boolean
  closeRunTool: () => void
  stateEditorModalOpen: boolean
  closeStateEditor: () => void
  allLLMPauseModalOpen: boolean
  setAllLLMPauseModalOpen: (open: boolean) => void
  // Complex modal states
  reattributeDialogState: ReattributeDialogState | null
  setReattributeDialogState: (state: ReattributeDialogState | null) => void
  fileWriteApprovalState: FileWriteApprovalState | null
  setFileWriteApprovalState: (state: FileWriteApprovalState | null) => void
  sudoApprovalState: SudoApprovalState | null
  setSudoApprovalState: (state: SudoApprovalState | null) => void
  workspaceAcknowledgementState: WorkspaceAcknowledgementState | null
  setWorkspaceAcknowledgementState: (state: WorkspaceAcknowledgementState | null) => void
  selectLLMProfileDialogState: SelectLLMProfileDialogState | null
  setSelectLLMProfileDialogState: (state: SelectLLMProfileDialogState | null) => void
  // File conflict
  isConflictDialogOpen: boolean
  cancelConflict: () => void
  conflictInfo: any
  handleConflictResolution: (resolution: any) => void
  resolvingConflict: boolean
  // Participant data for various dialogs
  getFirstCharacter: () => { id: string; name: string; [key: string]: any } | null | undefined
  getFirstPersona: () => { id: string; name: string; [key: string]: any } | null | undefined
  // Callbacks
  onCharacterAdded: () => void
  onReattributed: () => Promise<void>
  onConfirmStopImpersonation: (participantId: string, connectionProfileId: string) => Promise<void>
  // Memory cascade
  memoryCascadeConfirmation: { memoryCount: number; isSwipeGroup: boolean } | null
  cancelMemoryCascadeConfirmation: () => void
  handleMemoryCascadeConfirm: (action: import('../types').MemoryCascadeAction, rememberChoice: boolean) => Promise<void>
  // All-LLM pause
  allLLMPauseTurnCount: number
  llmParticipants: Array<{ id: string; characterId: string; characterName: string; character: any }>
  handleAllLLMContinue: () => void
  handleAllLLMStop: () => void
  handleAllLLMTakeOver: (participantId: string) => Promise<void>
  // Trigger continue after file write
  triggerContinueMode: (participantId: string) => Promise<void>
}

export function ChatModals({
  chatId,
  chat,
  messages,
  setMessages,
  setChat,
  fetchChat,
  fetchChatPhotoCount,
  setAttachedFiles,
  // Modal state
  modalImage, setModalImage,
  galleryOpen, closeGallery,
  chatSettingsModalOpen, closeChatSettings,
  chatProjectModalOpen, closeChatProject,
  renameModalOpen, closeRename,
  generateImageDialogOpen, closeGenerateImage,
  addCharacterDialogOpen, closeAddCharacter,
  searchReplaceModalOpen, closeSearchReplace,
  bulkReplaceModalOpen, closeBulkReplace,
  toolSettingsModalOpen, closeToolSettings,
  runToolModalOpen, closeRunTool,
  stateEditorModalOpen, closeStateEditor,
  allLLMPauseModalOpen, setAllLLMPauseModalOpen,
  // Complex
  reattributeDialogState, setReattributeDialogState,
  fileWriteApprovalState, setFileWriteApprovalState,
  sudoApprovalState, setSudoApprovalState,
  workspaceAcknowledgementState, setWorkspaceAcknowledgementState,
  selectLLMProfileDialogState, setSelectLLMProfileDialogState,
  // File conflict
  isConflictDialogOpen, cancelConflict, conflictInfo, handleConflictResolution, resolvingConflict,
  // Participants
  getFirstCharacter, getFirstPersona,
  // Callbacks
  onCharacterAdded, onReattributed, onConfirmStopImpersonation,
  // Memory cascade
  memoryCascadeConfirmation, cancelMemoryCascadeConfirmation, handleMemoryCascadeConfirm,
  // All-LLM pause
  allLLMPauseTurnCount, llmParticipants,
  handleAllLLMContinue, handleAllLLMStop, handleAllLLMTakeOver,
  triggerContinueMode,
}: ChatModalsProps) {
  const firstCharacter = getFirstCharacter()
  const firstPersona = getFirstPersona()

  return (
    <>
      <ImageModal
        isOpen={modalImage !== null}
        onClose={() => setModalImage(null)}
        src={modalImage?.src || ''}
        filename={modalImage?.filename || ''}
        fileId={modalImage?.fileId}
        characterId={firstCharacter?.id}
        characterName={firstCharacter?.name}
        personaId={firstPersona?.id}
        personaName={firstPersona?.name}
        onDelete={() => {
          fetchChat()
        }}
      />

      <PhotoGalleryModal
        mode="chat"
        isOpen={galleryOpen}
        onClose={closeGallery}
        chatId={chatId}
        characterId={firstCharacter?.id}
        characterName={firstCharacter?.name}
        personaId={firstPersona?.id}
        personaName={firstPersona?.name}
        onImageDeleted={(fileId) => {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.attachments?.some((a) => a.id === fileId)) {
                const newAttachments = msg.attachments.filter((a) => a.id !== fileId)
                const newContent = msg.content.includes('[attached photo deleted]')
                  ? msg.content
                  : `${msg.content} [attached photo deleted]`
                return { ...msg, attachments: newAttachments, content: newContent }
              }
              return msg
            })
          )
          fetchChatPhotoCount()
        }}
      />

      <ChatSettingsModal
        isOpen={chatSettingsModalOpen}
        onClose={closeChatSettings}
        chatId={chatId}
        roleplayTemplateId={chat?.roleplayTemplateId}
        imageProfileId={chat?.imageProfileId}
        onSuccess={fetchChat}
      />

      <ChatProjectModal
        isOpen={chatProjectModalOpen}
        onClose={closeChatProject}
        chatId={chatId}
        projectId={chat?.projectId}
        projectName={chat?.projectName}
        onSuccess={fetchChat}
      />

      <ChatRenameModal
        isOpen={renameModalOpen}
        onClose={closeRename}
        chatId={chatId}
        currentTitle={chat?.title || ''}
        isManuallyRenamed={chat?.isManuallyRenamed ?? false}
        onSuccess={(newTitle, isManuallyRenamed) => {
          if (chat) {
            setChat(prev => prev ? { ...prev, title: newTitle, isManuallyRenamed } : prev)
          }
        }}
      />

      <GenerateImageDialog
        isOpen={generateImageDialogOpen}
        onClose={closeGenerateImage}
        chatId={chatId}
        participants={chat?.participants || []}
        imageProfileId={chat?.imageProfileId || undefined}
        onImagesGenerated={(images, prompt) => {
          fetch(`/api/v1/chats/${chatId}?action=add-tool-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tool: 'generate_image',
              initiatedBy: 'user',
              prompt,
              images: images.map(img => ({
                id: img.id,
                filename: img.filename,
              })),
            }),
          })
            .then((res) => res.json())
            .then(() => {
              fetchChat()
            })
            .catch((err) => console.error('Failed to save tool result:', err instanceof Error ? err.message : String(err)))

          setAttachedFiles((prev: any[]) => [
            ...prev,
            ...images.map((img) => ({
              ...img,
              url: img.filepath.startsWith('/') ? img.filepath : `/${img.filepath}`,
            })),
          ])
          fetchChatPhotoCount()
        }}
      />

      <AddCharacterDialog
        isOpen={addCharacterDialogOpen}
        onClose={closeAddCharacter}
        chatId={chatId}
        existingCharacterIds={chat?.participants
          .filter(p => p.type === 'CHARACTER' && !p.removedAt)
          .map(p => p.character?.id)
          .filter((id): id is string => id !== null && id !== undefined) || []}
        onCharacterAdded={onCharacterAdded}
      />

      {reattributeDialogState && chat && (
        <ReattributeMessageDialog
          isOpen={reattributeDialogState.isOpen}
          onClose={() => setReattributeDialogState(null)}
          messageId={reattributeDialogState.messageId}
          currentParticipantId={reattributeDialogState.currentParticipantId}
          participants={chat.participants}
          onReattributed={onReattributed}
        />
      )}

      <SearchReplaceModal
        isOpen={searchReplaceModalOpen}
        onClose={closeSearchReplace}
        initialScope={{ type: 'chat', chatId }}
        currentChatId={chatId}
        chatTitle={chat?.title}
        onComplete={(result: SearchReplaceResult) => {
          if (result.messagesUpdated > 0) {
            fetchChat()
          }
        }}
      />

      {chat && (
        <BulkCharacterReplaceModal
          isOpen={bulkReplaceModalOpen}
          onClose={closeBulkReplace}
          chatId={chatId}
          participants={chat.participants}
          messages={messages}
          onSuccess={fetchChat}
        />
      )}

      {chat && (
        <ChatToolSettingsModal
          isOpen={toolSettingsModalOpen}
          onClose={closeToolSettings}
          chatId={chatId}
          disabledTools={chat.disabledTools || []}
          disabledToolGroups={chat.disabledToolGroups || []}
          profileToolsDisabled={chat.participants?.some(p => p.controlledBy === 'llm' && p.connectionProfile?.allowToolUse === false) ?? false}
          onSuccess={(newDisabledTools, newDisabledToolGroups) => {
            setChat(prev => prev ? {
              ...prev,
              disabledTools: newDisabledTools,
              disabledToolGroups: newDisabledToolGroups,
            } : prev)
          }}
        />
      )}

      <RunToolModal
        isOpen={runToolModalOpen}
        onClose={closeRunTool}
        chatId={chatId}
        onToolExecuted={() => {
          fetchChat()
        }}
      />

      {chat && (
        <StateEditorModal
          isOpen={stateEditorModalOpen}
          onClose={closeStateEditor}
          entityType="chat"
          entityId={chatId}
          entityName={chat.title}
        />
      )}

      <AllLLMPauseModal
        isOpen={allLLMPauseModalOpen}
        onClose={() => setAllLLMPauseModalOpen(false)}
        turnCount={allLLMPauseTurnCount}
        nextPauseAt={getNextPauseThreshold(allLLMPauseTurnCount)}
        participants={llmParticipants}
        onContinue={handleAllLLMContinue}
        onStop={handleAllLLMStop}
        onTakeOver={handleAllLLMTakeOver}
      />

      {fileWriteApprovalState && (
        <FileWriteApprovalModal
          isOpen={fileWriteApprovalState.isOpen}
          onClose={() => setFileWriteApprovalState(null)}
          request={{
            filename: fileWriteApprovalState.pendingWrite.filename,
            content: fileWriteApprovalState.pendingWrite.content || '',
            mimeType: fileWriteApprovalState.pendingWrite.mimeType || 'text/plain',
            folderPath: fileWriteApprovalState.pendingWrite.folderPath,
            projectId: fileWriteApprovalState.pendingWrite.projectId,
            projectName: fileWriteApprovalState.projectName,
          }}
          chatId={chatId}
          onApprove={async () => {
            const participantToTrigger = fileWriteApprovalState?.respondingParticipantId
            setFileWriteApprovalState(null)
            await fetchChat()
            if (participantToTrigger) {
              setTimeout(() => {
                triggerContinueMode(participantToTrigger)
              }, 500)
            }
          }}
          onDeny={async () => {
            const participantToTrigger = fileWriteApprovalState?.respondingParticipantId
            setFileWriteApprovalState(null)
            showInfoToast('File write denied.')
            await fetchChat()
            if (participantToTrigger) {
              setTimeout(() => {
                triggerContinueMode(participantToTrigger)
              }, 500)
            }
          }}
        />
      )}

      {sudoApprovalState && (
        <SudoApprovalModal
          isOpen={sudoApprovalState.isOpen}
          onClose={() => setSudoApprovalState(null)}
          chatId={chatId}
          pendingSudoCommand={sudoApprovalState.pendingSudoCommand}
          onApprove={async () => {
            const participantToTrigger = sudoApprovalState?.respondingParticipantId
            setSudoApprovalState(null)
            await fetchChat()
            if (participantToTrigger) {
              setTimeout(() => {
                triggerContinueMode(participantToTrigger)
              }, 500)
            }
          }}
          onDeny={async () => {
            const participantToTrigger = sudoApprovalState?.respondingParticipantId
            setSudoApprovalState(null)
            showInfoToast('Sudo command denied.')
            await fetchChat()
            if (participantToTrigger) {
              setTimeout(() => {
                triggerContinueMode(participantToTrigger)
              }, 500)
            }
          }}
        />
      )}

      {workspaceAcknowledgementState && (
        <WorkspaceAcknowledgementModal
          isOpen={workspaceAcknowledgementState.isOpen}
          onClose={() => setWorkspaceAcknowledgementState(null)}
          chatId={chatId}
          onAcknowledge={async () => {
            const participantToTrigger = workspaceAcknowledgementState?.respondingParticipantId
            setWorkspaceAcknowledgementState(null)
            await fetchChat()
            if (participantToTrigger) {
              setTimeout(() => {
                triggerContinueMode(participantToTrigger)
              }, 500)
            }
          }}
          onDismiss={async () => {
            const participantToTrigger = workspaceAcknowledgementState?.respondingParticipantId
            setWorkspaceAcknowledgementState(null)
            showInfoToast('Shell tools will remain unavailable until workspace is acknowledged.')
            await fetchChat()
            if (participantToTrigger) {
              setTimeout(() => {
                triggerContinueMode(participantToTrigger)
              }, 500)
            }
          }}
        />
      )}

      <FileConflictDialog
        isOpen={isConflictDialogOpen}
        onClose={cancelConflict}
        conflict={conflictInfo}
        onResolve={handleConflictResolution}
        resolving={resolvingConflict}
      />

      {selectLLMProfileDialogState && (
        <SelectLLMProfileDialog
          isOpen={selectLLMProfileDialogState.isOpen}
          onClose={() => setSelectLLMProfileDialogState(null)}
          character={selectLLMProfileDialogState.character}
          participantId={selectLLMProfileDialogState.participantId}
          onConfirm={onConfirmStopImpersonation}
          onCancel={() => setSelectLLMProfileDialogState(null)}
        />
      )}

      {memoryCascadeConfirmation && (
        <MemoryCascadeDialog
          isOpen={true}
          memoryCount={memoryCascadeConfirmation.memoryCount}
          isSwipeGroup={memoryCascadeConfirmation.isSwipeGroup}
          onClose={cancelMemoryCascadeConfirmation}
          onConfirm={handleMemoryCascadeConfirm}
        />
      )}

    </>
  )
}
