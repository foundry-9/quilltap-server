/**
 * File Management Tool Definition
 *
 * Provides a tool interface for LLMs to manage files within projects
 * and general file storage. Supports listing, reading, writing, and
 * organizing files with folder support.
 *
 * Actions:
 * - list_files: List files by scope (project/general/character)
 * - list_folders: List folders in project or general space
 * - read_file: Read content of a specific file
 * - write_file: Create or update a file (requires permission)
 * - create_folder: Create a new folder
 * - promote_attachment: Move a message attachment to project/general files
 *
 * @module tools/file-management-tool
 */

/**
 * File scope options for listing files
 */
export type FileScope = 'project' | 'general' | 'character';

/**
 * Valid actions for the file management tool
 */
export type FileManagementAction =
  | 'list_files'
  | 'list_folders'
  | 'read_file'
  | 'write_file'
  | 'create_folder'
  | 'promote_attachment';

/**
 * Input parameters for the file management tool
 */
export interface FileManagementToolInput {
  /** Action to perform */
  action: FileManagementAction;

  // For list_files / list_folders
  /** Scope of files to list: project files, general files, or character-associated images */
  scope?: FileScope;
  /** Folder path to filter results (default: "/" for root) */
  folderPath?: string;
  /** Include files in subfolders (default: true for list_files) */
  recursive?: boolean;
  /** Character ID for scope='character' to list their associated images */
  characterId?: string;
  /** Maximum results to return */
  limit?: number;

  // For read_file
  /** File ID to read */
  fileId?: string;

  // For write_file
  /** Filename for the new/updated file */
  filename?: string;
  /** Content to write to the file */
  content?: string;
  /** MIME type of the file (default: text/plain) */
  mimeType?: string;
  /** Target folder path for the file */
  targetFolderPath?: string;

  // For create_folder
  /** New folder path to create */
  newFolderPath?: string;

  // For promote_attachment
  /** Attachment (file) ID to promote */
  attachmentId?: string;
  /** Target project ID (null for general files) */
  targetProjectId?: string | null;
}

/**
 * File info returned in list results
 */
export interface FileInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  category: string;
  folderPath: string;
  description?: string | null;
  createdAt: string;
}

/**
 * Folder info returned in folder list
 */
export interface FolderInfo {
  path: string;
  name: string;
  depth: number;
  fileCount: number;
}

/**
 * Output for list_files action
 */
export interface FileListResult {
  files: FileInfo[];
  total: number;
  scope: FileScope;
  folderPath?: string;
}

/**
 * Output for list_folders action
 */
export interface FolderListResult {
  folders: FolderInfo[];
  total: number;
  scope: 'project' | 'general';
}

/**
 * Output for read_file action
 */
export interface FileReadResult {
  fileId: string;
  filename: string;
  mimeType: string;
  content: string;
  contentType: 'text' | 'code' | 'markdown' | 'image_description' | 'binary';
  language?: string;
  truncated?: boolean;
}

/**
 * Output for write_file action
 */
export interface FileWriteResult {
  success: boolean;
  fileId?: string;
  filename?: string;
  folderPath?: string;
  requiresPermission?: boolean;
  pendingWriteId?: string;
  message?: string;
}

/**
 * Output for create_folder action
 */
export interface FolderCreateResult {
  success: boolean;
  folderPath: string;
  message?: string;
}

/**
 * Output for promote_attachment action
 */
export interface AttachmentPromoteResult {
  success: boolean;
  fileId: string;
  filename: string;
  newProjectId?: string | null;
  newFolderPath?: string;
  message?: string;
}

/**
 * Output from the file management tool
 */
export interface FileManagementToolOutput {
  success: boolean;
  action: FileManagementAction;
  data?:
    | FileListResult
    | FolderListResult
    | FileReadResult
    | FileWriteResult
    | FolderCreateResult
    | AttachmentPromoteResult;
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const fileManagementToolDefinition = {
  type: 'function',
  function: {
    name: 'file_management',
    description:
      'Manage files within the current project or general file storage. Use this to list files, list folders, read file contents, write new files, create folders, or promote message attachments to project files. Files can be organized in folders. Writing files requires user permission.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list_files',
            'list_folders',
            'read_file',
            'write_file',
            'create_folder',
            'promote_attachment',
          ],
          description:
            'The action to perform. "list_files" lists files by scope. "list_folders" shows folder structure. "read_file" reads file content. "write_file" creates or updates a file (requires permission). "create_folder" creates a new folder. "promote_attachment" moves an attachment to project/general files.',
        },
        scope: {
          type: 'string',
          enum: ['project', 'general', 'character'],
          description:
            'Scope of files to list. "project" = files in the current project. "general" = files not in any project. "character" = images associated with a specific character.',
        },
        folderPath: {
          type: 'string',
          description:
            'Filter to files in this folder path. Use "/" for root, "/documents/" for a subfolder. Default is "/" (all files).',
        },
        recursive: {
          type: 'boolean',
          description:
            'Whether to include files from subfolders. Default is true for list_files.',
          default: true,
        },
        characterId: {
          type: 'string',
          description:
            'Character ID to list associated images (required when scope="character").',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return (default: 20, max: 100).',
          default: 20,
        },
        fileId: {
          type: 'string',
          description: 'File ID to read (required for read_file action).',
        },
        filename: {
          type: 'string',
          description: 'Filename for write_file action.',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file (required for write_file action).',
        },
        mimeType: {
          type: 'string',
          description:
            'MIME type of the file being written. Default is "text/plain".',
          default: 'text/plain',
        },
        targetFolderPath: {
          type: 'string',
          description:
            'Folder path where the file should be written or promoted to. Default is "/".',
          default: '/',
        },
        newFolderPath: {
          type: 'string',
          description:
            'Full path of the folder to create (required for create_folder action). Example: "/documents/reports/".',
        },
        attachmentId: {
          type: 'string',
          description:
            'File ID of the attachment to promote (required for promote_attachment action).',
        },
        targetProjectId: {
          type: 'string',
          description:
            'Project ID to move file to. Use null or omit for general files. Only for promote_attachment action.',
        },
      },
      required: ['action'],
    },
  },
};

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicFileManagementToolDefinition = {
  name: 'file_management',
  description:
    'Manage files within the current project or general file storage. Use this to list files, list folders, read file contents, write new files, create folders, or promote message attachments to project files. Files can be organized in folders. Writing files requires user permission.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: [
          'list_files',
          'list_folders',
          'read_file',
          'write_file',
          'create_folder',
          'promote_attachment',
        ],
        description:
          'The action to perform. "list_files" lists files by scope. "list_folders" shows folder structure. "read_file" reads file content. "write_file" creates or updates a file (requires permission). "create_folder" creates a new folder. "promote_attachment" moves an attachment to project/general files.',
      },
      scope: {
        type: 'string',
        enum: ['project', 'general', 'character'],
        description:
          'Scope of files to list. "project" = files in the current project. "general" = files not in any project. "character" = images associated with a specific character.',
      },
      folderPath: {
        type: 'string',
        description:
          'Filter to files in this folder path. Use "/" for root, "/documents/" for a subfolder. Default is "/" (all files).',
      },
      recursive: {
        type: 'boolean',
        description:
          'Whether to include files from subfolders. Default is true for list_files.',
        default: true,
      },
      characterId: {
        type: 'string',
        description:
          'Character ID to list associated images (required when scope="character").',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of results to return (default: 20, max: 100).',
        default: 20,
      },
      fileId: {
        type: 'string',
        description: 'File ID to read (required for read_file action).',
      },
      filename: {
        type: 'string',
        description: 'Filename for write_file action.',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file (required for write_file action).',
      },
      mimeType: {
        type: 'string',
        description:
          'MIME type of the file being written. Default is "text/plain".',
        default: 'text/plain',
      },
      targetFolderPath: {
        type: 'string',
        description:
          'Folder path where the file should be written or promoted to. Default is "/".',
        default: '/',
      },
      newFolderPath: {
        type: 'string',
        description:
          'Full path of the folder to create (required for create_folder action). Example: "/documents/reports/".',
      },
      attachmentId: {
        type: 'string',
        description:
          'File ID of the attachment to promote (required for promote_attachment action).',
      },
      targetProjectId: {
        type: 'string',
        description:
          'Project ID to move file to. Use null or omit for general files. Only for promote_attachment action.',
      },
    },
    required: ['action'],
  },
};

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIFileManagementTool() {
  return fileManagementToolDefinition;
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicFileManagementTool() {
  return anthropicFileManagementToolDefinition;
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleFileManagementTool() {
  return {
    name: anthropicFileManagementToolDefinition.name,
    description: anthropicFileManagementToolDefinition.description,
    parameters: anthropicFileManagementToolDefinition.input_schema,
  };
}

/**
 * Helper to validate tool input parameters
 */
export function validateFileManagementInput(
  input: unknown
): input is FileManagementToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // action is required
  const validActions = [
    'list_files',
    'list_folders',
    'read_file',
    'write_file',
    'create_folder',
    'promote_attachment',
  ];
  if (typeof obj.action !== 'string' || !validActions.includes(obj.action)) {
    return false;
  }

  // Validate based on action
  switch (obj.action) {
    case 'list_files':
    case 'list_folders':
      // scope is optional but must be valid if provided
      if (obj.scope !== undefined) {
        const validScopes = ['project', 'general', 'character'];
        if (typeof obj.scope !== 'string' || !validScopes.includes(obj.scope)) {
          return false;
        }
      }
      // characterId required for scope='character'
      if (obj.scope === 'character' && typeof obj.characterId !== 'string') {
        return false;
      }
      break;

    case 'read_file':
      if (typeof obj.fileId !== 'string') {
        return false;
      }
      break;

    case 'write_file':
      if (typeof obj.filename !== 'string' || typeof obj.content !== 'string') {
        return false;
      }
      break;

    case 'create_folder':
      if (typeof obj.newFolderPath !== 'string') {
        return false;
      }
      break;

    case 'promote_attachment':
      if (typeof obj.attachmentId !== 'string') {
        return false;
      }
      break;
  }

  // Optional limit validation
  if (obj.limit !== undefined) {
    const limit = Number(obj.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return false;
    }
  }

  return true;
}
