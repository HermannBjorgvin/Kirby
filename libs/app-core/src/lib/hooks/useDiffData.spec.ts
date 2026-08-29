/* eslint-disable @typescript-eslint/no-explicit-any -- mock plumbing */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the underlying child_process.execFile call. Both `useDiffData`
// (for git fetch / diff) and `diff-fetcher` (for `resolveRef` /
// `fetchFileDiffText`) reach for the same module, so a single mock
// covers the whole graph.
//
// The real module is spread back in because importing @kirby/core
// loads its whole barrel, and worktree-manager promisifies `exec` at
// module scope — a mock that supplies only `execFile` makes the import
// throw before any test runs.
const execFileMock = vi.fn();
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  execFile: (cmd: string, args: string[], opts: unknown, cb: any) => {
    // promisified execFile passes (cmd, args, opts?, cb) — opts may
    // be a function if omitted.
    const callback = typeof opts === 'function' ? opts : cb;
    Promise.resolve(execFileMock(cmd, args)).then(
      (stdout: string) => callback(null, { stdout, stderr: '' }),
      (err: Error) => callback(err, null)
    );
  },
}));

const { fetchAllFiles, __resetTargetFetchTtlForTest } = await import(
  './useDiffData.js'
);

interface CallShape {
  cmd: string;
  args: string[];
}

function recorder(handlers: ((c: CallShape) => string | Error | undefined)[]) {
  const calls: CallShape[] = [];
  execFileMock.mockImplementation(async (cmd: string, args: string[]) => {
    const call = { cmd, args };
    calls.push(call);
    for (const h of handlers) {
      const out = h(call);
      if (out instanceof Error) throw out;
      if (typeof out === 'string') return out;
    }
    // Unmatched commands are a test failure — fail loudly instead of
    // returning empty stdout and producing a misleading "0 files"
    // result that masks the real problem.
    throw new Error(`Unmatched git call in test: ${cmd} ${args.join(' ')}`);
  });
  return calls;
}

const sourceSha = 'a'.repeat(40);
const targetSha = 'b'.repeat(40);
const NUMSTAT = '5\t2\tsrc/foo.ts\n10\t0\tsrc/bar.ts\n';
const NAME_STATUS = 'M\tsrc/foo.ts\nA\tsrc/bar.ts\n';

function gitHandlers(opts: { localOriginSourceSha?: string | null } = {}) {
  return [
    (c: CallShape) => {
      if (c.cmd !== 'git') return;
      // rev-parse --verify origin/<source>
      if (c.args[0] === 'rev-parse' && c.args[1] === '--verify') {
        const ref = c.args[2];
        if (ref === 'origin/feature') {
          if (opts.localOriginSourceSha === null) {
            return new Error('not a ref');
          }
          return (opts.localOriginSourceSha ?? sourceSha) + '\n';
        }
        if (ref === 'origin/main') return targetSha + '\n';
        return new Error(`unexpected rev-parse ref ${ref}`);
      }
      if (c.args[0] === 'fetch') return ''; // fetch returns nothing meaningful
      if (c.args[0] === 'diff' && c.args[1] === '--numstat') return NUMSTAT;
      if (c.args[0] === 'diff' && c.args[1] === '--name-status') {
        return NAME_STATUS;
      }
      return;
    },
  ];
}

function countFetches(calls: CallShape[], branch: string): number {
  return calls.filter(
    (c) =>
      c.cmd === 'git' &&
      c.args[0] === 'fetch' &&
      c.args[1] === 'origin' &&
      c.args[2] === branch
  ).length;
}

describe('fetchAllFiles freshness', () => {
  beforeEach(() => {
    __resetTargetFetchTtlForTest();
    execFileMock.mockReset();
    vi.useRealTimers();
  });

  it('cold open with unknown headSha fetches both source and target', async () => {
    const calls = recorder(gitHandlers());

    const { files } = await fetchAllFiles('feature', 'main', undefined);

    expect(countFetches(calls, 'feature')).toBe(1);
    expect(countFetches(calls, 'main')).toBe(1);
    expect(files).toHaveLength(2);
  });

  it('warm open skips source fetch when local origin/<source> matches headSha', async () => {
    // Pre-warm the target TTL so we isolate the source-skip rule.
    const warm = recorder(gitHandlers());
    await fetchAllFiles('feature', 'main', undefined);
    expect(countFetches(warm, 'main')).toBe(1);

    execFileMock.mockReset();
    const calls = recorder(gitHandlers());

    await fetchAllFiles('feature', 'main', sourceSha);
    expect(countFetches(calls, 'feature')).toBe(0);
  });

  it('refetches source on force-push (local sha differs from headSha)', async () => {
    // Local origin/feature points to an older SHA than what the API says
    // is the head — that's the force-push shape (or just stale local).
    const calls = recorder(
      gitHandlers({ localOriginSourceSha: 'c'.repeat(40) })
    );

    await fetchAllFiles('feature', 'main', sourceSha);

    expect(countFetches(calls, 'feature')).toBe(1);
  });

  it('refetches source when local origin/<source> ref does not exist', async () => {
    // Stateful mock: rev-parse fails until after the fetch lands,
    // then resolves to sourceSha — same shape as a real `git fetch`
    // creating the missing remote-tracking ref.
    let sourceFetched = false;
    const calls: CallShape[] = [];
    execFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      if (args[0] === 'rev-parse' && args[2] === 'origin/feature') {
        if (!sourceFetched) throw new Error('not a ref');
        return sourceSha + '\n';
      }
      if (args[0] === 'rev-parse' && args[2] === 'origin/main') {
        return targetSha + '\n';
      }
      if (args[0] === 'fetch' && args[2] === 'feature') {
        sourceFetched = true;
        return '';
      }
      if (args[0] === 'fetch') return '';
      if (args[0] === 'diff' && args[1] === '--numstat') return NUMSTAT;
      if (args[0] === 'diff' && args[1] === '--name-status') return NAME_STATUS;
      throw new Error(`Unmatched: ${cmd} ${args.join(' ')}`);
    });

    await fetchAllFiles('feature', 'main', sourceSha);
    expect(countFetches(calls, 'feature')).toBe(1);
  });

  it('skips target fetch within the 5-minute TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T00:00:00Z'));

    const calls1 = recorder(gitHandlers());
    await fetchAllFiles('feature', 'main', undefined);
    expect(countFetches(calls1, 'main')).toBe(1);

    // Advance just under the TTL window.
    vi.setSystemTime(new Date('2026-04-26T00:04:00Z'));
    execFileMock.mockReset();
    const calls2 = recorder(gitHandlers());
    await fetchAllFiles('feature', 'main', sourceSha);
    expect(countFetches(calls2, 'main')).toBe(0);
  });

  it('refetches target after the TTL window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T00:00:00Z'));

    const calls1 = recorder(gitHandlers());
    await fetchAllFiles('feature', 'main', undefined);
    expect(countFetches(calls1, 'main')).toBe(1);

    vi.setSystemTime(new Date('2026-04-26T00:06:00Z'));
    execFileMock.mockReset();
    const calls2 = recorder(gitHandlers());
    await fetchAllFiles('feature', 'main', sourceSha);
    expect(countFetches(calls2, 'main')).toBe(1);
  });

  it('returns parsed files even when both fetches are skipped', async () => {
    // Pre-warm so both fetches are skippable on the second call.
    recorder(gitHandlers());
    await fetchAllFiles('feature', 'main', undefined);

    execFileMock.mockReset();
    const calls = recorder(gitHandlers());
    const { files, sourceRef, targetRef } = await fetchAllFiles(
      'feature',
      'main',
      sourceSha
    );

    expect(countFetches(calls, 'feature')).toBe(0);
    expect(countFetches(calls, 'main')).toBe(0);
    expect(sourceRef).toBe('origin/feature');
    expect(targetRef).toBe('origin/main');
    expect(files.map((f) => f.filename).sort()).toEqual([
      'src/bar.ts',
      'src/foo.ts',
    ]);
  });

  it('fetch failure does not throw — fall through to resolveRef as today', async () => {
    // The freshness logic must tolerate a flaky network. The original
    // .catch(() => {}) on each fetch swallowed errors; this test
    // pins that contract so a future "throw on fetch failure" change
    // gets caught.
    const calls = recorder([
      (c) => {
        if (c.args[0] === 'fetch') return new Error('network');
        if (c.args[0] === 'rev-parse') return sourceSha + '\n';
        if (c.args[0] === 'diff' && c.args[1] === '--numstat') return NUMSTAT;
        if (c.args[0] === 'diff' && c.args[1] === '--name-status')
          return NAME_STATUS;
        return;
      },
    ]);

    const result = await fetchAllFiles('feature', 'main', undefined);
    expect(result.files).toHaveLength(2);
    // Should still have attempted both fetches.
    expect(countFetches(calls, 'feature')).toBe(1);
    expect(countFetches(calls, 'main')).toBe(1);
  });
});

// The two git outputs describe the same diff differently — numstat has the
// line counts, name-status the status letter and the rename pairing — and
// joining them is where the fiddly cases live.
describe('fetchAllFiles parsing', () => {
  beforeEach(() => {
    __resetTargetFetchTtlForTest();
    execFileMock.mockReset();
    vi.useRealTimers();
  });

  function parseWith(numstat: string, nameStatus: string) {
    recorder([
      (c: CallShape) => {
        if (c.args[0] === 'rev-parse') return sourceSha + '\n';
        if (c.args[0] === 'fetch') return '';
        if (c.args[0] === 'diff' && c.args[1] === '--numstat') return numstat;
        if (c.args[0] === 'diff' && c.args[1] === '--name-status') {
          return nameStatus;
        }
        return;
      },
    ]);
    return fetchAllFiles('feature', 'main', undefined);
  }

  it('takes a rename from the third path field and finds its combined numstat key', async () => {
    // numstat keys the rename by "old => new" while name-status splits the
    // two apart, so the exact lookup misses and the fallback scan has to
    // find it. Pins both halves of the join.
    const { files } = await parseWith(
      '3\t1\told.ts => new.ts\n',
      'R096\told.ts\tnew.ts\n'
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'new.ts',
      previousFilename: 'old.ts',
      status: 'renamed',
      additions: 3,
      deletions: 1,
    });
  });

  it('reads a copy the same way as a rename', async () => {
    const { files } = await parseWith(
      '2\t0\ta.ts => b.ts\n',
      'C075\ta.ts\tb.ts\n'
    );

    expect(files[0]).toMatchObject({
      filename: 'b.ts',
      previousFilename: 'a.ts',
      status: 'copied',
      additions: 2,
      deletions: 0,
    });
  });

  // Git compacts a rename's two paths into one display string whenever
  // they share anything, which is most renames — a file moved within its
  // own directory always does. The reconstructed pair is what the counts
  // are keyed by, so these are the shapes git actually emits (verified
  // against a real repo), not invented ones.
  it('reads the counts when git compacts a rename into brace form', async () => {
    const { files } = await parseWith(
      '3\t1\tsrc/{old.ts => new.ts}\n',
      'R096\tsrc/old.ts\tsrc/new.ts\n'
    );

    expect(files[0]).toMatchObject({
      filename: 'src/new.ts',
      previousFilename: 'src/old.ts',
      status: 'renamed',
      additions: 3,
      deletions: 1,
    });
  });

  it('reads the counts when the compacted sides span directories', async () => {
    const { files } = await parseWith(
      '1\t0\tsrc/{deep/two.ts => new.ts}\n',
      'R075\tsrc/deep/two.ts\tsrc/new.ts\n'
    );

    expect(files[0]).toMatchObject({
      filename: 'src/new.ts',
      previousFilename: 'src/deep/two.ts',
      additions: 1,
      deletions: 0,
    });
  });

  // An empty side reassembles into a doubled slash that matches nothing.
  // It only ever happens on one side, so these two pin that the *other*
  // side carries the join — one case per direction.
  it('reads the counts when a rename only adds a directory level', async () => {
    const { files } = await parseWith(
      '1\t0\ta/{ => b}/file.ts\n',
      'R100\ta/file.ts\ta/b/file.ts\n'
    );

    expect(files[0]).toMatchObject({
      filename: 'a/b/file.ts',
      previousFilename: 'a/file.ts',
      additions: 1,
      deletions: 0,
    });
  });

  it('reads the counts when a rename removes a directory level', async () => {
    const { files } = await parseWith(
      '1\t0\ta/{b => }/file.ts\n',
      'R075\ta/b/file.ts\ta/file.ts\n'
    );

    expect(files[0]).toMatchObject({
      filename: 'a/file.ts',
      previousFilename: 'a/b/file.ts',
      additions: 1,
      deletions: 0,
    });
  });

  it('reports a binary file as zero changes rather than NaN', async () => {
    // numstat writes "-" for both counts on a binary file, and Number('-')
    // is NaN — which would reach the UI as a blank count.
    const { files } = await parseWith(
      '-\t-\tassets/logo.png\n',
      'M\tassets/logo.png\n'
    );

    expect(files[0]).toMatchObject({
      filename: 'assets/logo.png',
      binary: true,
      additions: 0,
      deletions: 0,
    });
  });

  it('defaults counts to zero when numstat has no entry for the file', async () => {
    const { files } = await parseWith('', 'A\tsrc/only.ts\n');

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'src/only.ts',
      status: 'added',
      additions: 0,
      deletions: 0,
      binary: false,
    });
  });

  it('maps each name-status letter to its status', async () => {
    const { files } = await parseWith(
      '1\t0\ta.ts\n0\t1\tb.ts\n1\t1\tc.ts\n1\t1\td.ts\n',
      'A\ta.ts\nD\tb.ts\nT\tc.ts\nM\td.ts\n'
    );

    expect(files.map((f) => f.status)).toEqual([
      'added',
      'removed',
      'changed',
      'modified',
    ]);
  });
});
