export type {
  DiffLine,
  FileDiff,
  DiffFile,
  FileCategory,
} from './lib/types.js';
export { parseUnifiedDiff } from './lib/diff-parser.js';
export { renderDiffLines } from './lib/diff-renderer.js';
export {
  classifyFile,
  partitionFiles,
  getDisplayFiles,
} from './lib/file-classifier.js';
