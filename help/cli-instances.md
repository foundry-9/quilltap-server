---
url: /settings?tab=system
---

# The Instance Registry

Each Quilltap installation — each self-contained workspace with its own database, files, and settings — occupies a separate directory on your machine, called an *instance*. The default location depends on your operating system: `~/Library/Application Support/Quilltap/` on macOS, `~/.quilltap/` on Linux, and `%APPDATA%\Quilltap\` on Windows. But Quilltap invites you to maintain several instances in parallel. You might keep a Friday instance for personal projects, an Ignite instance for collaborative work, and perhaps a Staging instance for testing imported data. The `quilltap instances` command is the registry that keeps track of them.

## The Instance Registry

Each registered instance has a friendly name, a filesystem path to its root directory, and an optional database passphrase. When you register an instance, you can thereafter invoke `quilltap --instance Friday` instead of spelling out the full path and passphrase on the command line. The registry lives in a single `instances.json` file in your user configuration directory (the same parent directory that would hold the default instance, had you never registered one).

## Basic Operations

### Listing Your Instances

```text
quilltap instances list
```

Shows all registered instances, one per row, with their paths and passphrase status. If you have set a default instance, it is marked with an asterisk (`*`).

### Adding an Instance

```text
quilltap instances add <name> [<path>]
```

Registers a new instance. Prompts for the path if not supplied on the command line. If the instance directory has an encrypted database, prompts for the passphrase and verifies it against the `.dbkey` file before saving.

### Viewing One Instance

```text
quilltap instances show <name>
```

Prints the name, path, passphrase status, and presence of data files (`.dbkey`, `quilltap.db`) for one instance.

### Removing an Instance

```text
quilltap instances remove <name>
quilltap instances rm <name>
quilltap instances delete <name>
```

Forgets an instance from the registry. Does not touch the instance's files on disk. If the removed instance was set as the default, the default is cleared.

## Managing Passphrases

### Setting or Changing a Passphrase

```text
quilltap instances set-passphrase <name>
```

Prompts for a new database passphrase, verifies it against the `.dbkey` file (if present), and saves it to the registry. You can also clear an existing passphrase with the same command.

## Default Instance

When you invoke `quilltap` (the server, or most CLI subcommands) without the `--instance` or `--data-dir` flag, the CLI resolves your target instance in this order:

1. **Registered default** (if one is set) — see below
2. **`QUILLTAP_DATA_DIR` environment variable** (if set)
3. **OS platform default** (the system-standard location for your OS)

If you frequently work in the same instance, you can mark it as the default and thereafter omit the flag entirely.

### Setting a Default Instance

```text
quilltap instances default <name>
```

Marks `<name>` as the default. Subsequent `quilltap` invocations will use that instance's path unless overridden with `--instance` or `--data-dir`.

### Viewing the Current Default

```text
quilltap instances default
```

Prints the name of the default instance (or `(none)` if no default is set).

### Clearing the Default

```text
quilltap instances default --clear
```

Unsets the default instance. Thereafter, `quilltap` will fall back to the environment variable (if set) or the OS platform default.

## Renaming an Instance

```text
quilltap instances rename <old> <new>
```

Renames an instance in the registry. The stored path and passphrase are preserved; only the friendly name changes. If the renamed instance was set as the default, the default is updated to the new name.

## Hidden Flags

`--json` on `list` or `default` emits JSON output instead of a human-readable table. Used by shell completion and automation.

`--names-only` on `list` prints one instance name per line, useful for programmatic queries.

## In-Chat Navigation

The Instance Registry is part of the Quilltap CLI and lives outside the chat interface. If you need to manage instances, open a terminal and run `quilltap instances --help` for a quick reference, or run any command without `--help` to see it interactively.

## help_navigate

```
help_navigate(url: "/settings?tab=system")
```
