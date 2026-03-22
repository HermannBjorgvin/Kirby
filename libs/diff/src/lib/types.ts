export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface FileDiff {
  filename: string;
  lines: DiffLine[];
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
