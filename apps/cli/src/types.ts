export type ActiveTab = 'sessions' | 'reviews';

export type Focus = 'sidebar' | 'terminal';

export type ReviewPane = 'detail' | 'diff' | 'diff-file' | 'confirm' | 'terminal';

export interface AgentSession {
  name: string;
  running: boolean;
}

export interface DiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  binary: boolean;
  previousFilename?: string;
}

export type FileCategory = 'normal' | 'binary' | 'lockfile' | 'generated';
