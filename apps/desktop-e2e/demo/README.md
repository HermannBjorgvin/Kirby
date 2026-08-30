# README media

Regenerates the screenshots and GIFs in `docs/media/`.

```sh
npx nx build desktop                              # for the desktop demos
npx nx build cli-wterm-host                       # for the TUI demo
node apps/desktop-e2e/demo/capture.mjs            # everything
node apps/desktop-e2e/demo/capture.mjs plan       # one demo
node apps/desktop-e2e/demo/capture.mjs review,plan

python3 apps/desktop-e2e/demo/theme-slider.py     # docs/media/theme.gif
```

Needs `Xvfb` and `ffmpeg` on `PATH` (`sudo apt install xvfb ffmpeg`), and
Pillow for the slider. Nothing else: no network, no GitHub token, no real
agent.

| demo        | what it records                                                                 |
| ----------- | ------------------------------------------------------------------------------- |
| `hero`      | `hero.png` + `hero-light.png` — stills, both themes                             |
| `worktrees` | the sidebar's CI/review status, then creating a worktree and launching an agent |
| `review`    | walking the agent's draft comments and posting one                              |
| `plan`      | queueing comments, annotating one, sending the plan to an agent                 |
| `tui`       | the terminal UI: sidebar, changed files, diff with threads inline               |

`theme.gif` is built separately by `theme-slider.py`, from the two
`hero` stills — so re-run `hero` before it if the UI has moved.

## How it works

The app is driven exactly as the e2e suite drives it — Playwright's
Electron driver against the _built_ app, so what you see recorded is
what ships. Three things make it a demo rather than a test:

- **`scenario.mjs`** stages a small TypeScript repo called `atlas` with
  worktrees, two pull requests, review threads and agent-drafted review
  comments. The pull requests come from the same fake `gh` the e2e suite
  uses (`src/setup/fake-gh.ts`), so no token and no network are
  involved, and the diffs are real ones computed by git from real
  branches.
- **`demo-agent.mjs`** is the agent. The e2e fake agent is deliberately
  ugly — a banner and echo lines, built to be asserted against — and a
  capture needs the opposite. This one paces its output like an agent at
  work and reads back the plan it was seeded with, while staying
  deterministic and offline. Kirby launches it through the ordinary
  `aiCommand` path.
- **`capture.mjs`** runs a dedicated Xvfb display at 2x device scale,
  records it with `ffmpeg -f x11grab`, and drives the app with a visible
  cursor that glides between targets instead of teleporting.
- **The TUI demo** has no window to record — it is an Ink app on a PTY.
  It goes through the same bridge `cli-e2e` uses: the wterm host
  (`apps/cli-wterm-host`) spawns Kirby on a PTY and streams it to a page
  that is nothing but a full-bleed terminal, and Chromium renders that
  page in app mode, so the recording is the terminal with no browser
  around it.
- **`theme-slider.py`** composites the two hero stills into a wipe with
  Pillow and encodes it with the same palette settings. They are the
  same frame of the same app in two themes, captured back to back, so
  the wipe lines up pixel for pixel and reads as one window changing its
  mind rather than two screenshots being swapped.

Stills are Playwright screenshots at the same 2x scale. GIFs are
downscaled to 960px with a per-frame palette, which is what keeps text
legible at a size a README can carry.

## Notes

- Recordings land in `docs/media/raw/` (gitignored); only the finished
  `.png`/`.gif` are committed.
- A demo that throws leaves `raw/<name>-failed.png` — the frame it died
  on, which is usually enough to see what moved.
- Timestamps in the fixtures are relative to now, so cards read "3h ago"
  rather than drifting to an absurd age as the fixtures get older.
- Park the cursor (`park()`) before the final wait of a take: sonner
  pauses a toast's dismiss timer while the pointer is over it, and the
  toasts stack exactly where the primary buttons are.
- Anything Chromium-based needs `WAYLAND_DISPLAY` dropped from its
  environment _and_ `--ozone-platform=x11`, or it talks to the real
  compositor, ignores the X display Xvfb handed it, and records a black
  screen. Same trap the Electron e2e fixture documents.
- Playwright only attaches to an `--app` window through
  `launchPersistentContext`; `chromium.launch` opens its own about:blank
  and reports no contexts for the app window at all.
- In the TUI, count keystrokes from a known edge, never relatively: the
  first key can land before Ink is listening and be swallowed, which
  shifts every later position by one and lands the take on the wrong
  pull request. Walking to the top, where the selection clamps, and
  counting down from there is stable.
- A terminal only has its _visible_ rows in the DOM, so a `getByText`
  wait must name something the current viewport shows — not code that
  is scrolled out of view.
- `Shift+Down` (next comment) moves the selection reliably once and is a
  coin toss the second time, which is why the take queues one comment
  rather than two. `a` toggles, so a jump that silently fails un-queues
  what the previous one added.
