/**
 * Shell Tools Module
 *
 * Exports all shell tool definitions, handlers, types, and utilities.
 *
 * @module tools/shell
 */

// Types
export type {
  ShellSessionState,
  AsyncProcessRecord,
  ShellCommandRequest,
  ShellCommandResult,
  ShellAsyncCommandResult,
  ShellToolContext,
} from './shell-session.types';

export {
  SHELL_TIMEOUT_DEFAULT,
  SHELL_TIMEOUT_MAX,
  SHELL_MAX_OUTPUT_SIZE,
} from './shell-session.types';

// Tool definitions
export {
  shellChdirToolDefinition,
  shellExecSyncToolDefinition,
  shellExecAsyncToolDefinition,
  shellAsyncResultToolDefinition,
  shellSudoSyncToolDefinition,
  shellCpHostToolDefinition,
  getAllShellToolDefinitions,
  SHELL_TOOL_NAMES,
  isShellTool,
  type ShellToolName,
} from './shell-tools';

// Handlers
export {
  executeShellTool,
  executeSudoCommand,
  formatShellResults,
  ShellError,
  type ShellToolOutput,
} from './shell-handler';

// Utilities
export { checkCommandWarnings } from './command-warnings';
export { isBinaryExecutable, isFileBinaryExecutable, stripExecuteBits } from './binary-detector';
export {
  registerProcess,
  getProcessStatus,
  killProcess,
  hasProcess,
  cleanupOldProcesses,
  getProcessCount,
  clearAllProcesses,
} from './async-process-registry';
