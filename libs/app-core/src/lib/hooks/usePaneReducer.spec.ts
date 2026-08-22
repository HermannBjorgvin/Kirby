import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { paneReducer, initialState } from './usePaneReducer.js';

const samplePr: PullRequestInfo = {
  id: 42,
  title: 'Sample PR',
  sourceBranch: 'feat/x',
  targetBranch: 'main',
  url: 'https://example.com/pr/42',
  createdByIdentifier: 'alice',
  createdByDisplayName: 'Alice',
};

describe('paneReducer', () => {
  // ── Plain setter actions ─────────────────────────────────────────

  it('SET_PANE_MODE replaces paneMode and preserves other fields', () => {
    const next = paneReducer(initialState, {
      type: 'SET_PANE_MODE',
      mode: 'diff',
    });
    expect(next.paneMode).toBe('diff');
    expect(next.reconnectKey).toBe(initialState.reconnectKey);
    expect(next.diffFileIndex).toBe(initialState.diffFileIndex);
  });

  it('SET_DIFF_VIEW_FILE replaces diffViewFile and preserves other fields', () => {
    const next = paneReducer(initialState, {
      type: 'SET_DIFF_VIEW_FILE',
      file: 'src/foo.ts',
    });
    expect(next.diffViewFile).toBe('src/foo.ts');
    expect(next.diffFileIndex).toBe(initialState.diffFileIndex);

    const cleared = paneReducer(next, {
      type: 'SET_DIFF_VIEW_FILE',
      file: null,
    });
    expect(cleared.diffViewFile).toBeNull();
  });

  it('SET_SELECTED_COMMENT_ID replaces selectedCommentId', () => {
    const next = paneReducer(initialState, {
      type: 'SET_SELECTED_COMMENT_ID',
      id: 'c1',
    });
    expect(next.selectedCommentId).toBe('c1');

    const cleared = paneReducer(next, {
      type: 'SET_SELECTED_COMMENT_ID',
      id: null,
    });
    expect(cleared.selectedCommentId).toBeNull();
  });

  it('SET_PENDING_DELETE_COMMENT_ID replaces pendingDeleteCommentId', () => {
    const next = paneReducer(initialState, {
      type: 'SET_PENDING_DELETE_COMMENT_ID',
      id: 'c2',
    });
    expect(next.pendingDeleteCommentId).toBe('c2');
  });

  it('SET_EDITING_COMMENT_ID replaces editingCommentId', () => {
    const next = paneReducer(initialState, {
      type: 'SET_EDITING_COMMENT_ID',
      id: 'c3',
    });
    expect(next.editingCommentId).toBe('c3');
  });

  it('SET_REVIEW_CONFIRM replaces reviewConfirm', () => {
    const value = { pr: samplePr, selectedOption: 1 };
    const next = paneReducer(initialState, {
      type: 'SET_REVIEW_CONFIRM',
      value,
    });
    expect(next.reviewConfirm).toEqual(value);

    const cleared = paneReducer(next, {
      type: 'SET_REVIEW_CONFIRM',
      value: null,
    });
    expect(cleared.reviewConfirm).toBeNull();
  });

  // ── Updater<T>: value form ───────────────────────────────────────

  it('SET_RECONNECT_KEY accepts a value updater', () => {
    const next = paneReducer(initialState, {
      type: 'SET_RECONNECT_KEY',
      updater: 7,
    });
    expect(next.reconnectKey).toBe(7);
  });

  it('SET_DIFF_FILE_INDEX accepts a value updater', () => {
    const next = paneReducer(initialState, {
      type: 'SET_DIFF_FILE_INDEX',
      updater: 3,
    });
    expect(next.diffFileIndex).toBe(3);
  });

  it('SET_DIFF_SCROLL_OFFSET accepts a value updater', () => {
    const next = paneReducer(initialState, {
      type: 'SET_DIFF_SCROLL_OFFSET',
      updater: 10,
    });
    expect(next.diffScrollOffset).toBe(10);
  });

  it('SET_SHOW_SKIPPED accepts a value updater', () => {
    const next = paneReducer(initialState, {
      type: 'SET_SHOW_SKIPPED',
      updater: true,
    });
    expect(next.showSkipped).toBe(true);
  });

  it('SET_EDIT_BUFFER accepts a value updater', () => {
    const next = paneReducer(initialState, {
      type: 'SET_EDIT_BUFFER',
      updater: 'hello',
    });
    expect(next.editBuffer).toBe('hello');
  });

  it('SET_REVIEW_INSTRUCTION accepts a value updater', () => {
    const next = paneReducer(initialState, {
      type: 'SET_REVIEW_INSTRUCTION',
      updater: 'LGTM',
    });
    expect(next.reviewInstruction).toBe('LGTM');
  });

  // ── Updater<T>: function form ────────────────────────────────────

  it('SET_RECONNECT_KEY accepts a function updater with prev', () => {
    const start = { ...initialState, reconnectKey: 5 };
    const next = paneReducer(start, {
      type: 'SET_RECONNECT_KEY',
      updater: (prev) => prev + 1,
    });
    expect(next.reconnectKey).toBe(6);
  });

  it('SET_DIFF_FILE_INDEX accepts a function updater with prev', () => {
    const start = { ...initialState, diffFileIndex: 2 };
    const next = paneReducer(start, {
      type: 'SET_DIFF_FILE_INDEX',
      updater: (prev) => prev + 3,
    });
    expect(next.diffFileIndex).toBe(5);
  });

  it('SET_DIFF_SCROLL_OFFSET accepts a function updater', () => {
    const start = { ...initialState, diffScrollOffset: 10 };
    const next = paneReducer(start, {
      type: 'SET_DIFF_SCROLL_OFFSET',
      updater: (prev) => Math.max(0, prev - 5),
    });
    expect(next.diffScrollOffset).toBe(5);
  });

  it('SET_SHOW_SKIPPED accepts a function updater that toggles', () => {
    const next = paneReducer(initialState, {
      type: 'SET_SHOW_SKIPPED',
      updater: (prev) => !prev,
    });
    expect(next.showSkipped).toBe(true);

    const toggled = paneReducer(next, {
      type: 'SET_SHOW_SKIPPED',
      updater: (prev) => !prev,
    });
    expect(toggled.showSkipped).toBe(false);
  });

  it('SET_EDIT_BUFFER accepts a function updater that appends', () => {
    const start = { ...initialState, editBuffer: 'hel' };
    const next = paneReducer(start, {
      type: 'SET_EDIT_BUFFER',
      updater: (prev) => prev + 'lo',
    });
    expect(next.editBuffer).toBe('hello');
  });

  it('SET_REVIEW_INSTRUCTION accepts a function updater', () => {
    const start = { ...initialState, reviewInstruction: 'Looks' };
    const next = paneReducer(start, {
      type: 'SET_REVIEW_INSTRUCTION',
      updater: (prev) => `${prev} good`,
    });
    expect(next.reviewInstruction).toBe('Looks good');
  });

  // ── Identity on unrelated fields ─────────────────────────────────

  it('preserves unrelated fields across a sequence of dispatches', () => {
    let s = initialState;
    s = paneReducer(s, { type: 'SET_PANE_MODE', mode: 'pr-detail' });
    s = paneReducer(s, { type: 'SET_EDIT_BUFFER', updater: 'draft' });
    s = paneReducer(s, { type: 'SET_DIFF_FILE_INDEX', updater: 2 });
    s = paneReducer(s, { type: 'SET_SELECTED_COMMENT_ID', id: 'x' });

    expect(s.paneMode).toBe('pr-detail');
    expect(s.editBuffer).toBe('draft');
    expect(s.diffFileIndex).toBe(2);
    expect(s.selectedCommentId).toBe('x');
    // Fields not touched stay at initial values:
    expect(s.reconnectKey).toBe(initialState.reconnectKey);
    expect(s.reviewConfirm).toBeNull();
    expect(s.showSkipped).toBe(false);
  });
});
