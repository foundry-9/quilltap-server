/**
 * The logger the CLI's theme engine bundle is built with: the same shape as
 * `@/lib/logger`, writing nothing unless QUILLTAP_THEME_DEBUG is set, when
 * debug and above go to stderr. The CLI reports results itself.
 *
 * @module themes/cli/logger
 */

type Context = Record<string, unknown>;

interface CliLogger {
  error(message: string, context?: Context): void;
  warn(message: string, context?: Context): void;
  info(message: string, context?: Context): void;
  debug(message: string, context?: Context): void;
  child(context: Context): CliLogger;
}

function make(base: Context): CliLogger {
  const write = (level: string) => (message: string, context?: Context) => {
    if (!process.env.QUILLTAP_THEME_DEBUG) return;
    process.stderr.write(`[theme-engine] ${level} ${message} ${JSON.stringify({ ...base, ...context })}\n`);
  };
  return {
    error: write('error'),
    warn: write('warn'),
    info: write('info'),
    debug: write('debug'),
    child: (context: Context) => make({ ...base, ...context }),
  };
}

export const logger: CliLogger = make({});
