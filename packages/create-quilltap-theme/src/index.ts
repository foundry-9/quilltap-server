import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

interface ThemeConfig {
  themeName: string;
  packageName: string;
  themeId: string;
  displayName: string;
  description: string;
  authorName: string;
  authorEmail: string;
  primaryColor: string;
  includeCssOverrides: boolean;
  includeStorybook: boolean;
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

// Read template file and replace placeholders
function processTemplate(templatePath: string, config: ThemeConfig): string {
  const content = fs.readFileSync(templatePath, 'utf-8');
  return content
    .replace(/\{\{PACKAGE_NAME\}\}/g, config.packageName)
    .replace(/\{\{THEME_ID\}\}/g, config.themeId)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName)
    .replace(/\{\{DESCRIPTION\}\}/g, config.description)
    .replace(/\{\{AUTHOR_NAME\}\}/g, config.authorName)
    .replace(/\{\{AUTHOR_EMAIL\}\}/g, config.authorEmail)
    .replace(/\{\{PRIMARY_COLOR\}\}/g, config.primaryColor);
}

// Copy and process a template file
function copyTemplate(
  templateName: string,
  destPath: string,
  config: ThemeConfig,
  destName?: string
): void {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  const finalDestPath = path.join(destPath, destName || templateName);

  if (!fs.existsSync(templatePath)) {
    error(`Template not found: ${templateName}`);
    return;
  }

  const content = processTemplate(templatePath, config);
  fs.writeFileSync(finalDestPath, content, 'utf-8');
}

// Main scaffolding function
async function scaffold(config: ThemeConfig): Promise<void> {
  const destPath = path.resolve(process.cwd(), config.themeName);

  // Check if directory already exists
  if (fs.existsSync(destPath)) {
    error(`Directory "${config.themeName}" already exists.`);
    process.exit(1);
  }

  heading('Creating your Quilltap theme plugin...');

  // Create directory structure
  fs.mkdirSync(destPath, { recursive: true });
  success(`Created ${config.themeName}/`);

  // Copy core files
  copyTemplate('package.json.template', destPath, config, 'package.json');
  success('Created package.json');

  copyTemplate('manifest.json.template', destPath, config, 'manifest.json');
  success('Created manifest.json');

  copyTemplate('tokens.json.template', destPath, config, 'tokens.json');
  success('Created tokens.json');

  copyTemplate('index.ts.template', destPath, config, 'index.ts');
  success('Created index.ts');

  copyTemplate('tsconfig.json.template', destPath, config, 'tsconfig.json');
  success('Created tsconfig.json');

  copyTemplate('esbuild.config.mjs.template', destPath, config, 'esbuild.config.mjs');
  success('Created esbuild.config.mjs');

  copyTemplate('README.md.template', destPath, config, 'README.md');
  success('Created README.md');

  copyTemplate('.gitignore.template', destPath, config, '.gitignore');
  success('Created .gitignore');

  // Create docs directory with development guide
  const docsDir = path.join(destPath, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  copyTemplate('docs/THEME_PLUGIN_DEVELOPMENT.md.template', destPath, config, 'docs/THEME_PLUGIN_DEVELOPMENT.md');
  success('Created docs/THEME_PLUGIN_DEVELOPMENT.md');

  // Optional: CSS overrides
  if (config.includeCssOverrides) {
    copyTemplate('styles.css.template', destPath, config, 'styles.css');
    success('Created styles.css');
  }

  // Optional: Storybook setup
  if (config.includeStorybook) {
    const storybookDir = path.join(destPath, '.storybook');
    const storiesDir = path.join(destPath, 'stories');

    fs.mkdirSync(storybookDir, { recursive: true });
    fs.mkdirSync(storiesDir, { recursive: true });

    copyTemplate('storybook/main.ts.template', destPath, config, '.storybook/main.ts');
    copyTemplate('storybook/preview.ts.template', destPath, config, '.storybook/preview.ts');
    copyTemplate('storybook/ThemeProvider.tsx.template', destPath, config, '.storybook/ThemeProvider.tsx');
    copyTemplate('stories/Components.stories.tsx.template', destPath, config, 'stories/Components.stories.tsx');

    success('Created .storybook/main.ts');
    success('Created .storybook/preview.ts');
    success('Created .storybook/ThemeProvider.tsx');
    success('Created stories/Components.stories.tsx');
  }

  // Print next steps
  heading('Done! Next steps:');

  log(`  ${colors.cyan}cd ${config.themeName}${colors.reset}`);
  log(`  ${colors.cyan}npm install${colors.reset}`);
  log(`  ${colors.cyan}npm run build${colors.reset}`);

  if (config.includeStorybook) {
    log('');
    log(`  ${colors.dim}# To preview your theme in Storybook:${colors.reset}`);
    log(`  ${colors.cyan}npm run storybook${colors.reset}`);
  }

  log('');
  log(`  ${colors.dim}# Edit tokens.json to customize your theme colors${colors.reset}`);
  if (config.includeCssOverrides) {
    log(`  ${colors.dim}# Edit styles.css for advanced component styling${colors.reset}`);
  }

  log('');
  log(`  ${colors.dim}# When ready to publish:${colors.reset}`);
  log(`  ${colors.cyan}npm publish --access public${colors.reset}`);

  log('');
  info(`Local documentation: docs/THEME_PLUGIN_DEVELOPMENT.md`);
  info(`Online documentation: https://github.com/foundry-9/quilltap/blob/main/docs/THEME_PLUGIN_DEVELOPMENT.md`);
  log('');
}

// Parse command line arguments
function parseArgs(): { themeName?: string; help: boolean; yes: boolean } {
  const args = process.argv.slice(2);
  let themeName: string | undefined;
  let help = false;
  let yes = false;

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-y' || arg === '--yes') {
      yes = true;
    } else if (!arg.startsWith('-')) {
      themeName = arg;
    }
  }

  return { themeName, help, yes };
}

// Show help
function showHelp(): void {
  log(`
${colors.bold}create-quilltap-theme${colors.reset} - Scaffold a new Quilltap theme plugin

${colors.bold}Usage:${colors.reset}
  npm init quilltap-theme [theme-name] [options]
  npx create-quilltap-theme [theme-name] [options]

${colors.bold}Arguments:${colors.reset}
  theme-name    Name for your theme (e.g., "sunset", "ocean-breeze")

${colors.bold}Options:${colors.reset}
  -y, --yes     Skip prompts and use defaults
  -h, --help    Show this help message

${colors.bold}Examples:${colors.reset}
  npm init quilltap-theme my-theme
  npx create-quilltap-theme sunset --yes
  npm init quilltap-theme

${colors.bold}What gets created:${colors.reset}
  qtap-plugin-theme-<name>/
  ├── package.json          # npm package config
  ├── manifest.json         # Quilltap plugin manifest
  ├── tokens.json           # Theme design tokens
  ├── index.ts              # Plugin entry point
  ├── styles.css            # CSS overrides (optional)
  ├── tsconfig.json         # TypeScript config
  ├── esbuild.config.mjs    # Build config
  ├── README.md             # Documentation
  ├── docs/                 # Development guide
  │   └── THEME_PLUGIN_DEVELOPMENT.md
  └── .storybook/           # Storybook setup (optional)
`);
}

// Main entry point
async function main(): Promise<void> {
  const { themeName: argThemeName, help, yes } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  log('');
  log(`${colors.bold}${colors.blue}  create-quilltap-theme${colors.reset}`);
  log(`${colors.dim}  Scaffold a new Quilltap theme plugin${colors.reset}`);
  log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Get theme name
    let themeName = argThemeName;
    if (!themeName && !yes) {
      themeName = await prompt(rl, 'Theme name (e.g., sunset, ocean-breeze)', 'my-theme');
    }
    themeName = themeName || 'my-theme';

    // Normalize the theme name
    const themeId = toKebabCase(themeName);
    const packageName = `qtap-plugin-theme-${themeId}`;
    const displayName = toTitleCase(themeId);

    // Get other details
    let description: string;
    let authorName: string;
    let authorEmail: string;
    let primaryColor: string;
    let includeCssOverrides: boolean;
    let includeStorybook: boolean;

    if (yes) {
      // Use defaults
      description = `A custom theme for Quilltap`;
      authorName = 'Your Name';
      authorEmail = 'you@example.com';
      primaryColor = 'hsl(220 90% 50%)';
      includeCssOverrides = true;
      includeStorybook = false;
    } else {
      description = await prompt(rl, 'Description', `A custom theme for Quilltap`);
      authorName = await prompt(rl, 'Author name', 'Your Name');
      authorEmail = await prompt(rl, 'Author email', 'you@example.com');
      primaryColor = await prompt(rl, 'Primary color (HSL)', 'hsl(220 90% 50%)');
      includeCssOverrides = await promptYesNo(rl, 'Include CSS overrides (styles.css)?', true);
      includeStorybook = await promptYesNo(rl, 'Include Storybook setup?', false);
    }

    const config: ThemeConfig = {
      themeName: packageName,
      packageName,
      themeId,
      displayName,
      description,
      authorName,
      authorEmail,
      primaryColor,
      includeCssOverrides,
      includeStorybook,
    };

    await scaffold(config);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
