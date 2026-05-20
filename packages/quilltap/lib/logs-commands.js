'use strict';

const path = require('path');
const fs = require('fs');
const { resolveDataDirAndPassphrase, printDefaultInstanceHint } = require('./db-helpers');

// ANSI color codes
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const GRAY = '\x1b[90m';

const VALID_STREAMS = new Set(['combined', 'error', 'stdout', 'stderr', 'startup']);

function isTty() {
  return Boolean(process.stdout.isTTY);
}

function colorize(text, color) {
  if (!isTty()) return text;
  return `${color}${text}${RESET}`;
}

/**
 * Extract the level from a log line (JSON).
 * Returns one of: error, warn, info, debug, trace, or null if unparseable.
 */
function extractLogLevel(line) {
  try {
    const obj = JSON.parse(line);
    return obj.level || null;
  } catch {
    return null;
  }
}

/**
 * Color a log line based on its level. Timestamps are dimmed;
 * the full line is colored by level.
 */
function colorizeLogLine(line) {
  if (!isTty()) return line;

  const level = extractLogLevel(line);
  let color = RESET;

  switch (level) {
    case 'error':
      color = RED;
      break;
    case 'warn':
      color = YELLOW;
      break;
    case 'info':
      color = BLUE;
      break;
    case 'debug':
      color = GRAY;
      break;
    default:
      // For unparseable or unknown levels, try substring matching
      if (line.includes('"level":"error"')) color = RED;
      else if (line.includes('"level":"warn"')) color = YELLOW;
      else if (line.includes('"level":"info"')) color = BLUE;
      else if (line.includes('"level":"debug"')) color = GRAY;
      break;
  }

  return `${color}${line}${RESET}`;
}

/**
 * Parse command-line arguments for the logs command.
 */
function parseFlags(args) {
  const flags = {
    dataDir: '',
    instance: '',
    passphrase: '',
    stream: 'combined',
    tail: 100,
    follow: false,
    grep: '',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (arg === '-d' || arg === '--data-dir') {
      flags.dataDir = args[++i];
    } else if (arg === '-i' || arg === '--instance') {
      flags.instance = args[++i];
    } else if (arg === '--passphrase') {
      flags.passphrase = args[++i];
    } else if (arg === '-f' || arg === '--follow') {
      flags.follow = true;
    } else if (arg === '--stream') {
      flags.stream = args[++i];
    } else if (arg === '--tail') {
      flags.tail = parseInt(args[++i], 10) || 100;
    } else if (arg === '--grep') {
      flags.grep = args[++i];
    }
  }

  return flags;
}

/**
 * Print help text for the logs command.
 */
function printLogsHelp() {
  console.log(`
Quilltap Logs Tool

Usage: quilltap logs [options]

Print or follow an instance's log files.

Options:
  -d, --data-dir <path>        Override data directory
  -i, --instance <name>        Use a registered instance (see 'quilltap instances')
  --passphrase <pass>          Decrypt .dbkey if peppered
  --stream <name>              Which log to read (default: combined)
                               Values: combined, error, stdout, stderr, startup
                               Comma-separated for multiple streams
  --tail N                     Last N lines (default: 100; 0 = full file)
  -f, --follow                 Keep streaming as new lines arrive (like tail -F)
  --grep <pattern>             Filter lines by regex pattern
  -h, --help                   Show this help
`);
}

/**
 * Resolve the logs directory from the data dir.
 * dataDir is the path to <instance>/data, so logs are <instance>/logs
 */
function getLogsDir(dataDir) {
  return path.join(path.dirname(dataDir), 'logs');
}

/**
 * Map stream names to file names.
 */
function streamToFilename(stream) {
  switch (stream) {
    case 'combined':
      return 'combined.log';
    case 'error':
      return 'error.log';
    case 'stdout':
      return 'quilltap-stdout.log';
    case 'stderr':
      return 'quilltap-stderr.log';
    case 'startup':
      return 'startup.log';
    default:
      return null;
  }
}

/**
 * Read the tail N lines from a file synchronously.
 * If N is 0, return the entire file.
 */
function readTail(filePath, n) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.length > 0);

  if (n === 0) {
    return lines;
  }

  return lines.slice(Math.max(0, lines.length - n));
}

/**
 * Filter lines by a grep pattern (JS regex).
 */
function filterLines(lines, pattern) {
  if (!pattern) return lines;

  try {
    const re = new RegExp(pattern);
    return lines.filter(line => re.test(line));
  } catch (e) {
    console.error(`Invalid grep pattern: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Print lines to stdout, optionally with a stream prefix.
 */
function printLines(lines, prefix = null) {
  for (const line of lines) {
    const output = prefix ? `[${prefix}] ${line}` : line;
    console.log(colorizeLogLine(output));
  }
}

/**
 * Follow a log file (or multiple files) as new lines arrive.
 * Handles file rotation: re-opens on inode change or size reduction.
 */
async function followLogs(logsDir, streams, grepPattern) {
  const filePaths = {};
  const fileState = {};
  let lastOutputTime = Date.now();

  // Initialize file tracking
  for (const stream of streams) {
    const filename = streamToFilename(stream);
    if (!filename) {
      console.error(`Invalid stream: ${stream}`);
      process.exit(1);
    }

    const filePath = path.join(logsDir, filename);
    filePaths[stream] = filePath;

    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      fileState[stream] = {
        ino: stat.ino,
        size: stat.size,
        position: stat.size,
      };
    } else {
      fileState[stream] = {
        ino: null,
        size: 0,
        position: 0,
      };
    }
  }

  const watchDir = logsDir;
  const watcher = fs.watch(watchDir, { persistent: true }, (eventType, filename) => {
    // On any event, check each tracked file for changes
    for (const stream of streams) {
      const filePath = filePaths[stream];
      const logFilename = path.basename(filePath);

      // Check if this event is about our file or a rotation of it
      if (!filename || filename === logFilename || filename.startsWith(logFilename.replace('.log', '.'))) {
        try {
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            const state = fileState[stream];

            // Detect rotation: inode changed or size decreased
            if (state.ino !== null && (stat.ino !== state.ino || stat.size < state.position)) {
              state.ino = stat.ino;
              state.size = stat.size;
              state.position = 0; // Reset position on rotation
              return;
            }

            // If file exists and has grown, read new content
            if (stat.size > state.position) {
              state.ino = stat.ino;
              state.size = stat.size;

              const fd = fs.openSync(filePath, 'r');
              const buffer = Buffer.alloc(state.size - state.position);
              fs.readSync(fd, buffer, 0, buffer.length, state.position);
              fs.closeSync(fd);

              const newContent = buffer.toString('utf-8');
              const newLines = newContent.split('\n').filter(line => line.length > 0);

              let linesToPrint = filterLines(newLines, grepPattern);
              const streamPrefix = streams.length > 1 ? stream : null;

              printLines(linesToPrint, streamPrefix);

              state.position = stat.size;
              lastOutputTime = Date.now();
            }
          } else if (fileState[stream].ino !== null) {
            // File was deleted; reset state
            fileState[stream] = { ino: null, size: 0, position: 0 };
          }
        } catch (e) {
          // Ignore transient errors (file locked, etc.)
        }
      }
    }
  });

  // Keep the watcher alive indefinitely
  await new Promise(() => {
    // This never resolves; the user must Ctrl+C to exit
  });
}

/**
 * Main entry point for the logs command.
 */
async function logsCommand(args) {
  const flags = parseFlags(args);

  if (flags.help) {
    printLogsHelp();
    return;
  }

  try {
    const { dataDir, instanceName, usedPlatformDefault } = resolveDataDirAndPassphrase({
      dataDir: flags.dataDir,
      instance: flags.instance,
      passphrase: flags.passphrase,
    });

    if (usedPlatformDefault) {
      printDefaultInstanceHint();
    }

    const logsDir = getLogsDir(dataDir);

    // Parse stream argument (comma-separated)
    const streamList = flags.stream
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Validate streams
    for (const stream of streamList) {
      if (!VALID_STREAMS.has(stream)) {
        console.error(`Invalid stream: ${stream}. Valid values: ${Array.from(VALID_STREAMS).join(', ')}`);
        process.exit(1);
      }
    }

    if (streamList.length === 0) {
      console.error('No streams specified.');
      process.exit(1);
    }

    // Follow mode
    if (flags.follow) {
      await followLogs(logsDir, streamList, flags.grep);
      return;
    }

    // Print mode (tail)
    const allLines = [];

    for (const stream of streamList) {
      const filename = streamToFilename(stream);
      const filePath = path.join(logsDir, filename);

      const lines = readTail(filePath, flags.tail);
      const filtered = filterLines(lines, flags.grep);

      const streamPrefix = streamList.length > 1 ? stream : null;
      printLines(filtered, streamPrefix);

      allLines.push(...filtered);
    }

    if (allLines.length === 0 && flags.tail > 0) {
      console.error('No matching log entries.');
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

module.exports = {
  logsCommand,
};
