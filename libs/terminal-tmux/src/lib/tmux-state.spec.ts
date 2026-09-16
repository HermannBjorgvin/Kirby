import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { tmuxPaneStateAsync } from './tmux-cli.js';

const mockedExecFile = vi.mocked(execFile);

type ExecFileCallback = (err: unknown, stdout: string, stderr: string) => void;

/** Queue one `execFile` response, matching the (cmd, argv, options,
 *  callback) shape `runTmuxAsync` calls it with. */
function respond(err: unknown, stdout = '', stderr = ''): void {
  mockedExecFile.mockImplementationOnce(
    (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exercising the Node callback shape directly, not typing it
      ...args: any[]
    ) => {
      const callback = args.at(-1) as ExecFileCallback;
      callback(err, stdout, stderr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- execFile's real return type (ChildProcess) is irrelevant here
      return {} as any;
    }
  );
}

beforeEach(() => mockedExecFile.mockReset());

// tmuxPaneStateAsync backs the backend's periodic poller (tmux-backend.ts),
// which must never conclude the hosted process exited just because Kirby
// could not talk to tmux this tick. These three outcomes are what the
// poller keys its decision on.
describe('tmuxPaneStateAsync', () => {
  it('reports a genuinely vanished target as gone', async () => {
    // display-message can succeed with empty, tab-only output for a
    // target that no longer exists.
    respond(null, '\t\t\t\n', '');
    expect(await tmuxPaneStateAsync('gone')).toEqual({ status: 'gone' });
  });

  it('reports the server itself having shut down as gone, not failed', async () => {
    // Killing a session's last sibling tears the server down with it,
    // which surfaces as this non-zero exit rather than empty output —
    // the same condition tmuxListSessionsDetailed treats as no sessions.
    respond(
      Object.assign(new Error('exit'), { code: 1 }),
      '',
      'no server running on /tmp/tmux-1000/default\n'
    );
    expect(await tmuxPaneStateAsync('last-session')).toEqual({
      status: 'gone',
    });
  });

  it('reports a read it could not complete as failed, distinct from an exit', async () => {
    // EAGAIN/EMFILE on fork, ENOENT, or the 5s timeout kill all reach
    // here as a non-zero exit with no "no server running" wording.
    respond(
      Object.assign(new Error('exit'), { code: 1 }),
      '',
      'some other tmux error\n'
    );
    expect(await tmuxPaneStateAsync('unreachable')).toEqual({
      status: 'failed',
    });
  });

  it('parses a live pane as ok', async () => {
    respond(null, '%7\t0\t\t\n', '');
    expect(await tmuxPaneStateAsync('running')).toEqual({
      status: 'ok',
      state: { paneDead: false },
    });
  });

  it('parses a dead pane with exit status as ok', async () => {
    respond(null, '%7\t1\t3\t\n', '');
    expect(await tmuxPaneStateAsync('exited')).toEqual({
      status: 'ok',
      state: { paneDead: true, exitCode: 3 },
    });
  });
});
