---
url: /settings
---

# Shell Completion for Quilltap

Like a notary stamp on the margin of a ledger, shell completion puts the thing you need at your fingertip — one keystroke, not a gauntlet of flags.

The `quilltap completion` command generates a completion script for your shell. Sourcing it (or placing it in your shell's completion directory) will let you tab through subcommands and mount points without spelling them out.

## Installation

### Bash

Add this to `~/.bashrc`:

```bash
quilltap completion bash >> ~/.bashrc
```

Or place the script in your completion directory:

```bash
quilltap completion bash > /usr/local/etc/bash_completion.d/quilltap
```

(Or `/etc/bash_completion.d/` on Linux, if you have admin rights.)

Then restart your shell.

### Zsh

Create a completion directory if you don't have one:

```bash
mkdir -p ~/.zsh/completions
```

Generate and install the completion script:

```bash
quilltap completion zsh > ~/.zsh/completions/_quilltap
```

Add this to `~/.zshrc`:

```bash
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
```

Then restart your shell.

### Fish

Generate and install the completion script:

```bash
quilltap completion fish > ~/.config/fish/completions/quilltap.fish
```

Then restart your shell.

## What Gets Completed

- **Subcommands**: `quilltap d<TAB>` will suggest `db`, `docs`, and so on.
- **Sub-verbs per namespace**: `quilltap db s<TAB>` will suggest `schema`, `show`.
- **Instance names**: `quilltap --instance Fr<TAB>` will suggest registered instances from `instances.json`.
- **Mount names**: `quilltap docs ls --mount Qu<TAB>` will suggest mount points in the active instance's database.

Dynamic completions (instance names, mount names, etc.) shell out to quilltap's own subcommands. If your instance is encrypted and quilltap can't open it without a passphrase, the completion will silently return no suggestions — this is by design, to avoid prompting in the middle of a tab press.

## In-Chat Navigation

```help_navigate
help_navigate(url: "/settings")
```
