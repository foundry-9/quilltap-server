/**
 * Project Info Tool Definition
 *
 * Provides a tool interface for LLMs to access project information,
 * instructions, files, and memories during conversations.
 *
 * Actions:
 * - get_info: Get project name, description, and character roster
 * - get_instructions: Get full project instructions
 * - list_files: List files in the project with metadata
 * - read_file: Read content of a specific file
 * - search_files: Semantic search across project files
 *
 * @module tools/project-info-tool
 */

/**
 * Valid actions for the project info tool
 */
export type ProjectInfoAction =
  | 'get_info'
  | 'get_instructions'
  | 'list_files'
  | 'read_file'
  | 'search_files'

/**
 * Input parameters for the project info tool
 */
export interface ProjectInfoToolInput {
  /** Action to perform */
  action: ProjectInfoAction
  /** File ID for read_file action */
  fileId?: string
  /** Search query for search_files action */
  query?: string
  /** Maximum results for search_files or list_files */
  limit?: number
}

/**
 * Project character info
 */
export interface ProjectCharacterInfo {
  id: string
  name: string
  avatarUrl?: string | null
}

/**
 * Project file info
 */
export interface ProjectFileInfo {
  id: string
  filename: string
  mimeType: string
  size: number
  category: string
  description?: string | null
  createdAt: string
}

/**
 * Output for get_info action
 */
export interface ProjectInfoResult {
  id: string
  name: string
  description?: string | null
  allowAnyCharacter: boolean
  characterRoster: ProjectCharacterInfo[]
  fileCount: number
  chatCount: number
  memoryCount: number
}

/**
 * Output for get_instructions action
 */
export interface ProjectInstructionsResult {
  instructions: string | null
  hasInstructions: boolean
}

/**
 * Output for list_files action
 */
export interface ProjectFilesListResult {
  files: ProjectFileInfo[]
  total: number
}

/**
 * Output for read_file action
 */
export interface ProjectReadFileResult {
  fileId: string
  filename: string
  mimeType: string
  content: string
  contentType: 'text' | 'code' | 'markdown' | 'image_description' | 'binary'
  language?: string
  truncated?: boolean
}

/**
 * Output for search_files action
 */
export interface ProjectSearchFilesResult {
  results: Array<{
    fileId: string
    filename: string
    relevanceScore: number
    snippet?: string
  }>
  query: string
  total: number
}

/**
 * Output from the project info tool
 */
export interface ProjectInfoToolOutput {
  success: boolean
  action: ProjectInfoAction
  data?:
    | ProjectInfoResult
    | ProjectInstructionsResult
    | ProjectFilesListResult
    | ProjectReadFileResult
    | ProjectSearchFilesResult
  error?: string
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const projectInfoToolDefinition = {
  type: 'function',
  function: {
    name: 'project_info',
    description:
      'Access information about the current project context. Use this to get project details, read instructions, list files, read file contents, or search files. Projects contain files, chats, and memories that provide context for conversations.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_info', 'get_instructions', 'list_files', 'read_file', 'search_files'],
          description:
            'The action to perform. "get_info" returns project overview and character roster. "get_instructions" returns full project instructions. "list_files" lists all project files. "read_file" reads a specific file\'s content. "search_files" searches files by query.',
        },
        fileId: {
          type: 'string',
          description: 'The file ID to read (required for read_file action)',
        },
        query: {
          type: 'string',
          description: 'Search query for finding relevant files (required for search_files action)',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Maximum number of results to return (default: 10, max: 50)',
          default: 10,
        },
      },
      required: ['action'],
    },
  },
}

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicProjectInfoToolDefinition = {
  name: 'project_info',
  description:
    'Access information about the current project context. Use this to get project details, read instructions, list files, read file contents, or search files. Projects contain files, chats, and memories that provide context for conversations.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['get_info', 'get_instructions', 'list_files', 'read_file', 'search_files'],
        description:
          'The action to perform. "get_info" returns project overview and character roster. "get_instructions" returns full project instructions. "list_files" lists all project files. "read_file" reads a specific file\'s content. "search_files" searches files by query.',
      },
      fileId: {
        type: 'string',
        description: 'The file ID to read (required for read_file action)',
      },
      query: {
        type: 'string',
        description: 'Search query for finding relevant files (required for search_files action)',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Maximum number of results to return (default: 10, max: 50)',
        default: 10,
      },
    },
    required: ['action'],
  },
}

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIProjectInfoTool() {
  return projectInfoToolDefinition
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicProjectInfoTool() {
  return anthropicProjectInfoToolDefinition
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleProjectInfoTool() {
  return {
    name: anthropicProjectInfoToolDefinition.name,
    description: anthropicProjectInfoToolDefinition.description,
    parameters: anthropicProjectInfoToolDefinition.input_schema,
  }
}

/**
 * Helper to validate tool input parameters
 */
export function validateProjectInfoInput(
  input: unknown
): input is ProjectInfoToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }

  const obj = input as Record<string, unknown>

  // action is required
  const validActions = ['get_info', 'get_instructions', 'list_files', 'read_file', 'search_files']
  if (typeof obj.action !== 'string' || !validActions.includes(obj.action)) {
    return false
  }

  // fileId required for read_file
  if (obj.action === 'read_file' && typeof obj.fileId !== 'string') {
    return false
  }

  // query required for search_files
  if (obj.action === 'search_files' && typeof obj.query !== 'string') {
    return false
  }

  // Optional limit
  if (obj.limit !== undefined) {
    const limit = Number(obj.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return false
    }
  }

  return true
}
