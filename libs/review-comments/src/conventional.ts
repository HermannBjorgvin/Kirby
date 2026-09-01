/**
 * Conventional Comments — deliberately browser-safe.
 *
 * Everything reachable from here is pure string work: no `node:`
 * builtin, no native module, nothing that touches a process. That is
 * what lets the Electron renderer, a sandboxed browser context with no
 * Node, parse and render comment bodies with the identical code the
 * TUI and the comment poster run.
 *
 * The package's main barrel cannot be used there — `comment-store.ts`
 * reads `~/.kirby` — which is why this subpath exists at all, and why
 * the desktop renderer's `no-restricted-imports` block names it
 * explicitly (see eslint.config.mjs).
 *
 * Keep it that way: anything added here must be pure, and type imports
 * must stay `import type` so they erase at compile time.
 */

export {
  AGENT_ATTRIBUTION,
  AGENT_FOOTER,
  CONVENTIONAL_DECORATIONS,
  CONVENTIONAL_LABELS,
  KIRBY_URL,
  commentBodyParts,
  conventionalForSeverity,
  conventionalSeverity,
  formatConventionalComment,
  moreSevere,
  resolveComment,
  parseConventionalComment,
  splitAgentFooter,
  withAgentFooter,
  type CommentBodyParts,
  type ConventionalComment,
  type ConventionalLabel,
  type ResolvedComment,
} from './lib/conventional.js';

export type { CommentSeverity } from './lib/types.js';
