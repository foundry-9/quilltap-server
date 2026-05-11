/**
 * Shell Tool Handler
 *
 * Main dispatch function and individual handlers for all shell tools.
 * Validates environment (must be Lima/Docker), enforces workspace boundaries,
 * and executes shell commands with proper logging and security checks.
 *
 * @module tools/shell/shell-handler
 */

import { spawnSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  isShellEnvironment,
  getWorkspaceDir,
  getWorkspaceChatDir,
  getWorkspaceProjectDir,
} from '@/lib/paths';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { writeUserUploadToMountStore } from '@/lib/file-storage/user-uploads-bridge';
import type {
  ShellToolContext,
  ShellCommandResult,
  ShellAsyncCommandResult,
  ShellSessionState,
} from './shell-session.types';
import {
  SHELL_TIMEOUT_DEFAULT,
  SHELL_TIMEOUT_MAX,
  SHELL_MAX_OUTPUT_SIZE,
} from './shell-session.types';
import { checkCommandWarnings } from './command-warnings';
import { registerProcess, getProcessStatus, hasProcess } from './async-process-registry';
import { isBinaryExecutable, stripExecuteBits } from './binary-detector';
import type { ShellToolName } from './shell-tools';

const moduleLogger = logger.child({ module: 'shell-handler' });

/**
 * Error thrown during shell tool execution
 */
export class ShellError extends Error {
  constructor(
    message: string,
    public code: 'NOT_AVAILABLE' | 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'PATH_TRAVERSAL' | 'PERMISSION_REQUIRED' | 'WORKSPACE_ACK_REQUIRED'
  ) {
    super(message);
    this.name = 'ShellError';
  }
}

/**
 * Shell tool execution output
 */
export interface ShellToolOutput {
  success: boolean;
  formattedText: string;
  result?: ShellCommandResult | ShellAsyncCommandResult;
  error?: string;
  /** For sudo_sync: indicates user approval is required */
  requiresSudoApproval?: boolean;
  /** For sudo_sync: the pending command details */
  pendingSudoCommand?: {
    command: string;
    parameters?: string[];
    timeout_ms?: number;
  };
  /** For workspace acknowledgement requirement */
  requiresWorkspaceAcknowledgement?: boolean;
}

// ============================================================================
// Environment & Security Guards
// ============================================================================

/**
 * Assert that we're running in a shell-capable environment
 */
function assertShellEnvironment(): void {
  if (!isShellEnvironment()) {
    throw new ShellError(
      'Shell tools are only available in Lima VM or Docker environments',
      'NOT_AVAILABLE'
    );
  }
}

/**
 * Assert that a resolved path is within the workspace directory
 */
function assertWithinWorkspace(resolvedPath: string, workspaceRoot: string): void {
  const normalizedPath = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(workspaceRoot);

  if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
    throw new ShellError(
      `Path traversal rejected: "${resolvedPath}" is outside the workspace boundary`,
      'PATH_TRAVERSAL'
    );
  }
}

/**
 * Get the default workspace directory for a chat/project
 */
function getDefaultWorkspaceDir(context: ShellToolContext): string {
  if (context.projectId) {
    return getWorkspaceProjectDir(context.projectId);
  }
  return getWorkspaceChatDir(context.chatId);
}

/**
 * Ensure a directory exists (create if needed)
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Clamp timeout to valid range
 */
function clampTimeout(timeout_ms?: number): number {
  if (!timeout_ms || timeout_ms <= 0) {
    return SHELL_TIMEOUT_DEFAULT;
  }
  return Math.min(timeout_ms, SHELL_TIMEOUT_MAX);
}

/**
 * Truncate output to max size
 */
function truncateOutput(output: string): string {
  if (output.length > SHELL_MAX_OUTPUT_SIZE) {
    return output.substring(0, SHELL_MAX_OUTPUT_SIZE) + '\n... [output truncated at 64KB]';
  }
  return output;
}

// ============================================================================
// Chat State Helpers
// ============================================================================

/**
 * Get shell session state from chat
 */
async function getShellState(chatId: string): Promise<ShellSessionState> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    throw new ShellError(`Chat not found: ${chatId}`, 'VALIDATION_ERROR');
  }

  // Parse state from the chat's state field
  const chatState = chat.state ? (typeof chat.state === 'string' ? JSON.parse(chat.state) : chat.state) : {};
  return chatState as ShellSessionState;
}

/**
 * Update shell session state in chat
 */
async function updateShellState(chatId: string, updates: Partial<ShellSessionState>): Promise<void> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);
  if (!chat) return;

  const chatState = chat.state ? (typeof chat.state === 'string' ? JSON.parse(chat.state) : chat.state) : {};
  const newState = { ...chatState, ...updates } as Record<string, unknown>;
  await repos.chats.update(chatId, { state: newState });
}

/**
 * Get the current working directory for a shell session
 */
async function getWorkingDirectory(context: ShellToolContext): Promise<string> {
  const state = await getShellState(context.chatId);
  const cwd = state.shellWorkingDirectory || getDefaultWorkspaceDir(context);
  ensureDir(cwd);
  return cwd;
}

// ============================================================================
// Main Dispatch
// ============================================================================

/**
 * Execute a shell tool by name
 */
export async function executeShellTool(
  toolName: ShellToolName,
  args: Record<string, unknown>,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  assertShellEnvironment();

  // Check workspace acknowledgement before executing any shell command
  const shellState = await getShellState(context.chatId);
  if (!shellState.workspaceWarningAcknowledged) {
    moduleLogger.info('Workspace acknowledgement required', { chatId: context.chatId, toolName });
    return {
      success: false,
      formattedText: 'Workspace acknowledgement is required before using shell tools.',
      requiresWorkspaceAcknowledgement: true,
    };
  }

  moduleLogger.info('Executing shell tool', {
    toolName,
    chatId: context.chatId,
    userId: context.userId,
    projectId: context.projectId,
  });

  switch (toolName) {
    case 'chdir':
      return handleChdir(args.path as string | undefined, context);
    case 'exec_sync':
      return handleExecSync(args, context);
    case 'exec_async':
      return handleExecAsync(args, context);
    case 'async_result':
      return handleAsyncResult(args.pid as number, context);
    case 'sudo_sync':
      return handleSudoSync(args, context);
    case 'cp_host':
      return handleCpHost(args.source as string, args.destination as string, context);
    default:
      throw new ShellError(`Unknown shell tool: ${toolName}`, 'VALIDATION_ERROR');
  }
}

// ============================================================================
// Individual Handlers
// ============================================================================

/**
 * Handle chdir - change working directory
 */
async function handleChdir(
  requestedPath: string | undefined,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  const workspaceRoot = getWorkspaceDir();
  let targetDir: string;

  if (!requestedPath || requestedPath.trim() === '') {
    // Reset to default
    targetDir = getDefaultWorkspaceDir(context);
  } else if (path.isAbsolute(requestedPath)) {
    targetDir = requestedPath;
  } else {
    // Relative path — resolve against current working directory
    const cwd = await getWorkingDirectory(context);
    targetDir = path.resolve(cwd, requestedPath);
  }

  // Security: must be within workspace
  assertWithinWorkspace(targetDir, workspaceRoot);

  // Create if needed
  ensureDir(targetDir);

  // Persist to chat state
  await updateShellState(context.chatId, { shellWorkingDirectory: targetDir });

  moduleLogger.info('Changed working directory', {
    chatId: context.chatId,
    newCwd: targetDir,
  });

  const result: ShellCommandResult = {
    exit_code: 0,
    stdout: targetDir,
    stderr: '',
    time_elapsed: 0,
  };

  return {
    success: true,
    formattedText: `Changed directory to: ${targetDir}`,
    result,
  };
}

/**
 * Handle exec_sync - synchronous command execution
 */
async function handleExecSync(
  args: Record<string, unknown>,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  const command = args.command as string;
  const parameters = (args.parameters as string[]) || [];
  const timeout = clampTimeout(args.timeout_ms as number | undefined);

  if (!command) {
    throw new ShellError('Command is required', 'VALIDATION_ERROR');
  }

  // Check for warnings
  const warnings = checkCommandWarnings(command, parameters);

  const cwd = await getWorkingDirectory(context);
  const startTime = Date.now();

  moduleLogger.info('Executing sync command', {
    chatId: context.chatId,
    userId: context.userId,
    command,
    parameters,
    timeout,
    cwd,
    warnings: warnings.length > 0 ? warnings : undefined,
  });

  const spawnResult = spawnSync(command, parameters, {
    cwd,
    timeout,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: getWorkspaceDir() },
  });

  const timeElapsed = Date.now() - startTime;

  const result: ShellCommandResult = {
    exit_code: spawnResult.status ?? 1,
    stdout: truncateOutput(spawnResult.stdout?.toString() || ''),
    stderr: truncateOutput(spawnResult.stderr?.toString() || ''),
    time_elapsed: timeElapsed,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  // Check for timeout
  if (spawnResult.signal === 'SIGTERM') {
    result.stderr += '\n[Process killed: timeout exceeded]';
    result.exit_code = 124; // Standard timeout exit code
  }

  moduleLogger.info('Sync command completed', {
    chatId: context.chatId,
    command,
    exitCode: result.exit_code,
    timeElapsed,
  });

  return {
    success: true,
    formattedText: formatCommandResult(command, parameters, result),
    result,
  };
}

/**
 * Handle exec_async - asynchronous command execution
 */
async function handleExecAsync(
  args: Record<string, unknown>,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  const command = args.command as string;
  const parameters = (args.parameters as string[]) || [];
  const timeout = clampTimeout(args.timeout_ms as number | undefined);

  if (!command) {
    throw new ShellError('Command is required', 'VALIDATION_ERROR');
  }

  // Check for warnings
  const warnings = checkCommandWarnings(command, parameters);

  const cwd = await getWorkingDirectory(context);

  moduleLogger.info('Starting async command', {
    chatId: context.chatId,
    userId: context.userId,
    command,
    parameters,
    timeout,
    cwd,
  });

  const childProcess = spawn(command, parameters, {
    cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: getWorkspaceDir() },
  });

  const pid = childProcess.pid;
  if (!pid) {
    throw new ShellError('Failed to start process', 'EXECUTION_ERROR');
  }

  // Register for tracking
  registerProcess(pid, childProcess, `${command} ${parameters.join(' ')}`.trim());

  // Set timeout to kill if exceeded
  const timeoutHandle = setTimeout(() => {
    try {
      childProcess.kill('SIGTERM');
    } catch {
      // Process may have already exited
    }
  }, timeout);

  childProcess.on('exit', () => {
    clearTimeout(timeoutHandle);
  });

  // Persist initial record to chat state
  const shellState = await getShellState(context.chatId);
  const asyncProcesses = shellState.shellAsyncProcesses || {};
  asyncProcesses[pid] = {
    pid,
    command: `${command} ${parameters.join(' ')}`.trim(),
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  await updateShellState(context.chatId, { shellAsyncProcesses: asyncProcesses });

  const result: ShellAsyncCommandResult = {
    pid,
    status: 'running',
    stdout: null,
    stderr: null,
  };

  const warningText = warnings.length > 0
    ? `\nWarnings: ${warnings.join('; ')}`
    : '';

  return {
    success: true,
    formattedText: `Started async process (PID ${pid}): ${command} ${parameters.join(' ')}${warningText}`,
    result,
  };
}

/**
 * Handle async_result - check status of async command
 */
async function handleAsyncResult(
  pid: number,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  if (!pid || typeof pid !== 'number') {
    throw new ShellError('PID is required and must be a number', 'VALIDATION_ERROR');
  }

  moduleLogger.debug('Checking async result', { chatId: context.chatId, pid });

  // Check in-memory registry first
  if (hasProcess(pid)) {
    const record = getProcessStatus(pid);
    if (record) {
      // Update chat state if process completed
      if (record.status !== 'running') {
        const shellState = await getShellState(context.chatId);
        const asyncProcesses = shellState.shellAsyncProcesses || {};
        asyncProcesses[pid] = record;
        await updateShellState(context.chatId, { shellAsyncProcesses: asyncProcesses });
      }

      const result: ShellAsyncCommandResult = {
        pid: record.pid,
        status: record.status,
        stdout: record.stdout || null,
        stderr: record.stderr || null,
        exit_code: record.exitCode,
      };

      return {
        success: true,
        formattedText: formatAsyncResult(record.command, result),
        result,
      };
    }
  }

  // Fall back to chat state (process may have been from a previous server instance)
  const shellState = await getShellState(context.chatId);
  const asyncProcesses = shellState.shellAsyncProcesses || {};
  const stateRecord = asyncProcesses[pid];

  if (stateRecord) {
    const result: ShellAsyncCommandResult = {
      pid: stateRecord.pid,
      status: stateRecord.status,
      stdout: stateRecord.stdout || null,
      stderr: stateRecord.stderr || null,
      exit_code: stateRecord.exitCode,
    };

    return {
      success: true,
      formattedText: formatAsyncResult(stateRecord.command, result),
      result,
    };
  }

  // Not found
  const result: ShellAsyncCommandResult = {
    pid,
    status: 'not_found',
    stdout: null,
    stderr: null,
  };

  return {
    success: true,
    formattedText: `Process ${pid} not found. It may have been from a previous session or an invalid PID.`,
    result,
  };
}

/**
 * Handle sudo_sync - request sudo command execution (requires approval)
 */
async function handleSudoSync(
  args: Record<string, unknown>,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  const command = args.command as string;
  const parameters = (args.parameters as string[]) || [];
  const timeout_ms = clampTimeout(args.timeout_ms as number | undefined);

  if (!command) {
    throw new ShellError('Command is required', 'VALIDATION_ERROR');
  }

  moduleLogger.info('Sudo command requested, awaiting user approval', {
    chatId: context.chatId,
    userId: context.userId,
    command,
    parameters,
  });

  // Don't execute — return approval request
  return {
    success: false,
    formattedText: 'Sudo command requires user approval before execution.',
    requiresSudoApproval: true,
    pendingSudoCommand: {
      command,
      parameters: parameters.length > 0 ? parameters : undefined,
      timeout_ms,
    },
  };
}

/**
 * Actually execute a sudo command (called after user approval)
 */
export async function executeSudoCommand(
  command: string,
  parameters: string[],
  timeout_ms: number,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  assertShellEnvironment();

  const cwd = await getWorkingDirectory(context);
  const startTime = Date.now();

  // Build sudo command
  const sudoArgs = [command, ...parameters];

  moduleLogger.info('Executing approved sudo command', {
    chatId: context.chatId,
    userId: context.userId,
    command: 'sudo',
    args: sudoArgs,
    cwd,
  });

  const spawnResult = spawnSync('sudo', sudoArgs, {
    cwd,
    timeout: timeout_ms,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: getWorkspaceDir() },
  });

  const timeElapsed = Date.now() - startTime;

  const result: ShellCommandResult = {
    exit_code: spawnResult.status ?? 1,
    stdout: truncateOutput(spawnResult.stdout?.toString() || ''),
    stderr: truncateOutput(spawnResult.stderr?.toString() || ''),
    time_elapsed: timeElapsed,
  };

  if (spawnResult.signal === 'SIGTERM') {
    result.stderr += '\n[Process killed: timeout exceeded]';
    result.exit_code = 124;
  }

  moduleLogger.info('Sudo command completed', {
    chatId: context.chatId,
    command,
    exitCode: result.exit_code,
    timeElapsed,
  });

  return {
    success: true,
    formattedText: formatCommandResult(`sudo ${command}`, parameters, result),
    result,
  };
}

/**
 * Handle cp_host - copy file between workspace and Files storage
 */
async function handleCpHost(
  source: string,
  destination: string,
  context: ShellToolContext
): Promise<ShellToolOutput> {
  if (!source || !destination) {
    throw new ShellError('Both source and destination are required', 'VALIDATION_ERROR');
  }

  moduleLogger.info('cp_host requested', {
    chatId: context.chatId,
    userId: context.userId,
    source,
    destination,
  });

  const workspaceRoot = getWorkspaceDir();

  // Parse source and destination formats
  const sourceIsWorkspace = source.startsWith('workspace:');
  const destIsWorkspace = destination.startsWith('workspace:');
  const sourceIsFiles = source.startsWith('files:');
  const destIsFiles = destination.startsWith('files:');

  if (sourceIsWorkspace && destIsFiles) {
    // Workspace → Files: security-filtered copy
    return copyWorkspaceToFiles(source, context, workspaceRoot);
  } else if (sourceIsFiles && destIsWorkspace) {
    // Files → Workspace: direct copy
    return copyFilesToWorkspace(source, destination, context, workspaceRoot);
  } else {
    throw new ShellError(
      'Invalid source/destination format. Use "workspace:/path" for workspace files and "files:fileId" for Files storage.',
      'VALIDATION_ERROR'
    );
  }
}

/**
 * Copy a file from workspace to Files storage
 */
async function copyWorkspaceToFiles(
  source: string,
  context: ShellToolContext,
  workspaceRoot: string
): Promise<ShellToolOutput> {
  const relativePath = source.replace('workspace:', '');
  const cwd = await getWorkingDirectory(context);
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(cwd, relativePath);

  // Security check
  assertWithinWorkspace(absolutePath, workspaceRoot);

  if (!fs.existsSync(absolutePath)) {
    throw new ShellError(`File not found: ${absolutePath}`, 'VALIDATION_ERROR');
  }

  // Check for binary executable
  if (isBinaryExecutable(fs.readFileSync(absolutePath, { length: 4 } as never).subarray(0, 4))) {
    moduleLogger.warn('Binary executable rejected from workspace-to-files copy', {
      path: absolutePath,
    });
    throw new ShellError(
      'Binary executables cannot be copied from workspace to Files storage for security reasons.',
      'VALIDATION_ERROR'
    );
  }

  // Strip execute bits on the workspace copy
  stripExecuteBits(absolutePath);

  // Read file content
  const content = fs.readFileSync(absolutePath);
  const filename = path.basename(absolutePath);

  // Project-scoped shells keep landing in the project mount (FSM →
  // project-store-bridge). Project-less shells land in the Quilltap Uploads
  // mount under shell/, not the catch-all _general/.
  let storageKey: string;
  let fileFolderPath: string | null;
  let fileProjectId: string | null;
  if (context.projectId) {
    const uploaded = await fileStorageManager.uploadFile({
      filename,
      content,
      contentType: 'application/octet-stream',
      projectId: context.projectId,
      folderPath: '/',
    });
    storageKey = uploaded.storageKey;
    fileFolderPath = '/';
    fileProjectId = context.projectId;
  } else {
    const written = await writeUserUploadToMountStore({
      filename,
      content,
      contentType: 'application/octet-stream',
      subfolder: 'shell',
    });
    storageKey = written.storageKey;
    fileFolderPath = null;
    fileProjectId = null;
  }

  // Create file record in database
  const repos = getRepositories();
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const fileRecord = await repos.files.create({
    userId: context.userId,
    sha256,
    originalFilename: filename,
    mimeType: 'application/octet-stream',
    size: content.length,
    linkedTo: [],
    source: 'UPLOADED' as const,
    category: 'DOCUMENT' as const,
    storageKey,
    tags: [],
    projectId: fileProjectId,
    folderPath: fileFolderPath,
  });
  const fileId = fileRecord.id;

  moduleLogger.info('Copied workspace file to Files storage', {
    source: absolutePath,
    fileId,
    filename,
    size: content.length,
  });

  const result: ShellCommandResult = {
    exit_code: 0,
    stdout: `Copied ${filename} to Files storage (ID: ${fileId})`,
    stderr: '',
    time_elapsed: 0,
  };

  return {
    success: true,
    formattedText: `Copied workspace file "${filename}" to Files storage (ID: ${fileId})`,
    result,
  };
}

/**
 * Copy a file from Files storage to workspace
 */
async function copyFilesToWorkspace(
  source: string,
  destination: string,
  context: ShellToolContext,
  workspaceRoot: string
): Promise<ShellToolOutput> {
  const fileId = source.replace('files:', '');
  const destPath = destination.replace('workspace:', '');

  if (!fileId) {
    throw new ShellError('File ID is required in source', 'VALIDATION_ERROR');
  }

  // Look up file record
  const repos = getRepositories();
  const fileRecord = await repos.files.findById(fileId);
  if (!fileRecord) {
    throw new ShellError(`File not found in storage: ${fileId}`, 'VALIDATION_ERROR');
  }

  // Resolve destination path
  const cwd = await getWorkingDirectory(context);
  const absoluteDest = path.isAbsolute(destPath)
    ? destPath
    : path.resolve(cwd, destPath);

  // Security check
  assertWithinWorkspace(absoluteDest, workspaceRoot);

  // Ensure parent directory exists
  ensureDir(path.dirname(absoluteDest));

  // Read file from storage and write to workspace
  const basePath = fileStorageManager.getBasePath();
  const storageKey = fileRecord.storageKey;
  if (!storageKey) {
    throw new ShellError(`File has no storage key: ${fileId}`, 'EXECUTION_ERROR');
  }
  const sourcePath = path.join(basePath, storageKey);

  if (!fs.existsSync(sourcePath)) {
    throw new ShellError(`File content not found on disk: ${storageKey}`, 'EXECUTION_ERROR');
  }

  fs.copyFileSync(sourcePath, absoluteDest);

  moduleLogger.info('Copied file from Files storage to workspace', {
    fileId,
    filename: fileRecord.originalFilename,
    destination: absoluteDest,
  });

  const result: ShellCommandResult = {
    exit_code: 0,
    stdout: `Copied ${fileRecord.originalFilename} to ${absoluteDest}`,
    stderr: '',
    time_elapsed: 0,
  };

  return {
    success: true,
    formattedText: `Copied "${fileRecord.originalFilename}" from Files to workspace: ${absoluteDest}`,
    result,
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a sync command result for LLM consumption
 */
function formatCommandResult(command: string, parameters: string[], result: ShellCommandResult): string {
  const parts: string[] = [];
  const fullCmd = parameters.length > 0 ? `${command} ${parameters.join(' ')}` : command;

  parts.push(`Command: ${fullCmd}`);
  parts.push(`Exit Code: ${result.exit_code}`);
  parts.push(`Time: ${result.time_elapsed}ms`);

  if (result.stdout) {
    parts.push(`\nStdout:\n${result.stdout}`);
  }
  if (result.stderr) {
    parts.push(`\nStderr:\n${result.stderr}`);
  }
  if (result.warnings && result.warnings.length > 0) {
    parts.push(`\nWarnings:\n${result.warnings.map(w => `- ${w}`).join('\n')}`);
  }

  return parts.join('\n');
}

/**
 * Format an async command result for LLM consumption
 */
function formatAsyncResult(command: string, result: ShellAsyncCommandResult): string {
  const parts: string[] = [];

  parts.push(`PID: ${result.pid}`);
  parts.push(`Command: ${command}`);
  parts.push(`Status: ${result.status}`);

  if (result.exit_code !== undefined) {
    parts.push(`Exit Code: ${result.exit_code}`);
  }
  if (result.stdout) {
    parts.push(`\nStdout:\n${result.stdout}`);
  }
  if (result.stderr) {
    parts.push(`\nStderr:\n${result.stderr}`);
  }

  return parts.join('\n');
}

/**
 * Format shell tool results for inclusion in conversation context
 */
export function formatShellResults(output: ShellToolOutput): string {
  return output.formattedText;
}
