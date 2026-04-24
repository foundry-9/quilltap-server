/**
 * Project Info Tool Definition
 *
 * Provides a tool interface for LLMs to access project overview and
 * instructions during conversations.
 *
 * Actions:
 * - get_info: Get project name, description, character roster, counts, linked store
 * - get_instructions: Get full project instructions
 *
 * @module tools/project-info-tool
 */

/**
 * Valid actions for the project info tool
 */
export type ProjectInfoAction =
  | 'get_info'
  | 'get_instructions'

/**
 * Input parameters for the project info tool
 */
export interface ProjectInfoToolInput {
  /** Action to perform */
  action: ProjectInfoAction
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
 * Project document store info — the database-backed Scriptorium store
 * linked to this project (created by the Stage 1 migration and fed by new
 * writes from Stage 2 onward). Absent when no store is linked.
 */
export interface ProjectDocumentStoreInfo {
  mountPointId: string
  name: string
  storeType: 'documents' | 'character'
  fileCount: number
  blobCount: number
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
  documentStore?: ProjectDocumentStoreInfo | null
}

/**
 * Output for get_instructions action
 */
export interface ProjectInstructionsResult {
  instructions: string | null
  hasInstructions: boolean
}

/**
 * Output from the project info tool
 */
export interface ProjectInfoToolOutput {
  success: boolean
  action: ProjectInfoAction
  data?: ProjectInfoResult | ProjectInstructionsResult
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
      'Access information about the current project context. Use this to get project overview or read project instructions. For file listing, reading, and search, use the Scriptorium document tools (doc_list_files, doc_read_file, doc_grep).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_info', 'get_instructions'],
          description:
            'The action to perform. "get_info" returns project overview, character roster, and the linked Scriptorium document store (if any). "get_instructions" returns full project instructions.',
        },
      },
      required: ['action'],
    },
  },
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

  const validActions = ['get_info', 'get_instructions']
  if (typeof obj.action !== 'string' || !validActions.includes(obj.action)) {
    return false
  }

  return true
}
