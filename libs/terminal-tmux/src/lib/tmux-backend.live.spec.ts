/**
 * Live integration suite — spawns real tmux sessions to verify the
 * backend works end-to-end against a real tmux binary. Auto-skipped
 * on machines without tmux (`tmux -V` failing) so devs and macOS-
 * without-brew CI legs are not blocked. Ubuntu GitHub Actions
 * runners ship with tmux preinstalled, so this runs in CI for free.
 *
 * The unit suite (tmux-backend.spec.ts) already covers every code
 * path with mocks; this file's job is to catch the things mocks
 * can't see — wrong tmux flag, broken arg ordering, tmux version
 * weirdness, etc.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createTmuxBackendFactory } from './tmux-backend.js';
import { tmuxHasSession, tmuxKillSession } from './tmux-cli.js';

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !tmuxAvailable();

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
