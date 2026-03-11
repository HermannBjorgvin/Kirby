# 😸 Kirby

A terminal UI for managing multiple AI coding sessions across git worktrees, with integrated GitHub and Azure DevOps pull request tracking.

## Features

- **Session management** — create, kill, and delete worktree-based AI coding sessions from a single TUI
- **PR tracking** — view open, draft, and merged pull requests alongside your active sessions
- **Code reviews tab** — see PRs where you're a reviewer, grouped by status (needs review, waiting for author, approved)
- **Branch sync** — automatic merge detection, conflict counting, auto-delete of merged branches, one-key rebase
- **Terminal integration** — full ANSI passthrough and input forwarding via embedded PTY sessions
- **Configurable AI tool** — switch between Claude, Codex, Gemini, Copilot, or a custom command
- **Settings panel** — auto-detect VCS provider, configure sync intervals, and set project preferences

## Example

The worktree session tab shows active PR's and lets you press enter to create a new agent session and worktree based on the branch.
![screenshot of session tab](sessions-example.png)

The reviews tab works similarly showing you pull requests you are assigned to review and lets you start a new session with an automatic review as the initial prompt.
![screenshot of review tab](reviews-example.png)

## Prerequisites

- Node.js 20+
- git
- `gh` CLI (for GitHub provider)

## Installation

### Global install (recommended)

Build a self-contained bundle and install the `kirby` command globally:

```sh
npm install
npx nx install-global cli
```

Then run from any project directory:

```sh
kirby
kirby /path/to/project
```

### Development

```sh
npm install
npx nx serve cli
```

Pass a target directory to manage a different project:

```sh
npx nx serve cli --no-tui -- /path/to/project
```

## Project Structure

```
apps/cli/              Ink TUI application (React 19, ESM)
libs/worktree-manager/ Worktree and branch lifecycle operations
libs/terminal/         PTY session and terminal emulation (node-pty + @xterm/headless)
libs/vcs/core/         VCS abstraction and config management
libs/vcs/azure-devops/ Azure DevOps provider
libs/vcs/github/       GitHub provider (via gh cli)
```

## Keyboard Shortcuts

| Key       | Action                                    |
| --------- | ----------------------------------------- |
| `1` / `2` | Switch to Sessions / Reviews tab          |
| `Tab`     | Toggle focus between sidebar and terminal |
| `j` / `k` | Navigate list items                       |
| `c`       | Create new session (opens branch picker)  |
| `d`       | Delete session (with confirmation)        |
| `K`       | Kill session without deleting branch      |
| `u`       | Rebase selected branch onto master        |
| `g`       | Trigger git sync                          |
| `r`       | Refresh PR data                           |
| `s`       | Open settings panel                       |
| `Enter`   | Start review session (Reviews tab)        |
| `Esc`     | Exit terminal focus / close panel         |
| `q`       | Quit                                      |

## Configuration

Press `s` to open the settings panel. From there you can configure the VCS provider, AI tool, sync intervals, and auto-behaviors (auto-delete merged branches, auto-rebase). Press `a` to auto-detect project settings from the git remote.

## License

MIT
