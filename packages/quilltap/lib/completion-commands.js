'use strict';

const fs = require('fs');
const path = require('path');

function printCompletionHelp() {
  console.log(`
Quilltap Shell Completion

Usage: quilltap completion <shell> [--help]

Supported shells:
  bash          Bash completion script
  zsh           Zsh completion script
  fish          Fish completion script

This command generates a shell completion script for the given shell.
To install:

  Bash:
    quilltap completion bash >> ~/.bashrc

  Zsh:
    mkdir -p ~/.zsh/completions
    quilltap completion zsh > ~/.zsh/completions/_quilltap
    # Then add to ~/.zshrc: fpath=(~/.zsh/completions $fpath)

  Fish:
    quilltap completion fish > ~/.config/fish/completions/quilltap.fish

Examples:
  quilltap completion bash | bash -c 'source /dev/stdin'  # Test in current shell
  quilltap completion zsh                                 # Print to stdout
  quilltap completion fish > ~/completions.fish           # Save to file
`);
}

async function completionCommand(args) {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    printCompletionHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const shell = args[0];

  switch (shell) {
    case 'bash':
    case 'zsh':
    case 'fish':
      break;
    case '--help':
    case '-h':
      printCompletionHelp();
      process.exit(0);
      break;
    default:
      console.error(`Error: Unknown shell '${shell}'. Supported shells: bash, zsh, fish`);
      process.exit(1);
  }

  // Load the appropriate template file
  const templatePath = path.join(__dirname, 'completion', `${shell}.template`);
  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf-8');
  } catch (err) {
    console.error(`Error: Could not load completion template for ${shell}: ${err.message}`);
    process.exit(1);
  }

  // Print the template to stdout
  process.stdout.write(template);
}

module.exports = {
  completionCommand,
};
