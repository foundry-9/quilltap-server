import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/**
 * create-quilltap-theme — scaffolds a version 2 .qtap-theme bundle: a
 * manifest and a tokens document that name their JSON Schemas, a short
 * stylesheet written against the app's hooks, and a README.
 */

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * The hook catalogue version the template stylesheet is written against
 * (HOOK_CATALOGUE_VERSION in the app's lib/themes/hooks). The scaffold test
 * fails when the two disagree.
 */
export const HOOKS_VERSION = 1;

interface ThemeConfig {
  themeId: string;
  displayName: string;
  description: string;
  authorName: string;
  authorEmail: string;
  primaryColor: string;
  includeCssOverrides: boolean;
}

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message: string): void {
  console.log(message);
}

function success(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function info(message: string): void {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

function error(message: string): void {
  console.error(`${colors.red}✗${colors.reset} ${message}`);
}

function heading(message: string): void {
  console.log(`\n${colors.bold}${colors.blue}${message}${colors.reset}\n`);
}

// Convert "My Cool Theme" to "my-cool-theme"
function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Convert "my-cool-theme" to "My Cool Theme"
function toTitleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Prompt for user input
function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const displayDefault = defaultValue ? ` ${colors.dim}(${defaultValue})${colors.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${displayDefault}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// Prompt for yes/no
function promptYesNo(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean = true
): Promise<boolean> {
  const defaultStr = defaultValue ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`${question} ${colors.dim}(${defaultStr})${colors.reset}: `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultValue);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

// Read template file and replace placeholders. Every value is written into
// JSON or CSS, so each is JSON-escaped (strings in templates sit inside
// quotes; the author is a whole JSON value).
function processTemplate(templatePath: string, config: ThemeConfig): string {
  const content = fs.readFileSync(templatePath, 'utf-8');
  const inString = (value: string) => JSON.stringify(value).slice(1, -1);
  const author = config.authorEmail
    ? { name: config.authorName, email: config.authorEmail }
    : config.authorName;
  return content
    .replace(/\{\{THEME_ID\}\}/g, config.themeId)
    .replace(/\{\{DISPLAY_NAME\}\}/g, inString(config.displayName))
    .replace(/\{\{DESCRIPTION\}\}/g, inString(config.description))
    .replace(/\{\{AUTHOR_JSON\}\}/g, JSON.stringify(author))
    .replace(/\{\{PRIMARY_COLOR\}\}/g, inString(config.primaryColor))
    .replace(/\{\{STYLES_ENTRY\}\}/g, config.includeCssOverrides ? `,\n  "stylesPath": "styles.css",\n  "hooksVersion": ${HOOKS_VERSION}` : '');
}

// Copy and process a template file
function copyTemplate(templateName: string, destPath: string, config: ThemeConfig, destName: string): void {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateName}`);
  }
  fs.writeFileSync(path.join(destPath, destName), processTemplate(templatePath, config), 'utf-8');
  success(`Created ${destName}`);
}

// Scaffold a version 2 theme bundle
function scaffoldBundle(config: ThemeConfig): void {
  const destPath = path.resolve(process.cwd(), config.themeId);

  if (fs.existsSync(destPath)) {
    error(`Directory "${config.themeId}" already exists.`);
    process.exit(1);
  }

  heading('Creating your Quilltap theme bundle...');

  fs.mkdirSync(destPath, { recursive: true });
  success(`Created ${config.themeId}/`);

  copyTemplate('bundle/theme.json.template', destPath, config, 'theme.json');
  copyTemplate('bundle/tokens.json.template', destPath, config, 'tokens.json');
  if (config.includeCssOverrides) {
    copyTemplate('bundle/styles.css.template', destPath, config, 'styles.css');
  }
  copyTemplate('bundle/README.md.template', destPath, config, 'README.md');

  heading('Done! Next steps:');

  log(`  ${colors.dim}# Edit tokens.json (and styles.css), then check your work:${colors.reset}`);
  log(`  ${colors.cyan}quilltap themes validate ./${config.themeId}${colors.reset}`);
  log('');
  log(`  ${colors.dim}# Pack and install:${colors.reset}`);
  log(`  ${colors.cyan}cd ${config.themeId} && zip -r ../${config.themeId}.qtap-theme . && cd ..${colors.reset}`);
  log(`  ${colors.cyan}quilltap themes install ${config.themeId}.qtap-theme${colors.reset}`);
  log(`  ${colors.dim}# ...or upload the .qtap-theme file in Settings > Appearance > Install Theme${colors.reset}`);
  log('');
  info('Token reference: https://github.com/foundry-9/quilltap-server/blob/main/docs/developer/THEME_TOKENS.md');
  info('Hook reference:  https://github.com/foundry-9/quilltap-server/blob/main/docs/developer/THEME_HOOKS.md');
  log('');
}

// Parse command line arguments
function parseArgs(): { themeName?: string; help: boolean; yes: boolean; unknown: string[] } {
  const args = process.argv.slice(2);
  let themeName: string | undefined;
  let help = false;
  let yes = false;
  const unknown: string[] = [];

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-y' || arg === '--yes') {
      yes = true;
    } else if (arg.startsWith('-')) {
      unknown.push(arg);
    } else {
      themeName = arg;
    }
  }

  return { themeName, help, yes, unknown };
}

// Show help
function showHelp(): void {
  log(`
${colors.bold}create-quilltap-theme${colors.reset} - Scaffold a new Quilltap theme bundle

${colors.bold}Usage:${colors.reset}
  npm init quilltap-theme [theme-name] [options]
  npx create-quilltap-theme [theme-name] [options]

${colors.bold}Arguments:${colors.reset}
  theme-name    Name for your theme (e.g., "sunset", "ocean-breeze")

${colors.bold}Options:${colors.reset}
  -y, --yes       Skip prompts and use defaults
  -h, --help      Show this help message

${colors.bold}Examples:${colors.reset}
  npm init quilltap-theme my-theme
  npx create-quilltap-theme sunset --yes

${colors.bold}Creates:${colors.reset}
  <theme-name>/
  ├── theme.json      # Manifest (version 2)
  ├── tokens.json     # Primitives, token overrides and choices
  ├── styles.css      # Custom CSS against the app's hooks (optional)
  └── README.md       # Where to go next

  No build tools required: edit JSON and CSS, validate, zip, install.
`);
}

// Main entry point
async function main(): Promise<void> {
  const { themeName: argThemeName, help, yes, unknown } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (unknown.includes('--plugin')) {
    error('The npm plugin theme format is no longer supported; Quilltap loads .qtap-theme bundles only.');
    process.exit(1);
  }
  if (unknown.length > 0) {
    error(`Unknown option: ${unknown[0]}`);
    process.exit(1);
  }

  log('');
  log(`${colors.bold}${colors.blue}  create-quilltap-theme${colors.reset}`);
  log(`${colors.dim}  Scaffold a new Quilltap theme bundle (.qtap-theme, version 2)${colors.reset}`);
  log('');

  const rl = yes ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    let themeName = argThemeName;
    if (!themeName && rl) {
      themeName = await prompt(rl, 'Theme name (e.g., sunset, ocean-breeze)', 'my-theme');
    }
    const themeId = toKebabCase(themeName || 'my-theme');
    if (!/^[a-z][a-z0-9-]*$/.test(themeId)) {
      error('A theme name must start with a letter.');
      process.exit(1);
    }

    const config: ThemeConfig = {
      themeId,
      displayName: toTitleCase(themeId),
      description: 'A custom theme for Quilltap',
      authorName: 'Your Name',
      authorEmail: '',
      primaryColor: 'hsl(220 90% 50%)',
      includeCssOverrides: true,
    };

    if (rl) {
      config.description = await prompt(rl, 'Description', config.description);
      config.authorName = await prompt(rl, 'Author name', config.authorName);
      config.authorEmail = await prompt(rl, 'Author email (optional)', '');
      config.primaryColor = await prompt(rl, 'Primary colour (any CSS colour)', config.primaryColor);
      config.includeCssOverrides = await promptYesNo(rl, 'Include a custom stylesheet (styles.css)?', true);
    }

    scaffoldBundle(config);
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
