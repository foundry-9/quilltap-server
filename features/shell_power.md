# Feature Request: Shell Interactivity

If an LLM can run tools (or pseudo-tools), and it's running in a Docker image or VM, then it can run shell commands.

## Features

- Sandboxed (it can't completely hose the VM unless you give it the power to do so)
- Capable of sudo commands (again, each one needs to be gated by the user)
  - Can install and update `apk` packages (assuming we're still on Alpine)
- Only runs in the chat directory (if it's in a bare chat in general space) or in the project directory (if it's in a project) - if that directory does not exist then it must be created, if possible, before any of the tools below run
- Is capable of making directories and files
- Is capable of reading files from the "Files" mount-point and functionality of this project or chat and then writing them into its space on the VM
- Is capable of writing files from its space on the VM into the "Files" mount-point and functionality of this project
- Can run any utility that exists on the VM for users, or that it creates using compilers or scripting languages, on the VM
- Can specifically use git to check out repositories and run git commands on them
- Can run ssh to connect to other systems, for example to forward ports, to use for Git access, etc.
  - Should almost certainly be blocked from ssh-ing into the host system

## Interfaces

- command_result: `{exit_code: number; stdout: string; stderr: string; time_elapsed: number}` where `time_elapsed` is measured in milliseconds

## Tools (only available in Docker/VM and only if allowed by tool gating that already exists)

- `chdir(path?)` - changes directory for context of this chat; path is optional, will default to chat default directory if null/undefined/blank, otherwise changes to directory if it exists and returns `command_result`
- `exec_sync(command, ...[parameters])` - runs a command and waits for it to complete
  - returns `command_result`
- `exec_async(command, ...[parameters])` - runs a command in the background and does not wait for it to complete before returning
  - returns PID of running process
- `async_result(pid)` - fetches the result of the asynchronous execution
  - returns `{status: "running"|"complete", ...command_result`
- `sudo_sync(command, ...[parameters])` - runs a command as superuser
  - **must be verified by user before running in the front-end**
  - returns `command_result`
