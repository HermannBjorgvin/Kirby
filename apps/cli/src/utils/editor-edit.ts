import { writeFileSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tracks an open editor session per commentId. Re-pressing the
// editor-edit key on the same comment used to leave the previous
// `fs.watch` running, so a single save would fire `onUpdate` once
// per stacked watcher. The Map closes the prior watcher on re-entry.
const editorWatchers = new Map<
  string,
  { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> }
>();

const WATCH_TIMEOUT_MS = 30 * 60 * 1000;

export interface OpenCommentInEditorOpts {
  commentId: string;
  initialBody: string;
  editor: string;
  onUpdate: (newBody: string) => void;
}

/**
 * Write `initialBody` to a temp file, spawn `editor` against it, and
 * watch the file for changes. On save, calls `onUpdate(newBody)` if
 * the file content differs from `initialBody`. The watcher auto-closes
 * after 30 minutes.
 *
 * Re-entry guard: if a watcher already exists for `commentId`, it's
 * closed (and its timer cleared) before the new one is registered.
 * Returns the temp file path.
 */
export function openCommentInEditor(opts: OpenCommentInEditorOpts): string {
  const { commentId, initialBody, editor, onUpdate } = opts;
  const tmpFile = join(tmpdir(), `kirby-comment-${commentId}.md`);
  writeFileSync(tmpFile, initialBody, 'utf8');

  spawn(editor, [tmpFile], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  closeWatcherFor(commentId);

  const watcher = watch(tmpFile, () => {
    try {
      const newBody = readFileSync(tmpFile, 'utf8');
      if (newBody !== initialBody) onUpdate(newBody);
    } catch {
      // File may be temporarily unavailable during save
    }
  });

  const timer = setTimeout(() => {
    watcher.close();
    editorWatchers.delete(commentId);
  }, WATCH_TIMEOUT_MS);
  timer.unref();

  editorWatchers.set(commentId, { watcher, timer });
  return tmpFile;
}

function closeWatcherFor(commentId: string): void {
  const prev = editorWatchers.get(commentId);
  if (prev) {
    prev.watcher.close();
    clearTimeout(prev.timer);
    editorWatchers.delete(commentId);
  }
}

/** Test helper — close every tracked watcher and clear the registry. */
export function _resetEditorWatchersForTests(): void {
  for (const { watcher, timer } of editorWatchers.values()) {
    watcher.close();
    clearTimeout(timer);
  }
  editorWatchers.clear();
}
