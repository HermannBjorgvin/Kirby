# README media

Regenerates the screenshots and GIFs in `docs/media/`.

```sh
npx nx build desktop
node apps/desktop-e2e/demo/capture.mjs            # everything
node apps/desktop-e2e/demo/capture.mjs plan       # one demo
node apps/desktop-e2e/demo/capture.mjs review,plan
```

Needs `Xvfb` and `ffmpeg` on `PATH` (`sudo apt install xvfb ffmpeg`).
Nothing else: no network, no GitHub token, no real agent.

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
