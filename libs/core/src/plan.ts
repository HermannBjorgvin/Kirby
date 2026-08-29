/**
 * The plan ("add to cart") entry point — deliberately browser-safe.
 *
 * Everything reachable from here is pure: value snapshots of comments,
 * the module-local store that holds them, and the prompt composer. No
 * `node:` builtin, no native module, nothing that touches a process —
 * so the Electron renderer, which is a sandboxed browser context with
 * no Node, can import it for its *values* and run the identical store
 * and prompt composition the TUI runs.
 *
 * That is the whole point of the subpath. `@kirby/core`'s main barrel
 * reaches git, PTYs and the filesystem, so the renderer is blocked from
 * importing it (see the desktop renderer's no-restricted-imports block
 * in eslint.config.mjs). Without this entry the desktop would have to
 * reimplement the cart — and the two shells would drift the way
 * worktree deletion already has.
 *
 * Keep it that way: anything added here must be pure, and the type
 * imports below must stay `import type` so they erase at compile time.
 */

export {
  planItemKey,
  snapshotLocal,
  snapshotRemote,
  type LocalPlanItem,
  type PlanItem,
  type PlanItemBase,
  type RemotePlanItem,
} from './lib/plan/plan-types.js';

export {
  add,
  annotate,
  clear,
  count,
  getSnapshot,
  has,
  list,
  remove,
  subscribe,
  toggle,
  __resetPlanStoreForTest,
} from './lib/plan/plan-store.js';

export { composePlanPrompt } from './lib/plan/prompt-composer.js';
