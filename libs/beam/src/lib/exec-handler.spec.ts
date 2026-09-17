import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createExecStreamHandler,
  decodeExecExit,
  demuxExecData,
  EXEC_CHANNEL_STDERR,
  EXEC_CHANNEL_STDOUT,
  prefixChannel,
} from './exec-handler.js';
import type { BeamStream, StreamContext } from './stream.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beam-exec-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Minimal fake BeamStream, matching pty-handler.spec.ts's pattern. */
function fakeStream(
  openParams: Record<string, unknown>,
  peer: StreamContext = { peerId: 'caller', label: 'laptop' }
) {
  const dataHandlers: ((data: Uint8Array) => void)[] = [];
  const closeHandlers: ((reason?: string) => void)[] = [];
  let closedWith: string | undefined;
  let closed = false;
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const stream: BeamStream = {
    id: 1,
    name: 'exec',
    peer,
    openParams,
    write: (data) => {
      const { channel, payload } = demuxExecData(data);
      if (channel === EXEC_CHANNEL_STDOUT) stdout.push(payload);
      else if (channel === EXEC_CHANNEL_STDERR) stderr.push(payload);
    },
    control: () => undefined,
    close: (reason) => {
      if (closed) return;
      closed = true;
      closedWith = reason;
      for (const h of closeHandlers) h(reason);
    },
    onData: (h) => dataHandlers.push(h),
    onClose: (h) => closeHandlers.push(h),
    onControl: () => undefined,
  };
  return {
    stream,
    sendStdin: (text: string) =>
      dataHandlers.forEach((h) =>
        h(prefixChannel(0, new TextEncoder().encode(text)))
      ),
    endStdin: () =>
      dataHandlers.forEach((h) => h(prefixChannel(0, new Uint8Array(0)))),
    stdoutText: () =>
      stdout.map((b) => Buffer.from(b).toString('utf8')).join(''),
    stderrText: () =>
      stderr.map((b) => Buffer.from(b).toString('utf8')).join(''),
    get closedWith() {
      return closedWith;
    },
  };
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 4000
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() - started > timeoutMs)
      throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createExecStreamHandler', () => {
  it('runs argv and returns stdout, with stderr kept separate', async () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({
      argv: ['sh', '-c', 'echo out-line; echo err-line 1>&2'],
    });
    handler(fake.stream);
    await waitFor(fake.stdoutText, (t) => t.includes('out-line'));
    await waitFor(fake.stderrText, (t) => t.includes('err-line'));
    expect(fake.stdoutText()).toContain('out-line');
    expect(fake.stdoutText()).not.toContain('err-line');
    expect(fake.stderrText()).toContain('err-line');
    expect(fake.stderrText()).not.toContain('out-line');
  });

  it('the exit code reaches the caller, including a non-zero one', async () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({ argv: ['sh', '-c', 'exit 7'] });
    handler(fake.stream);
    await waitFor(
      () => fake.closedWith,
      (r) => r !== undefined
    );
    expect(decodeExecExit(fake.closedWith)).toEqual({
      exitCode: 7,
      signal: null,
    });
  });

  it('a signal death is reported, not a plain exit code', async () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({ argv: ['sh', '-c', 'kill -TERM $$'] });
    handler(fake.stream);
    await waitFor(
      () => fake.closedWith,
      (r) => r !== undefined
    );
    const exit = decodeExecExit(fake.closedWith);
    expect(exit?.signal).toBe('SIGTERM');
  });

  it('stdin is forwarded — more than 64 KiB round-trips through cat', async () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({ argv: ['cat'] });
    handler(fake.stream);
    const big = 'x'.repeat(70 * 1024);
    fake.sendStdin(big);
    fake.endStdin();
    const output = await waitFor(
      fake.stdoutText,
      (t) => t.length >= big.length
    );
    expect(output.length).toBe(big.length);
  });

  it('rejects a relative cwd rather than resolving it against the host cwd', () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({ argv: ['pwd'], cwd: 'relative/dir' });
    handler(fake.stream);
    expect(fake.closedWith).toMatch(/cwd must be absolute or start with ~\//);
  });

  it('honors an absolute cwd', async () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({ argv: ['pwd'], cwd: '/tmp' });
    handler(fake.stream);
    const output = await waitFor(fake.stdoutText, (t) => t.trim().length > 0);
    expect(output.trim()).toBe('/tmp');
  });

  it('argv[0] is never shell-interpreted: metacharacters run as a literal (failing) program name', async () => {
    const handler = createExecStreamHandler();
    const fake = fakeStream({ argv: ['echo hi; touch /tmp/should-not-exist'] });
    handler(fake.stream);
    await waitFor(
      () => fake.closedWith,
      (r) => r !== undefined
    );
    // A shell would have printed "hi"; a literal (failed) exec never does.
    expect(fake.stdoutText()).not.toContain('hi');
  });

  it('closing the stream kills the process group, including a grandchild', async () => {
    const pidFile = join(dir, 'child.pid');
    const handler = createExecStreamHandler();
    const fake = fakeStream({
      argv: ['sh', '-c', `sleep 60 & echo $! > ${pidFile}; wait`],
    });
    handler(fake.stream);
    const childPid = await waitFor(
      () => {
        try {
          return Number(readFileSync(pidFile, 'utf8').trim());
        } catch {
          return 0;
        }
      },
      (pid) => pid > 0
    );
    expect(isAlive(childPid)).toBe(true);
    fake.stream.close('caller done');
    await waitFor(
      () => !isAlive(childPid),
      (dead) => dead
    );
    expect(isAlive(childPid)).toBe(false);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
