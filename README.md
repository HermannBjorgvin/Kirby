# 😸 Kirby

A terminal UI for managing multiple AI coding sessions across git worktrees, with integrated GitHub and Azure DevOps pull request tracking.

<!-- screenshot -->

## Features

- **Session management** — create, kill, and delete worktree-based AI coding sessions from a single TUI
- **PR tracking** — view open, draft, and merged pull requests alongside your active sessions
- **Code reviews tab** — see PRs where you're a reviewer, grouped by status (needs review, waiting for author, approved)
- **Branch sync** — automatic merge detection, conflict counting, auto-delete of merged branches, one-key rebase
- **Terminal integration** — full ANSI passthrough and input forwarding to tmux sessions
- **Configurable AI tool** — switch between Claude, Codex, Gemini, Copilot, or a custom command
- **Settings panel** — auto-detect VCS provider, configure sync intervals, and set project preferences

## Prerequisites

- Node.js 20+
- tmux
- git
- `gh` CLI (for GitHub provider)

## Quick Start

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
libs/tmux-manager/     Worktree session lifecycle and persistence
libs/tmux-control/     tmux command execution primitives
libs/vcs/core/         VCS abstraction and config management
libs/vcs/azure-devops/ Azure DevOps provider
libs/vcs/github/       GitHub provider (GraphQL)
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
