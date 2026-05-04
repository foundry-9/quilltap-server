/**
 * Shell Tool Definitions
 *
 * Six tools for shell interactivity inside Lima VM / Docker environments:
 * - chdir: Change working directory
 * - exec_sync: Execute a command synchronously
 * - exec_async: Execute a command asynchronously
 * - async_result: Fetch result of an async command
 * - sudo_sync: Execute a command with elevated privileges (requires approval)
 * - cp_host: Copy files between workspace and Files storage
 *
 * @module tools/shell/shell-tools
 */

// ============================================================================
// Tool Definitions (OpenAI/Universal format)
// ============================================================================

export const shellChdirToolDefinition = {
  type: 'function',
  function: {
    name: 'chdir',
    description:
      'Change the working directory for shell commands in this chat session. If no path is provided, resets to the default workspace directory. The directory must be within the workspace. Creates the directory if it does not exist. IMPORTANT: Paths are relative to the current workspace directory. Use "./subdir" or "subdir" to navigate within the workspace. Do NOT use absolute paths like "/something" — those refer to the VM root filesystem and will be rejected. The workspace is your sandboxed working area.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to change to, relative to the current workspace directory (e.g., "subdir", "./subdir", "../otherdir"). Absolute paths starting with "/" refer to the VM root filesystem, NOT the workspace root, and will be rejected unless they fall within the workspace boundary. If omitted or empty, resets to the default workspace directory for this chat.',
        },
      },
      required: [],
    },
  },
};

export const shellExecSyncToolDefinition = {
  type: 'function',
  function: {
    name: 'exec_sync',
    description:
      'Execute a shell command synchronously and wait for it to complete. Returns stdout, stderr, exit code, and elapsed time. The command runs in the current working directory (set via chdir or the default workspace). Use for quick commands that complete within the timeout. IMPORTANT: File paths in your commands should be relative to the current workspace directory (e.g., "./myfile.txt" or "subdir/file.txt"). Absolute paths like "/etc/something" refer to the VM root filesystem, not the workspace.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute (e.g., "ls", "echo", "python3", "git")',
        },
        parameters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments as separate strings (e.g., ["-la", "/tmp"]). Preferred over including arguments in the command string for safety.',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 300000,
          description: 'Timeout in milliseconds (default: 60000, max: 300000). Command is killed if it exceeds this.',
          default: 60000,
        },
      },
      required: ['command'],
    },
  },
};

export const shellExecAsyncToolDefinition = {
  type: 'function',
  function: {
    name: 'exec_async',
    description:
      'Execute a shell command asynchronously in the background. Returns immediately with a PID that can be used with async_result to check status and retrieve output. Use for long-running commands like builds, downloads, or server processes. IMPORTANT: File paths in your commands should be relative to the current workspace directory (e.g., "./myfile.txt" or "subdir/file.txt"). Absolute paths like "/etc/something" refer to the VM root filesystem, not the workspace.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute in the background',
        },
        parameters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments as separate strings',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 300000,
          description: 'Maximum runtime in milliseconds before the process is killed (default: 300000). The process runs in background until completion or timeout.',
          default: 300000,
        },
      },
      required: ['command'],
    },
  },
};

export const shellAsyncResultToolDefinition = {
  type: 'function',
  function: {
    name: 'async_result',
    description:
      'Check the status and retrieve output of a previously started async command. Returns the current status (running, complete, timeout, not_found) along with any captured stdout and stderr.',
    parameters: {
      type: 'object',
      properties: {
        pid: {
          type: 'integer',
          description: 'The process ID returned by exec_async',
        },
      },
      required: ['pid'],
    },
  },
};

export const shellSudoSyncToolDefinition = {
  type: 'function',
  function: {
    name: 'sudo_sync',
    description:
      'Execute a shell command with elevated (root) privileges. Requires explicit user approval before execution. Use for system administration tasks like installing packages (apt-get install), modifying system configuration, or managing services. The command will NOT execute until the user approves it. Note: Unlike other shell tools, sudo commands may legitimately need absolute paths (e.g., "/etc/apt") since they operate on the VM system. The working directory is still the workspace.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute as root (e.g., "apt-get", "systemctl")',
        },
        parameters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments as separate strings (e.g., ["install", "-y", "python3"])',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 300000,
          description: 'Timeout in milliseconds (default: 60000, max: 300000)',
          default: 60000,
        },
      },
      required: ['command'],
    },
  },
};

export const shellCpHostToolDefinition = {
  type: 'function',
  function: {
    name: 'cp_host',
    description:
      'Copy a file between the workspace and the Files storage area. Use "workspace:path" format for workspace files and "files:fileId" format for Files storage entries. Workspace-to-Files copies are subject to security filters (binary executables are rejected, execute bits are stripped). IMPORTANT: The path after "workspace:" is relative to the current workspace directory (e.g., "workspace:myfile.txt", "workspace:subdir/file.txt"). Do NOT use a leading "/" after "workspace:" unless you intend an absolute VM filesystem path (which will be rejected if outside the workspace).',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source path. Use "workspace:relative/path" for workspace files (relative to current working directory) or "files:fileId" for a file in Files storage. Example: "workspace:output.txt" or "files:abc123".',
        },
        destination: {
          type: 'string',
          description: 'Destination path. Use "workspace:relative/path" for workspace files (relative to current working directory) or "files:" to create a new entry in Files storage with auto-generated ID. Example: "workspace:result.txt" or "files:".',
        },
      },
      required: ['source', 'destination'],
    },
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get all shell tool definitions in universal (OpenAI) format
 */
export function getAllShellToolDefinitions() {
  return [
    shellChdirToolDefinition,
    shellExecSyncToolDefinition,
    shellExecAsyncToolDefinition,
    shellAsyncResultToolDefinition,
    shellSudoSyncToolDefinition,
    shellCpHostToolDefinition,
  ];
}

/**
 * All shell tool names
 */
export const SHELL_TOOL_NAMES = [
  'chdir',
  'exec_sync',
  'exec_async',
  'async_result',
  'sudo_sync',
  'cp_host',
] as const;

export type ShellToolName = typeof SHELL_TOOL_NAMES[number];

/**
 * Check if a tool name is a shell tool
 */
export function isShellTool(name: string): name is ShellToolName {
  return (SHELL_TOOL_NAMES as readonly string[]).includes(name);
}
