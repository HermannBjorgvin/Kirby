/**
 * Live integration suite — spawns real tmux sessions to verify the
 * backend works end-to-end against a real tmux binary, on a throwaway
 * tmux server of its own (`vitest.setup.ts` pins `TMUX_TMPDIR` and
 * drops `$TMUX`, so nothing here can reach the developer's). Auto-skipped
 * on machines without tmux (`tmux -V` failing) so devs and macOS-
 * without-brew CI legs are not blocked. Ubuntu GitHub Actions
 * runners ship with tmux preinstalled, so this runs in CI for free.
 *
 * The unit suite (tmux-backend.spec.ts) already covers every code
 * path with mocks; this file's job is to catch the things mocks
 * can't see — wrong tmux flag, broken arg ordering, tmux version
 * weirdness, etc.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createTmuxBackend } from './tmux-backend.js';
import {
  tmuxFreeSessionName,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessions,
  tmuxListSessionsDetailed,
  tmuxShowOption,
} from './tmux-cli.js';
import type { SessionSpec } from '@kirby/terminal';
import { assertScratchTmuxSocket } from '../../vitest.setup.js';

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** PID of the process running in the session's active pane. Stable
 *  across detach/attach, so it distinguishes a real reattach from a
 *  same-named session that was torn down and recreated. Test-local
 *  rather than added to tmux-cli.ts — the lib has no production need
 *  for it. */
function tmuxPanePid(session: string): string {
  return execFileSync(
    'tmux',
    ['display-message', '-p', '-t', `=${session}:`, '#{pane_pid}'],
    { encoding: 'utf8' }
  ).trim();
}

/** A session made by something other than the backend — the scenario
 *  every "foreign" test is about. */
function startForeignSession(name: string): void {
  execFileSync('tmux', [
    'new-session',
    '-d',
    '-s',
    name,
    '--',
    '/bin/sh',
    '-c',
    'sleep 30',
  ]);
}

const SKIP = !tmuxAvailable();

// This file creates and kills real tmux sessions. `vitest.setup.ts`
// points them at a throwaway server; if that ever stops taking effect
// the sessions land on the developer's own, next to their running
// agents. Stop rather than find out.
beforeAll(() => {
  assertScratchTmuxSocket();
});

/** Sessions created during a test, cleaned up in afterEach even on
 *  failure. Names are unique per test so parallel CI workers can't
 *  collide. */
const createdSessions: string[] = [];

function uniqueName(suffix: string): string {
  // PID + timestamp + random keeps parallel runners hermetic.
  const stamp = `${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return `tmuxlib-livetest-${stamp}-${suffix}`;
}

/** A factory that names sessions after the spec and resolves nothing
 *  unless told to — the test decides identity, the backend obeys. */
function factory(
  options: { resolve?: () => string; tags?: () => Record<string, string> } = {}
) {
  return (spec: SessionSpec & { name: string }) =>
    createTmuxBackend(
      spec,
      options.resolve
        ? { mode: 'attach', target: options.resolve() }
        : { mode: 'create', label: spec.name, tags: options.tags?.() ?? {} }
    );
}

function idle(name: string, command = 'sleep 30') {
  return {
    name,
    cmd: '/bin/sh',
    args: ['-c', command],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  // Best-effort cleanup. If a test's tmux session is already gone
  // (e.g. kill() ran successfully), tmuxKillSession's non-zero exit
  // is captured in the result rather than thrown — we don't need to
  // check it.
  while (createdSessions.length > 0) {
    const name = createdSessions.pop()!;
    tmuxKillSession(name);
  }
});

describe.skipIf(SKIP)('TmuxBackend live integration', () => {
  it('creates a real tmux session and pipes shell output through', async () => {
    const name = uniqueName('output');
    createdSessions.push(name);

    const backend = await factory()(
      idle(name, 'echo hello-from-tmux; sleep 5')
    );
    const chunks: string[] = [];
    backend.onData((chunk) => chunks.push(chunk));

    // Allow time for the client to attach, the shell to run, and the
    // output to flow back through the local tmux client PTY.
    await settle(750);

    expect(chunks.join('')).toContain('hello-from-tmux');
    expect(tmuxHasSession(name)).toBe(true);

    backend.kill();
  });

  it('dispose() detaches the local PTY and leaves the tmux session alive', async () => {
    const name = uniqueName('dispose');
    createdSessions.push(name);

    const backend = await factory()(idle(name));
    expect(tmuxHasSession(name)).toBe(true);

    backend.dispose();

    // Tmux session should still exist — this is the persistence
    // guarantee that lets sessions survive Kirby restarts.
    await settle(100);
    expect(tmuxHasSession(name)).toBe(true);
  });

  // The whole point of the tmux backend: Kirby exits (dispose), the
  // user relaunches, and the agent is still there with its history.
  // The unit suite can only assert the attach argv; this proves that
  // attaching by a resolved name lands on the *existing* session rather
  // than silently starting a fresh one.
  it('attaching by a resolved name preserves the running session', async () => {
    const name = uniqueName('reattach');
    createdSessions.push(name);
    const marker = `marker-${Math.random().toString(36).slice(2, 10)}`;
    // Echo a unique marker, then idle. The marker stays on the pane's
    // screen, so a genuine reattach redraws it; a fresh session would
    // re-run the command and produce a *new* pane with no history of
    // the first run's pid.
    const spec = idle(name, `echo ${marker}; sleep 30`);

    const first = await factory()(spec);
    await settle(500);
    const firstPanePid = tmuxPanePid(name);

    // Kirby "exits": detach only, tmux keeps running.
    first.dispose();
    await settle(200);
    expect(tmuxHasSession(name)).toBe(true);

    // Kirby "relaunches" and resolves the same session.
    const second = await factory({ resolve: () => name })(spec);
    const chunks: string[] = [];
    second.onData((chunk) => chunks.push(chunk));
    await settle(750);

    // Same pane process as before — proof we attached rather than
    // creating a second session that merely shares the name.
    expect(tmuxPanePid(name)).toBe(firstPanePid);
    // And the first run's output is still on screen after the redraw.
    expect(chunks.join('')).toContain(marker);
    // Nothing was created beside it.
    expect(tmuxListSessions().filter((n) => n.startsWith(name))).toEqual([
      name,
    ]);

    second.kill();
  });

  // Tags are the one thing about a session that another program on
  // the same server is meant to read, so the exact `set-option` target
  // form, the `show-options -qv` read and the `#{@option}` format
  // column all have to agree with a real tmux — and they have to be
  // there the moment the factory returns, before a client can have
  // attached: the session was created detached and tagged first.
  it('writes the tags before the factory returns, and a later attach leaves them alone', async () => {
    const name = uniqueName('tags');
    createdSessions.push(name);
    const spec = idle(name);

    const first = await factory({
      tags: () => ({
        '@livetest-repo': '/repo/x',
        '@livetest-branch': 'feature/x',
      }),
    })(spec);
    // Synchronously: no settle. The tags were written on the detached
    // session before the client process was even spawned.
    expect(tmuxShowOption(name, '@livetest-repo')).toBe('/repo/x');
    expect(tmuxShowOption(name, '@livetest-branch')).toBe('feature/x');
    expect(tmuxShowOption(name, '@livetest-unset')).toBe('');

    first.dispose();
    await settle(200);
    // A second attach with its own idea of the tags — another program's
    // view of the same session — changes nothing already recorded.
    const second = await factory({
      resolve: () => name,
      tags: () => ({
        '@livetest-repo': '/somewhere/else',
        '@livetest-unset': 'x',
      }),
    })(spec);
    await settle(300);

    const listed = tmuxListSessionsDetailed([
      '@livetest-repo',
      '@livetest-branch',
      '@livetest-unset',
    ]).find((s) => s.name === name);
    expect(listed).toEqual({
      name,
      created: expect.any(Number),
      paneDead: false,
      path: process.cwd(),
      options: { '@livetest-repo': '/repo/x', '@livetest-branch': 'feature/x' },
    });
    // `session_created` is tmux's clock in epoch seconds — a real
    // timestamp, not the `0` an unparseable column would yield.
    expect(listed?.created).toBeGreaterThan(1_000_000_000);
    second.kill();
  });

  // A session that holds the label but was not resolved is somebody
  // else's — untagged, or another program's. It is neither attached to
  // nor killed: the backend takes the next free suffix for its own.
  it('neither attaches to nor kills a foreign session that holds the label', async () => {
    const name = uniqueName('foreign');
    createdSessions.push(name, `${name}-2`);
    startForeignSession(name);
    const foreignPid = tmuxPanePid(name);

    const backend = await factory({ tags: () => ({ '@livetest-mine': '1' }) })(
      idle(name)
    );
    expect(tmuxHasSession(`${name}-2`)).toBe(true);
    expect(tmuxShowOption(`${name}-2`, '@livetest-mine')).toBe('1');
    // The foreign one: same pane process, no tag written on it.
    expect(tmuxPanePid(name)).toBe(foreignPid);
    expect(tmuxShowOption(name, '@livetest-mine')).toBe('');

    backend.kill();
    await settle(100);
    expect(tmuxHasSession(`${name}-2`)).toBe(false);
    expect(tmuxHasSession(name)).toBe(true);
    expect(tmuxPanePid(name)).toBe(foreignPid);
  });

  it('kill() terminates the tmux session', async () => {
    const name = uniqueName('kill');
    createdSessions.push(name);

    const backend = await factory()(idle(name));
    expect(tmuxHasSession(name)).toBe(true);

    backend.kill();

    // backend.kill() runs `tmux kill-session` synchronously, but the
    // server may take a beat to clean up state. Brief wait to settle.
    await settle(100);
    expect(tmuxHasSession(name)).toBe(false);
  });

  // A bare `-t name` is a prefix match once `name` itself is gone, so
  // `has-session` would keep answering yes for `name` on the strength
  // of `name-2` — and a kill aimed at `name` would take `name-2` out.
  // Both go through the exact form, and only a real tmux proves that
  // form is accepted for these commands.
  it('has-session and kill-session are exact, never prefix matches', async () => {
    const name = uniqueName('exact');
    createdSessions.push(`${name}-2`);
    startForeignSession(`${name}-2`);
    expect(tmuxHasSession(name)).toBe(false);
    expect(tmuxKillSession(name).exitCode).not.toBe(0);
    expect(tmuxHasSession(`${name}-2`)).toBe(true);
  });

  it('tmuxFreeSessionName skips every candidate the server holds', async () => {
    const name = uniqueName('free');
    createdSessions.push(name, `${name}-2`);
    expect(tmuxFreeSessionName(name)).toBe(name);
    startForeignSession(name);
    startForeignSession(`${name}-2`);
    expect(tmuxFreeSessionName(name)).toBe(`${name}-3`);
  });

  // The signal discovery is built on: a session created without this
  // process being involved has to be *observable*, and observable in one
  // call rather than one per candidate. Only a real server proves the
  // `-F` format string and the no-server exit code behave as assumed.
  describe('tmuxListSessions', () => {
    it("reports a session created behind the backend's back", async () => {
      const name = uniqueName('listed');
      createdSessions.push(name);
      expect(tmuxListSessions()).not.toContain(name);

      // Deliberately not through the factory: this is the scenario —
      // something other than Kirby made the session.
      startForeignSession(name);

      expect(tmuxListSessions()).toContain(name);
    });

    it('stops reporting one that was killed from outside', async () => {
      const name = uniqueName('unlisted');
      startForeignSession(name);
      expect(tmuxListSessions()).toContain(name);

      tmuxKillSession(name);
      expect(tmuxListSessions()).not.toContain(name);
    });

    // Every candidate this repo asks about is answered from one call, so
    // the listing has to include sessions the caller never created.
    it('reports every live session in one call', async () => {
      const a = uniqueName('multi-a');
      const b = uniqueName('multi-b');
      createdSessions.push(a, b);
      for (const name of [a, b]) await factory()(idle(name));
      const listed = tmuxListSessions();
      expect(listed).toContain(a);
      expect(listed).toContain(b);
    });
  });
});
