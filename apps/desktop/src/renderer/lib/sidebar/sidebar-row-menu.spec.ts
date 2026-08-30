import { describe, expect, it } from 'vitest';
import { sidebarRowMenuItems } from './sidebar-row-menu.js';

/** The command ids the menu offers, in order. */
function ids(...args: Parameters<typeof sidebarRowMenuItems>): string[] {
  return sidebarRowMenuItems(...args).flatMap((i) => ('id' in i ? [i.id] : []));
}

describe('sidebarRowMenuItems', () => {
  it('offers launching, stopping and removal only for a checked-out row', () => {
    // A PR nobody has checked out yet: there is no worktree to launch an
    // agent in, stop one in, or remove — only to create.
    expect(ids({ hasWorktree: false, running: false, hasPr: true })).toEqual([
      'open',
      'checkout',
      'open-pr',
      'open-editor',
      'copy',
    ]);
  });

  it('offers launch on an idle worktree and stop on a busy one, never both', () => {
    const idle = ids({ hasWorktree: true, running: false, hasPr: false });
    expect(idle).toContain('launch');
    expect(idle).not.toContain('kill');
    expect(idle).not.toContain('checkout');
    expect(idle).toContain('remove');

    const busy = ids({ hasWorktree: true, running: true, hasPr: false });
    expect(busy).toContain('kill');
    expect(busy).not.toContain('launch');
  });

  it('offers neither on a row with no checkout, however it is flagged', () => {
    // Both actions address a worktree, so neither is offered without
    // one — a stale `running` flag on a PR row must not put a Stop
    // agent entry in front of the user with nothing to stop.
    const none = ids({ hasWorktree: false, running: true, hasPr: true });
    expect(none).not.toContain('kill');
    expect(none).not.toContain('launch');
    expect(none).toContain('checkout');
  });

  it('offers the pull request only when there is one', () => {
    expect(
      ids({ hasWorktree: true, running: false, hasPr: false })
    ).not.toContain('open-pr');
    expect(ids({ hasWorktree: true, running: false, hasPr: true })).toContain(
      'open-pr'
    );
  });

  it('marks removal as destructive and separates it from the rest', () => {
    const items = sidebarRowMenuItems({
      hasWorktree: true,
      running: false,
      hasPr: false,
    });
    const remove = items.at(-1);
    expect(remove).toEqual({
      id: 'remove',
      label: 'Remove worktree…',
      danger: true,
    });
    expect(items.at(-2)).toEqual({ type: 'separator' });
  });
});
