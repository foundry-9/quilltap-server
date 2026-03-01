/**
 * Command Warnings
 *
 * Warning system for suspicious shell commands. These are not blocks —
 * the VM sandbox is the real protection. Warnings are logged and included
 * in tool result metadata to inform both the user and the LLM.
 *
 * @module tools/shell/command-warnings
 */

import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'command-warnings' });

interface WarningPattern {
  /** Regex pattern to match against the full command string */
  pattern: RegExp;
  /** Warning message to display */
  message: string;
}

/**
 * Patterns that trigger warnings (not blocks)
 */
const WARNING_PATTERNS: WarningPattern[] = [
  // SSH to host gateway — may be an attempt to reach the host machine
  {
    pattern: /\bssh\b.*\b(10\.0\.2\.2|host\.docker\.internal|host\.lima\.internal|172\.17\.0\.1|192\.168\.\d+\.1)\b/i,
    message: 'This command appears to SSH into the host machine. The workspace sandbox cannot protect the host from commands run via SSH.',
  },
  // Destructive filesystem operations
  {
    pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\//,
    message: 'This command recursively force-removes from the root filesystem. While this cannot affect the host, it may destroy the VM environment.',
  },
  {
    pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+~\//,
    message: 'This command recursively force-removes from the home directory.',
  },
  // Filesystem formatting
  {
    pattern: /\bmkfs\b/,
    message: 'This command creates a filesystem. This is destructive and may corrupt the VM environment.',
  },
  // Direct disk writes
  {
    pattern: /\bdd\b.*\bif=/,
    message: 'This command performs raw disk I/O. Ensure you understand what it writes and where.',
  },
  // Fork bombs
  {
    pattern: /:\(\)\{\s*:\|:\s*&\s*\};:|\.\/bomb|while\s+true.*fork/,
    message: 'This command may be a fork bomb or resource exhaustion attack.',
  },
  // Downloading and executing in one step
  {
    pattern: /\b(curl|wget)\b.*\|\s*(ba)?sh\b/,
    message: 'This command downloads and pipes directly to a shell. The downloaded script will execute without review.',
  },
  // Modifying SSH keys
  {
    pattern: />\s*~?\/?\.ssh\/authorized_keys/,
    message: 'This command modifies SSH authorized keys, which could grant persistent access.',
  },
  // Reverse shells
  {
    pattern: /\b(nc|ncat|netcat)\b.*-[a-z]*e\s/,
    message: 'This command may create a reverse shell connection.',
  },
  {
    pattern: /\/dev\/tcp\//,
    message: 'This command uses /dev/tcp which may be used for network connections or reverse shells.',
  },
  // Crontab modification
  {
    pattern: /\bcrontab\b/,
    message: 'This command modifies scheduled tasks. Persistent tasks survive session boundaries.',
  },
  // Shutdown/reboot
  {
    pattern: /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/,
    message: 'This command will shut down or reboot the VM environment.',
  },
];

/**
 * Check a command string for suspicious patterns and return warnings
 *
 * @param command The command string to check
 * @param parameters Optional command parameters
 * @returns Array of warning messages (empty if no warnings)
 */
export function checkCommandWarnings(command: string, parameters?: string[]): string[] {
  // Build full command string for pattern matching
  const fullCommand = parameters && parameters.length > 0
    ? `${command} ${parameters.join(' ')}`
    : command;

  const warnings: string[] = [];

  for (const { pattern, message } of WARNING_PATTERNS) {
    if (pattern.test(fullCommand)) {
      warnings.push(message);
    }
  }

  if (warnings.length > 0) {
    moduleLogger.warn('Shell command triggered warnings', {
      command: fullCommand,
      warningCount: warnings.length,
      warnings,
    });
  }

  return warnings;
}
