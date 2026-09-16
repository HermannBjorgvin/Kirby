export { prepareTmuxSession } from './lib/tmux-launch.js';
export {
  createTmuxBackend,
  setTmuxSessionPreparer,
  type TmuxSessionPreparer,
  type TmuxLaunchPlan,
} from './lib/tmux-backend.js';
export { sanitizeTmuxSessionName } from './lib/sanitize-tmux-session-name.js';
export {
  isDuplicateSession,
  sessionNameCandidates,
  tmuxAttachArgs,
  tmuxFreeSessionName,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessions,
  tmuxListSessionsDetailed,
  tmuxNewSessionDetached,
  tmuxPaneState,
  tmuxSetOption,
  tmuxShowOption,
  type TmuxNewSessionOptions,
  type TmuxRunResult,
  type TmuxSessionInfo,
} from './lib/tmux-cli.js';
export { isTmuxAvailable, type TmuxStatus } from './lib/is-tmux-available.js';

export {
  tmuxSessionSnapshot,
  sameTmuxIncarnation,
  type TmuxSessionIncarnation,
  type TmuxSessionSnapshot,
} from './lib/tmux-snapshot.js';
