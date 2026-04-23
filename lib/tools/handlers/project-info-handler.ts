/**
 * Project Info Tool Handler
 *
 * Executes project info tool calls during chat.
 * Provides access to project details, instructions, files, and search.
 *
 * @module tools/handlers/project-info-handler
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { extractFileContent } from '@/lib/services/file-content-extractor'
import { pickPrimaryProjectStore } from '@/lib/mount-index/project-store-naming'
import type { DocMountPoint } from '@/lib/schemas/mount-index.types'
import {
  ProjectInfoToolInput,
  ProjectInfoToolOutput,
  ProjectInfoResult,
  ProjectInstructionsResult,
  ProjectFilesListResult,
  ProjectReadFileResult,
  ProjectSearchFilesResult,
  ProjectFileInfo,
  ProjectCharacterInfo,
  ProjectDocumentStoreInfo,
  validateProjectInfoInput,
} from '../project-info-tool'

/**
 * Context required for project info execution
 */
export interface ProjectInfoToolContext {
  /** User ID for authentication */
  userId: string
  /** Project ID to query */
  projectId: string
  /** Optional embedding profile ID for semantic search */
  embeddingProfileId?: string
}

/**
 * Error thrown during project info execution
 */
export class ProjectInfoError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'EXECUTION_ERROR'
  ) {
    super(message)
    this.name = 'ProjectInfoError'
  }
}

/**
 * Execute get_info action
 */
async function executeGetInfo(
  context: ProjectInfoToolContext
): Promise<ProjectInfoResult | null> {
  const repos = getRepositories()

  // Get project
  const project = await repos.projects.findById(context.projectId)
  if (!project || project.userId !== context.userId) {
    return null
  }

  // Get character roster details
  const characterRoster: ProjectCharacterInfo[] = []
  for (const charId of project.characterRoster) {
    const char = await repos.characters.findById(charId)
    if (char) {
      characterRoster.push({
        id: char.id,
        name: char.name,
        avatarUrl: char.avatarUrl,
      })
    }
  }

  // Count associated items
  const allChats = await repos.chats.findAll()
  const chatCount = allChats.filter(c => c.projectId === context.projectId).length

  const allFiles = await repos.files.findAll()
  const fileCount = allFiles.filter(f => f.projectId === context.projectId).length

  const allMemories = await repos.memories.findAll()
  const memoryCount = allMemories.filter(m => m.projectId === context.projectId).length

  const documentStore = await resolveProjectDocumentStore(context.projectId)

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    allowAnyCharacter: project.allowAnyCharacter,
    characterRoster,
    fileCount,
    chatCount,
    memoryCount,
    documentStore,
  }
}

/**
 * Resolve the database-backed Scriptorium store linked to a project.
 * Returns null if the project has no link or the mount index DB is
 * unavailable — the rest of the project info stays usable either way.
 */
async function resolveProjectDocumentStore(
  projectId: string
): Promise<ProjectDocumentStoreInfo | null> {
  const repos = getRepositories()
  try {
    const links = await repos.projectDocMountLinks.findByProjectId(projectId)
    if (!links.length) return null

    const mountPoints: DocMountPoint[] = []
    for (const link of links) {
      const mp = await repos.docMountPoints.findById(link.mountPointId)
      if (mp) mountPoints.push(mp)
    }

    const chosen = pickPrimaryProjectStore(mountPoints)
    if (!chosen) return null

    const [files, blobs] = await Promise.all([
      repos.docMountFiles.findByMountPointId(chosen.id),
      repos.docMountBlobs.listByMountPoint(chosen.id),
    ])
    return {
      mountPointId: chosen.id,
      name: chosen.name,
      storeType: chosen.storeType,
      fileCount: files.length,
      blobCount: blobs.length,
    }
  } catch {
    return null
  }
}

/**
 * Execute get_instructions action
 */
async function executeGetInstructions(
  context: ProjectInfoToolContext
): Promise<ProjectInstructionsResult | null> {
  const repos = getRepositories()

  const project = await repos.projects.findById(context.projectId)
  if (!project || project.userId !== context.userId) {
    return null
  }

  return {
    instructions: project.instructions || null,
    hasInstructions: !!project.instructions,
  }
}

/**
 * Execute list_files action
 */
async function executeListFiles(
  context: ProjectInfoToolContext,
  limit: number = 10
): Promise<ProjectFilesListResult | null> {
  const repos = getRepositories()

  // Verify project exists and user owns it
  const project = await repos.projects.findById(context.projectId)
  if (!project || project.userId !== context.userId) {
    return null
  }

  // Get project files
  const allFiles = await repos.files.findAll()
  const projectFiles = allFiles
    .filter(f => f.projectId === context.projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const files: ProjectFileInfo[] = projectFiles.slice(0, limit).map(f => ({
    id: f.id,
    filename: f.originalFilename,
    mimeType: f.mimeType,
    size: f.size,
    category: f.category,
    description: f.description,
    createdAt: f.createdAt,
  }))

  return {
    files,
    total: projectFiles.length,
  }
}

/**
 * Execute read_file action
 */
async function executeReadFile(
  context: ProjectInfoToolContext,
  fileId: string
): Promise<ProjectReadFileResult | null> {
  const repos = getRepositories()

  // Verify project exists and user owns it
  const project = await repos.projects.findById(context.projectId)
  if (!project || project.userId !== context.userId) {
    return null
  }

  // Get file
  const file = await repos.files.findById(fileId)
  if (!file || file.projectId !== context.projectId) {
    return null
  }

  // Extract content
  const extracted = await extractFileContent(file)

  if (!extracted.success) {
    throw new ProjectInfoError(
      extracted.error || 'Failed to extract file content',
      'EXECUTION_ERROR'
    )
  }

  return {
    fileId: file.id,
    filename: file.originalFilename,
    mimeType: file.mimeType,
    content: extracted.content || '',
    contentType: extracted.contentType === 'error' ? 'text' : extracted.contentType,
    language: extracted.language,
    truncated: extracted.truncated,
  }
}

/**
 * Execute search_files action
 * Currently uses simple text matching; can be enhanced with embeddings
 */
async function executeSearchFiles(
  context: ProjectInfoToolContext,
  query: string,
  limit: number = 10
): Promise<ProjectSearchFilesResult | null> {
  const repos = getRepositories()

  // Verify project exists and user owns it
  const project = await repos.projects.findById(context.projectId)
  if (!project || project.userId !== context.userId) {
    return null
  }

  // Get project files
  const allFiles = await repos.files.findAll()
  const projectFiles = allFiles.filter(f => f.projectId === context.projectId)

  // Simple text matching on filename and description
  const queryLower = query.toLowerCase()
  const matches = projectFiles
    .map(f => {
      let score = 0
      const filename = f.originalFilename.toLowerCase()
      const description = (f.description || '').toLowerCase()

      // Exact filename match
      if (filename.includes(queryLower)) {
        score += 0.8
      }

      // Description match
      if (description.includes(queryLower)) {
        score += 0.5
      }

      // Partial word matches
      const queryWords = queryLower.split(/\s+/)
      for (const word of queryWords) {
        if (filename.includes(word)) score += 0.2
        if (description.includes(word)) score += 0.1
      }

      return { file: f, score }
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return {
    results: matches.map(m => ({
      fileId: m.file.id,
      filename: m.file.originalFilename,
      relevanceScore: Math.min(m.score, 1),
      snippet: m.file.description || undefined,
    })),
    query,
    total: matches.length,
  }
}

/**
 * Execute a project info tool call
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user and project IDs
 * @returns Tool output with results
 */
export async function executeProjectInfoTool(
  input: unknown,
  context: ProjectInfoToolContext
): Promise<ProjectInfoToolOutput> {
  const log = logger.child({
    module: 'project-info-handler',
    projectId: context.projectId,
    userId: context.userId,
  })

  try {
    // Validate input
    if (!validateProjectInfoInput(input)) {

      return {
        success: false,
        action: 'get_info',
        error: 'Invalid input: action is required and must be a valid action type',
      }
    }

    const { action, fileId, query, limit = 10 } = input

    switch (action) {
      case 'get_info': {
        const result = await executeGetInfo(context)
        if (!result) {
          return {
            success: false,
            action,
            error: 'Project not found',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      case 'get_instructions': {
        const result = await executeGetInstructions(context)
        if (!result) {
          return {
            success: false,
            action,
            error: 'Project not found',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      case 'list_files': {
        const result = await executeListFiles(context, limit)
        if (!result) {
          return {
            success: false,
            action,
            error: 'Project not found',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      case 'read_file': {
        if (!fileId) {
          return {
            success: false,
            action,
            error: 'fileId is required for read_file action',
          }
        }
        const result = await executeReadFile(context, fileId)
        if (!result) {
          return {
            success: false,
            action,
            error: 'File not found in project',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      case 'search_files': {
        if (!query) {
          return {
            success: false,
            action,
            error: 'query is required for search_files action',
          }
        }
        const result = await executeSearchFiles(context, query, limit)
        if (!result) {
          return {
            success: false,
            action,
            error: 'Project not found',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      default:
        return {
          success: false,
          action: action as any,
          error: `Unknown action: ${action}`,
        }
    }
  } catch (error) {
    log.error('Project info tool execution error', {}, error instanceof Error ? error : undefined)

    const action = typeof input === 'object' && input !== null && 'action' in input
      ? String((input as Record<string, unknown>).action) as any
      : 'get_info'

    return {
      success: false,
      action,
      error: error instanceof Error ? error.message : 'Unknown error during project info lookup',
    }
  }
}

/**
 * Format project info results for inclusion in conversation context
 *
 * @param output - Tool output to format
 * @returns Formatted string suitable for LLM context
 */
export function formatProjectInfoResults(output: ProjectInfoToolOutput): string {
  if (!output.success) {
    return `Project Info Error: ${output.error || 'Unknown error'}`
  }

  switch (output.action) {
    case 'get_info': {
      const info = output.data as ProjectInfoResult
      const parts = [
        `Project: ${info.name}`,
        info.description ? `Description: ${info.description}` : null,
        `Files: ${info.fileCount}, Chats: ${info.chatCount}, Memories: ${info.memoryCount}`,
        info.characterRoster.length > 0
          ? `Characters: ${info.characterRoster.map(c => c.name).join(', ')}`
          : 'No characters in roster',
        info.allowAnyCharacter ? '(Any character can participate)' : null,
        info.documentStore
          ? `Document Store: ${info.documentStore.name} (${info.documentStore.fileCount} files, ${info.documentStore.blobCount} blobs, storeType=${info.documentStore.storeType})`
          : 'Document Store: (none linked)',
      ].filter(Boolean)
      return parts.join('\n')
    }

    case 'get_instructions': {
      const inst = output.data as ProjectInstructionsResult
      if (!inst.hasInstructions) {
        return 'No project instructions defined.'
      }
      return `Project Instructions:\n${inst.instructions}`
    }

    case 'list_files': {
      const list = output.data as ProjectFilesListResult
      if (list.files.length === 0) {
        return 'No files in project.'
      }
      const fileLines = list.files.map(f =>
        `- ${f.filename} (${f.mimeType}, ${formatBytes(f.size)})${f.description ? ` - ${f.description}` : ''}`
      )
      return `Project Files (${list.total} total):\n${fileLines.join('\n')}`
    }

    case 'read_file': {
      const read = output.data as ProjectReadFileResult
      const header = `File: ${read.filename} (${read.mimeType})`
      const truncNote = read.truncated ? '\n[Content truncated]' : ''
      if (read.contentType === 'code' && read.language) {
        return `${header}\n\`\`\`${read.language}\n${read.content}\n\`\`\`${truncNote}`
      }
      return `${header}\n\n${read.content}${truncNote}`
    }

    case 'search_files': {
      const search = output.data as ProjectSearchFilesResult
      if (search.results.length === 0) {
        return `No files found matching "${search.query}".`
      }
      const resultLines = search.results.map(r =>
        `- ${r.filename} (relevance: ${(r.relevanceScore * 100).toFixed(0)}%)${r.snippet ? ` - ${r.snippet}` : ''}`
      )
      return `Search results for "${search.query}" (${search.total} found):\n${resultLines.join('\n')}`
    }

    default:
      return 'Unknown action result'
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
