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
import { createTmuxBackendFactory } from './tmux-backend.js';
import { tmuxHasSession, tmuxKillSession } from './tmux-cli.js';
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
    ['display-message', '-p', '-t', session, '#{pane_pid}'],
    { encoding: 'utf8' }
  ).trim();
}

const SKIP = !tmuxAvailable();

// This file creates and kills real tmux sessions. `vitest.setup.ts`
// points them at a throwaway server; if that ever stops taking effect
// the sessions land on the developer's own — where `kirby-` names are
// their running agents, not ours. Stop rather than find out.
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
  return `kirby-livetest-${stamp}-${suffix}`;
}

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

    const factory = createTmuxBackendFactory();
    const backend = factory({
      name,
      // bash -c keeps the session alive long enough for us to read
      // output before tmux tears the session down.
      cmd: '/bin/sh',
      args: ['-c', 'echo hello-from-tmux; sleep 5'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });

    const chunks: string[] = [];
    backend.onData((chunk) => chunks.push(chunk));

    // Allow time for the session to start, the shell to run, and
    // the output to flow back through the local tmux client PTY.
    await new Promise((r) => setTimeout(r, 750));

    const combined = chunks.join('');
    expect(combined).toContain('hello-from-tmux');
    expect(tmuxHasSession(name)).toBe(true);

    backend.kill();
  });

  it('dispose() detaches the local PTY and leaves the tmux session alive', async () => {
    const name = uniqueName('dispose');
    createdSessions.push(name);

    const factory = createTmuxBackendFactory();
    const backend = factory({
      name,
      cmd: '/bin/sh',
      args: ['-c', 'sleep 30'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });

    // Wait for tmux to create the session.
    await new Promise((r) => setTimeout(r, 300));
    expect(tmuxHasSession(name)).toBe(true);

    backend.dispose();

    // Tmux session should still exist — this is the persistence
    // guarantee that lets sessions survive Kirby restarts.
    await new Promise((r) => setTimeout(r, 100));
    expect(tmuxHasSession(name)).toBe(true);

    // afterEach will kill it.
  });

  // The whole point of the tmux backend: Kirby exits (dispose), the
  // user relaunches, and the agent is still there with its history. The
  // unit suite can only assert that `-A` appears in the argv; this is
  // the only test that proves `-A` actually reattaches to the *existing*
  // session rather than silently starting a fresh one.
  it('re-creating the same name reattaches, preserving the running session', async () => {
    const name = uniqueName('reattach');
    createdSessions.push(name);
    const marker = `marker-${Math.random().toString(36).slice(2, 10)}`;
    const factory = createTmuxBackendFactory();
    const spec = {
      name,
      // Echo a unique marker, then idle. The marker stays on the pane's
      // screen, so a genuine reattach redraws it; a fresh session would
      // re-run the command and produce a *new* pane with no history of
      // the first run's pid.
      cmd: '/bin/sh',
      args: ['-c', `echo ${marker}; sleep 30`],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    };

    const first = factory(spec);
    await new Promise((r) => setTimeout(r, 500));
    expect(tmuxHasSession(name)).toBe(true);
    const firstPanePid = tmuxPanePid(name);

    // Kirby "exits": detach only, tmux keeps running.
    first.dispose();
    await new Promise((r) => setTimeout(r, 200));
    expect(tmuxHasSession(name)).toBe(true);

    // Kirby "relaunches" with the same session name.
    const second = factory(spec);
    const chunks: string[] = [];
    second.onData((chunk) => chunks.push(chunk));
    await new Promise((r) => setTimeout(r, 750));

    // Same pane process as before — proof we attached rather than
    // creating a second session that merely shares the name.
    expect(tmuxPanePid(name)).toBe(firstPanePid);
    // And the first run's output is still on screen after the redraw.
    expect(chunks.join('')).toContain(marker);

    second.kill();
  });

  it('kill() terminates the tmux session', async () => {
    const name = uniqueName('kill');
    createdSessions.push(name);

    const factory = createTmuxBackendFactory();
    const backend = factory({
      name,
      cmd: '/bin/sh',
      args: ['-c', 'sleep 30'],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(tmuxHasSession(name)).toBe(true);

    backend.kill();

    // backend.kill() runs `tmux kill-session` synchronously, but the
    // server may take a beat to clean up state. Brief wait to settle.
    await new Promise((r) => setTimeout(r, 100));
    expect(tmuxHasSession(name)).toBe(false);

    // Pop from the cleanup list — already gone.
    const idx = createdSessions.indexOf(name);
    if (idx >= 0) createdSessions.splice(idx, 1);
  });
});
