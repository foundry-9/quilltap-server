/**
 * Projects API v1 - Actions Index
 *
 * Re-exports all action handlers
 */

export { handleGetDefault, handlePutDefault, handleDeleteProject } from './project-crud';
export { handleListCharacters, handleAddCharacter, handleRemoveCharacter } from './roster';
export { handleListChats, handleAddChat, handleRemoveChat } from './chats';
export { handleListFiles, handleAddFile, handleRemoveFile } from './files';
export { handleGetMountPoint, handleSetMountPoint, handleClearMountPoint } from './mount-points';
export { handleGetState, handleSetState, handleResetState } from './state';
export { handleGetBackground } from './background';
export { handleUpdateToolSettings } from './tools';
