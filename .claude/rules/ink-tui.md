---
paths:
  - 'apps/cli/**/*.tsx'
  - 'apps/cli/src/hooks/**'
---

Before writing Ink components or input handling, use the `cli-design:inkjs-design`
skill (`cli-design:inkjs-cli layout | input | testing | gotchas`) rather than
guessing Ink APIs. Ink enforces its layout contract at runtime by throwing, so a
wrong component type-checks and dies when that branch first renders.
