import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type * as ChildProcess from 'node:child_process';
import { useDiffData, __resetTargetFetchTtlForTest } from '@kirby/app-core';

// Same shape as libs/app-core's useDiffData.spec.ts: the hook and
// diff-fetcher both reach for node:child_process, so one mock covers
// the whole git surface the hook touches.
/** What promisified execFile hands back: (err, { stdout, stderr }). */
type ExecFileCallback = (
  err: Error | null,
  result: { stdout: string; stderr: string } | null
) => void;

const execFileMock = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const { EventEmitter } = await import('node:events');
  return {
    // The @kirby/app-core barrel drags in worktree-manager, which
    // promisifies `exec` at import time — keep the rest of the module
    // real and swap only what the hook's git surface uses.
    ...(await importOriginal<typeof ChildProcess>()),
    execFile: (
      cmd: string,
      args: string[],
      opts: unknown,
      cb: ExecFileCallback
    ) => {
      const callback: ExecFileCallback =
        typeof opts === 'function' ? (opts as ExecFileCallback) : cb;
      Promise.resolve(execFileMock(cmd, args)).then(
        (stdout: string) => callback(null, { stdout, stderr: '' }),
        (err: Error) => callback(err, null)
      );
    },
    // diff-fetcher streams through `runGit`, so it spawns rather than
    // buffering. Answered from the same script, in one chunk.
    spawn: (cmd: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => undefined,
      });
      Promise.resolve(execFileMock(cmd, args)).then(
        (stdout: string) => {
          child.stdout.emit('data', Buffer.from(stdout));
          child.emit('close', 0);
        },
        (err: Error) => {
          child.stderr.emit('data', Buffer.from(err.message));
          child.emit('close', 1);
        }
      );
      return child;
    },
  };
});

// `-z`: records are NUL-terminated (see parseNumstat in @kirby/app-core).
const NUMSTAT = '5\t2\tsrc/foo.ts\0' + '10\t0\tsrc/bar.ts\0';
const NAME_STATUS = 'M\0src/foo.ts\0' + 'A\0src/bar.ts\0';
const FOO_DIFF = 'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1 +1 @@\n-a\n+b\n';

function installGitMock(): { calls: string[][] } {
  const calls: string[][] = [];
  execFileMock.mockImplementation(async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
    if (args[0] === 'fetch') return '';
    if (args[0] === 'diff' && args[1] === '--numstat') return NUMSTAT;
    if (args[0] === 'diff' && args[1] === '--name-status') return NAME_STATUS;
    if (args[0] === 'diff' && args[1] === '-U99999') return FOO_DIFF;
    throw new Error(`Unmatched git call in test: ${cmd} ${args.join(' ')}`);
  });
  return { calls };
}

type HookValue = ReturnType<typeof useDiffData>;
interface Commit {
  prNumber: number | null;
  filenames: string[];
  diffs: number;
}

// Mounts the hook under a driveable `prNumber` prop and records both
// the latest returned value and every committed render, so a test can
// assert on what the pane would have shown at each frame — not just
// where it settles.
function mountProbe(initialPr: number | null) {
  const outRef: { current: HookValue | null } = { current: null };
  const commits: Commit[] = [];

  function Probe({ prNumber }: { prNumber: number | null }) {
    const value = useDiffData(prNumber, 'feature', 'main', undefined);
    // Capture after commit — assigning during render is blocked by the
    // react-hooks purity/immutability rules.
    useEffect(() => {
      outRef.current = value;
      commits.push({
        prNumber,
        filenames: value.files.map((f) => f.filename),
        diffs: value.fileDiffs.size,
      });
    });
    return <Box />;
  }

  const { rerender, unmount } = render(<Probe prNumber={initialPr} />);
  return {
    outRef,
    commits,
    unmount,
    setPr: (prNumber: number | null) => {
      rerender(<Probe prNumber={prNumber} />);
    },
  };
}

async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

async function waitForState(
  ref: { current: HookValue | null },
  predicate: (v: HookValue) => boolean,
  attempts = 25
) {
  for (let i = 0; i < attempts; i++) {
    if (ref.current && predicate(ref.current)) return;
    await flush();
  }
}

describe('useDiffData', () => {
  beforeEach(() => {
    __resetTargetFetchTtlForTest();
    execFileMock.mockReset();
  });

  it('loads the PR files when prNumber is set', async () => {
    const { calls } = installGitMock();
    const probe = mountProbe(42);

    await waitForState(probe.outRef, (v) => v.files.length === 2);

    expect(probe.outRef.current?.files.map((f) => f.filename)).toEqual([
      'src/foo.ts',
      'src/bar.ts',
    ]);
    expect(calls.some((c) => c[1] === 'diff' && c[2] === '--name-status')).toBe(
      true
    );
    probe.unmount();
  });

  it('runs no git commands and exposes nothing while prNumber is null', async () => {
    const { calls } = installGitMock();
    const probe = mountProbe(null);

    await flush();

    expect(probe.outRef.current?.files).toEqual([]);
    expect(probe.outRef.current?.fileDiffs.size).toBe(0);
    expect(calls).toEqual([]);
    probe.unmount();
  });

  it('stops exposing the loaded files and diffs once prNumber goes null', async () => {
    installGitMock();
    const probe = mountProbe(42);
    await waitForState(probe.outRef, (v) => v.files.length === 2);

    await probe.outRef.current!.loadFileDiff('src/foo.ts');
    await waitForState(probe.outRef, (v) => v.fileDiffs.size === 1);
    expect(probe.outRef.current?.fileDiffs.get('src/foo.ts')).toBe(FOO_DIFF);

    probe.setPr(null);
    await flush();

    expect(probe.outRef.current?.files).toEqual([]);
    expect(probe.outRef.current?.fileDiffs.size).toBe(0);
    probe.unmount();
  });

  it('never renders the previous PR files during a render where prNumber is null', async () => {
    installGitMock();
    const probe = mountProbe(42);
    await waitForState(probe.outRef, (v) => v.files.length === 2);

    probe.setPr(null);
    await flush();

    // Emptiness is derived from prNumber, so the very first committed
    // render without a PR is already empty. An effect that wrote []
    // into state instead would leave one commit showing the old files.
    const nullCommits = probe.commits.filter((c) => c.prNumber === null);
    expect(nullCommits.length).toBeGreaterThan(0);
    expect(nullCommits.every((c) => c.filenames.length === 0)).toBe(true);
    expect(nullCommits.every((c) => c.diffs === 0)).toBe(true);
    probe.unmount();
  });

  it('reloads for the next PR after prNumber changes', async () => {
    const { calls } = installGitMock();
    const probe = mountProbe(42);
    await waitForState(probe.outRef, (v) => v.files.length === 2);
    const before = calls.filter(
      (c) => c[1] === 'diff' && c[2] === '--name-status'
    ).length;

    probe.setPr(43);
    await flush();

    const after = calls.filter(
      (c) => c[1] === 'diff' && c[2] === '--name-status'
    ).length;
    expect(after).toBe(before + 1);
    expect(probe.outRef.current?.files).toHaveLength(2);
    probe.unmount();
  });
});
