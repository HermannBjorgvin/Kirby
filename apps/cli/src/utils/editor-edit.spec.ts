import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks — vi.mock() hoists to file top, so values referenced
// from inside the factory must be created via vi.hoisted().
const mocks = vi.hoisted(() => {
  return {
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    watch: vi.fn(),
    spawn: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  writeFileSync: mocks.writeFileSync,
  readFileSync: mocks.readFileSync,
  watch: mocks.watch,
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

import {
  openCommentInEditor,
  _resetEditorWatchersForTests,
} from './editor-edit.js';

interface FakeWatcher {
  close: ReturnType<typeof vi.fn>;
  /** Triggers the watch callback to simulate a save. */
  fire: () => void;
}

function makeWatcher(): FakeWatcher {
  let cb: (() => void) | null = null;
  const watcher: FakeWatcher = {
    close: vi.fn(),
    fire: () => cb?.(),
  };
  mocks.watch.mockImplementationOnce((_path: string, callback: () => void) => {
    cb = callback;
    return watcher;
  });
  return watcher;
}

describe('openCommentInEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawn.mockReturnValue({ unref: vi.fn() });
  });

  afterEach(() => {
    _resetEditorWatchersForTests();
  });

  it('writes the initial body to a temp file and spawns the editor', () => {
    makeWatcher();
    const tmpFile = openCommentInEditor({
      commentId: 'c1',
      initialBody: 'hello',
      editor: 'nano',
      onUpdate: vi.fn(),
    });

    expect(tmpFile).toContain('kirby-comment-c1.md');
    expect(mocks.writeFileSync).toHaveBeenCalledWith(tmpFile, 'hello', 'utf8');
    expect(mocks.spawn).toHaveBeenCalledWith(
      'nano',
      [tmpFile],
      expect.objectContaining({ detached: true })
    );
  });

  it('fires onUpdate when the file changes', () => {
    const onUpdate = vi.fn();
    const watcher = makeWatcher();
    openCommentInEditor({
      commentId: 'c1',
      initialBody: 'hello',
      editor: 'nano',
      onUpdate,
    });

    mocks.readFileSync.mockReturnValueOnce('hello world');
    watcher.fire();

    expect(onUpdate).toHaveBeenCalledWith('hello world');
  });

  it('does not fire onUpdate when the saved body equals the initial body', () => {
    const onUpdate = vi.fn();
    const watcher = makeWatcher();
    openCommentInEditor({
      commentId: 'c1',
      initialBody: 'hello',
      editor: 'nano',
      onUpdate,
    });

    mocks.readFileSync.mockReturnValueOnce('hello');
    watcher.fire();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('closes the previous watcher when reopened on the same comment', () => {
    const first = makeWatcher();
    openCommentInEditor({
      commentId: 'c1',
      initialBody: 'hello',
      editor: 'nano',
      onUpdate: vi.fn(),
    });

    expect(first.close).not.toHaveBeenCalled();

    const second = makeWatcher();
    openCommentInEditor({
      commentId: 'c1',
      initialBody: 'hello v2',
      editor: 'nano',
      onUpdate: vi.fn(),
    });

    // Re-entry guard: prior watcher is closed before the new one is
    // armed, so a single save can't fire onUpdate twice.
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it('does not close watchers for other commentIds', () => {
    const w1 = makeWatcher();
    openCommentInEditor({
      commentId: 'c1',
      initialBody: 'a',
      editor: 'nano',
      onUpdate: vi.fn(),
    });

    const w2 = makeWatcher();
    openCommentInEditor({
      commentId: 'c2',
      initialBody: 'b',
      editor: 'nano',
      onUpdate: vi.fn(),
    });

    expect(w1.close).not.toHaveBeenCalled();
    expect(w2.close).not.toHaveBeenCalled();
  });

  it('swallows readFileSync errors so a transient race does not crash the watcher', () => {
    const onUpdate = vi.fn();
    const watcher = makeWatcher();
    openCommentInEditor({
      commentId: 'c1',
      initialBody: 'hello',
      editor: 'nano',
      onUpdate,
    });

    mocks.readFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    expect(() => watcher.fire()).not.toThrow();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
