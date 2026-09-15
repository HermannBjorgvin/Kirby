export {
  createTmuxBackendFactory,
  type TmuxFactoryOptions,
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
  tmuxSetOption,
  tmuxShowOption,
  type TmuxNewSessionOptions,
  type TmuxRunResult,
  type TmuxSessionInfo,
} from './lib/tmux-cli.js';
export { isTmuxAvailable, type TmuxStatus } from './lib/is-tmux-available.js';
