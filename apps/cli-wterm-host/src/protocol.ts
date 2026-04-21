export interface SpawnRequest {
  sessionId: string;
  repoPath: string;
  homeDir: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export type ControlMessage =
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };
