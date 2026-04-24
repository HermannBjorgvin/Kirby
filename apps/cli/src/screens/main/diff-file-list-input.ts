import type { Key } from 'ink';
import { getDisplayFiles } from '@kirby/diff';
import type { DiffFileListHandlerCtx } from './input-types.js';

export function handleDiffFileListInput(
  input: string,
  key: Key,
  ctx: DiffFileListHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'diff-file-list');

  if (action === 'diff-file-list.back') {
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  if (action === 'diff-file-list.toggle-skipped') {
    ctx.pane.setShowSkipped((v) => !v);
    ctx.pane.setDiffFileIndex(0);
    return;
  }

  if (action === 'diff-file-list.navigate-down') {
    ctx.pane.setDiffFileIndex((i) => Math.min(i + 1, ctx.diffDisplayCount - 1));
    return;
  }
  if (action === 'diff-file-list.navigate-up') {
    ctx.pane.setDiffFileIndex((i) => Math.max(i - 1, 0));
    return;
  }

  if (action === 'diff-file-list.open' && ctx.diffDisplayCount > 0) {
    // Index past the file rows selects a footer PR-comment card.
    // Enter there opens the Shift+C pane focused on that thread.
    if (ctx.pane.diffFileIndex >= ctx.fileCount) {
      const commentIdx = ctx.pane.diffFileIndex - ctx.fileCount;
      const thread = ctx.shownGeneralComments[commentIdx];
      if (thread) {
        ctx.pane.setGeneralCommentsIndex(commentIdx);
        ctx.pane.setGeneralCommentsScrollOffset(0);
        ctx.pane.setPaneMode('comments');
      }
      return;
    }
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
