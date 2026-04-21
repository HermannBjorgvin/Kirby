export interface SpawnRequest {
  repoPath: string;
  homeDir: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface ControlMessage {
  type: 'resize';
  cols: number;
  rows: number;
}
