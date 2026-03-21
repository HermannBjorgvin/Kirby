import type { Key } from 'ink';
import { getDisplayFiles } from '../../utils/file-classifier.js';
import type { DiffFileListHandlerCtx } from './input-types.js';

export function handleDiffFileListInput(
  input: string,
  key: Key,
  ctx: DiffFileListHandlerCtx
): void {
  if (key.escape) {
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  if (input === 's') {
    ctx.pane.setShowSkipped((v) => !v);
    ctx.pane.setDiffFileIndex(0);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.pane.setDiffFileIndex((i) => Math.min(i + 1, ctx.diffDisplayCount - 1));
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.pane.setDiffFileIndex((i) => Math.max(i - 1, 0));
    return;
  }

  if (key.return && ctx.diffDisplayCount > 0) {
    const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.pane.showSkipped);
    const file = displayFiles[ctx.pane.diffFileIndex];
    if (file) {
      ctx.pane.setDiffViewFile(file.filename);
      ctx.pane.setDiffScrollOffset(0);
      ctx.pane.setPaneMode('diff-file');
      ctx.loadDiffText();
    }
    return;
  }
}
