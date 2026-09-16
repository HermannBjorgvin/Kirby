import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionBackend, SessionSpec } from '@kirby/terminal';
import { execFileSync } from 'node:child_process';
import { assertScratchTmuxSocket } from '../../vitest.setup.js';
import * as tmuxCli from './tmux-cli.js';
import { tmuxSessionSnapshot } from './tmux-snapshot.js';
import { createTmuxBackend } from './tmux-backend.js';
import {
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessionsDetailed,
  tmuxPaneState,
  tmuxShowOption,
} from './tmux-cli.js';

const backends: SessionBackend[] = [];
function spec(cmd: string): SessionSpec & { name: string } {
  return {
    name: `lifecycle-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
    cmd: '/bin/sh',
    args: ['-c', cmd],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  };
}
async function retained(command: string): Promise<SessionBackend> {
  const request = spec(command);
  const backend = await createTmuxBackend(request, {
    mode: 'create',
    label: request.name,
    tags: { '@test-agent': 'first' },
    retainOnExit: true,
  });
  backends.push(backend);
  return backend;
}
beforeAll(assertScratchTmuxSocket);
afterEach(() => {
  for (const backend of backends.splice(0)) backend.kill();
});

describe('retained tmux process lifecycle', () => {
  it('publishes creation metadata together at native command boundaries', async () => {
    const request = spec('sleep 30');
    const tags = {
      '@type': 'worktree',
      '@branch': 'feature/example',
      '@agent': 'example',
    };
    const observed: Record<string, string>[] = [];
    const observe = () => {
      const session = tmuxListSessionsDetailed(Object.keys(tags)).find(
        (s) => s.name === request.name
      );
      if (session?.options?.['@type']) observed.push(session.options);
    };
    const setOption = tmuxCli.tmuxSetOption;
    // Another client can discover the session between native round trips.
    // Observe each separate option write, plus the completed command queue.
    const observer = vi
      .spyOn(tmuxCli, 'tmuxSetOption')
      .mockImplementation((...args) => {
        const result = setOption(...args);
        observe();
        return result;
      });
    try {
      const backend = await createTmuxBackend(request, {
        mode: 'create',
        label: request.name,
        tags,
        retainOnExit: true,
      });
      backends.push(backend);
      observe();
      expect(observed.length).toBeGreaterThan(0);
      for (const metadata of observed) expect(metadata).toEqual(tags);
    } finally {
      observer.mockRestore();
    }
  });
  it('keeps semicolons and multiline launch arguments literal in native command queues', async () => {
    const request = spec('');
    const literal = [';', 'trailing;', 'backslash\\;', 'quoted "value"\nnext;'];
    request.args = [
      '-c',
      'printf "<%s>\\n" "$@"; printf "seed:<%s>\\n" "$SESSION_SEED"',
      'test-agent',
      ...literal,
    ];
    request.envAdditions = { SESSION_SEED: 'prompt;\nend;' };
    const backend = await createTmuxBackend(request, {
      mode: 'create',
      label: request.name,
      tags: { '@literal': 'metadata;' },
      retainOnExit: true,
    });
    backends.push(backend);
    await vi.waitFor(() =>
      expect(tmuxPaneState(backend.name!)?.paneDead).toBe(true)
    );
    expect(tmuxShowOption(backend.name!, '@literal')).toBe('metadata;');
    const output = tmuxCli.tmuxCapturePane(backend.name!);
    for (const argument of literal) expect(output).toContain(`<${argument}>`);
    expect(output).toContain('seed:<prompt;\nend;>');
  });
  it('replaces only the approved process and applies metadata after the guarded launch', async () => {
    const first = await retained('sleep 30');
    tmuxCli.tmuxSetOption(first.name!, '@supervisor', 'old');
    const snapshot = tmuxSessionSnapshot(first.name!, [
      '@test-agent',
      '@supervisor',
    ])!;
    expect(snapshot.options).toMatchObject({
      '@test-agent': 'first',
      '@supervisor': 'old',
    });
    const request = spec('');
    const literal = 'literal "$HOME";\nbackslash \\ end;';
    request.args = ['-c', 'printf "%s\\n" "$1"; sleep 30', 'agent', literal];
    const replaced = await createTmuxBackend(request, {
      mode: 'replace',
      target: first.name!,
      expected: snapshot.incarnation,
      tags: { '@test-agent': 'second', '@supervisor': null },
      retainOnExit: true,
    });
    backends.push(replaced);
    const winner = tmuxSessionSnapshot(first.name!, [
      '@test-agent',
      '@supervisor',
    ])!;
    expect(winner.incarnation.panePid).not.toBe(snapshot.incarnation.panePid);
    expect(winner.options).toEqual({ '@test-agent': 'second' });
    await vi.waitFor(() =>
      expect(tmuxCli.tmuxCapturePane(first.name!)).toContain(literal)
    );
    await expect(
      createTmuxBackend(spec('sleep 30'), {
        mode: 'replace',
        target: first.name!,
        expected: snapshot.incarnation,
        tags: { '@test-agent': 'stale' },
        retainOnExit: true,
      })
    ).rejects.toThrow('Session changed');
    expect(tmuxSessionSnapshot(first.name!, ['@test-agent'])).toMatchObject({
      incarnation: winner.incarnation,
      options: { '@test-agent': 'second' },
      paneDead: false,
    });
  });
  it('rejects replacement approval from another server or a deleted session incarnation', async () => {
    const first = await retained('sleep 30');
    const original = tmuxSessionSnapshot(first.name!)!.incarnation;
    await expect(
      createTmuxBackend(spec('sleep 30'), {
        mode: 'replace',
        target: first.name!,
        expected: { ...original, serverPid: original.serverPid + 1 },
      })
    ).rejects.toThrow('Session changed');
    first.kill();
    const request = spec('sleep 30');
    const next = await createTmuxBackend(request, {
      mode: 'create',
      label: first.name!,
      tags: {},
      retainOnExit: true,
    });
    backends.push(next);
    const winner = tmuxSessionSnapshot(next.name!)!.incarnation;
    await expect(
      createTmuxBackend(spec('sleep 30'), {
        mode: 'replace',
        target: next.name!,
        expected: original,
      })
    ).rejects.toThrow('Session changed');
    expect(tmuxSessionSnapshot(next.name!)!.incarnation).toEqual(winner);
  });
  it('guards identity tags literally and refuses a target retagged after selection', async () => {
    const first = await retained('sleep 30');
    const identity = 'repo,branch} #{pane_pid}';
    tmuxCli.tmuxSetOption(first.name!, '@identity', identity);
    const expected = tmuxSessionSnapshot(first.name!)!.incarnation;
    const attached = await createTmuxBackend(spec('sleep 30'), {
      mode: 'attach',
      target: first.name!,
      expected,
      expectedTags: { '@identity': identity },
    });
    backends.push(attached);
    tmuxCli.tmuxSetOption(first.name!, '@identity', 'another owner');
    await expect(
      createTmuxBackend(spec('sleep 30'), {
        mode: 'replace',
        target: first.name!,
        expected,
        expectedTags: { '@identity': identity },
        tags: { '@test-agent': 'changed' },
      })
    ).rejects.toThrow('Session changed');
    expect(tmuxSessionSnapshot(first.name!)!.incarnation).toEqual(expected);
    expect(tmuxShowOption(first.name!, '@test-agent')).toBe('first');
  });
  it('rejects a stale Continue attachment and restart after a process changes', async () => {
    const first = await retained('sleep 30');
    const expected = tmuxSessionSnapshot(first.name!)!.incarnation;
    const replaced = await createTmuxBackend(spec('exit 9'), {
      mode: 'replace',
      target: first.name!,
      expected,
      retainOnExit: true,
    });
    backends.push(replaced);
    await vi.waitFor(() =>
      expect(tmuxPaneState(first.name!)?.paneDead).toBe(true)
    );
    for (const mode of ['attach', 'restart'] as const) {
      await expect(
        createTmuxBackend(spec('sleep 30'), {
          mode,
          target: first.name!,
          expected,
          ...(mode === 'restart' ? { retainOnExit: true } : {}),
        })
      ).rejects.toThrow('Session changed');
    }
    expect(tmuxPaneState(first.name!)?.exitCode).toBe(9);
  });
  it('retains immediate exit status and creation tags before a client attaches', async () => {
    const backend = await retained('exit 17');
    const exit = vi.fn();
    backend.onExit(exit);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(17, undefined), {
      timeout: 4000,
    });
    expect(tmuxShowOption(backend.name!, '@test-agent')).toBe('first');
    expect(
      tmuxListSessionsDetailed(['@test-agent']).find(
        (s) => s.name === backend.name
      )
    ).toMatchObject({
      paneDead: true,
      exitCode: 17,
      options: { '@test-agent': 'first' },
    });
    expect(tmuxHasSession(backend.name!)).toBe(true);
  });
  it('delivers fast launch failure output before reporting its logical exit', async () => {
    const backend = await retained('/nonexistent/tmux-test-agent');
    let output = '';
    backend.onData((data) => {
      output += data;
    });
    const atExit = vi.fn(() => output);
    backend.onExit(atExit);
    await vi.waitFor(() => expect(atExit).toHaveBeenCalledOnce());
    expect(atExit.mock.results[0]?.value).toMatch(/not found|No such file/i);
  });
  it('reattaches an exited pane without executing a new command or overwriting tags', async () => {
    const first = await retained('echo retained-output; exit 4');
    await vi.waitFor(() =>
      expect(tmuxPaneState(first.name!)?.paneDead).toBe(true)
    );
    first.dispose();
    const attached = await createTmuxBackend(
      spec('echo should-not-run; sleep 30'),
      {
        mode: 'attach',
        target: first.name!,
      }
    );
    backends.push(attached);
    const exit = vi.fn();
    attached.onExit(exit);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(4, undefined));
    expect(tmuxShowOption(first.name!, '@test-agent')).toBe('first');
    const output = execFileSync(
      'tmux',
      ['capture-pane', '-p', '-S', '-', '-t', `=${first.name}:`],
      { encoding: 'utf8' }
    );
    expect(output).toContain('retained-output');
    expect(output).not.toContain('should-not-run');
  });
  it('restarts only a dead pane and refuses to interrupt the resulting live process', async () => {
    const first = await retained('exit 6');
    await vi.waitFor(() =>
      expect(tmuxPaneState(first.name!)?.paneDead).toBe(true)
    );
    first.dispose();
    const restarted = await createTmuxBackend(
      spec('echo restarted; sleep 30'),
      {
        mode: 'restart',
        target: first.name!,
        tags: { '@test-agent': 'second' },
        retainOnExit: true,
      }
    );
    backends.push(restarted);
    expect(tmuxPaneState(first.name!)?.paneDead).toBe(false);
    expect(tmuxShowOption(first.name!, '@test-agent')).toBe('second');
    await expect(
      createTmuxBackend(spec('exit 0'), {
        mode: 'restart',
        target: first.name!,
      })
    ).rejects.toThrow('running');
    expect(tmuxPaneState(first.name!)?.paneDead).toBe(false);
  });
  it('does not overwrite the winning restart metadata after a stale dead-pane read', async () => {
    const winner = await retained('sleep 30');
    // Another launcher observed the old dead state before this live agent won.
    const staleRead = vi
      .spyOn(tmuxCli, 'tmuxPaneState')
      .mockReturnValueOnce({ paneDead: true });
    try {
      await expect(
        createTmuxBackend(spec('sleep 30'), {
          mode: 'restart',
          target: winner.name!,
          tags: { '@test-agent': 'loser' },
          retainOnExit: false,
        })
      ).rejects.toThrow('still active');
      expect(tmuxShowOption(winner.name!, '@test-agent')).toBe('first');
      expect(tmuxShowOption(winner.name!, 'remain-on-exit')).toBe('on');
    } finally {
      staleRead.mockRestore();
    }
  });
  it('injects launch-specific environment into an already-running server', async () => {
    await retained('sleep 30');
    const request = spec(
      'printf "env:%s:%s\\n" "$HOME" "$SESSION_SEED"; exit 0'
    );
    request.env = { ...process.env, HOME: '/tmp/alternate-home' };
    request.envAdditions = { SESSION_SEED: 'literal seed' };
    const backend = await createTmuxBackend(request, {
      mode: 'create',
      label: request.name,
      tags: {},
      retainOnExit: true,
    });
    backends.push(backend);
    await vi.waitFor(() =>
      expect(tmuxPaneState(backend.name!)?.paneDead).toBe(true)
    );
    const output = execFileSync(
      'tmux',
      ['capture-pane', '-p', '-S', '-', '-t', `=${backend.name}:`],
      { encoding: 'utf8' }
    );
    expect(output).toContain('env:/tmp/alternate-home:literal seed');
  });
  it('reports logical exit when another program removes the tmux session', async () => {
    const backend = await retained('sleep 30');
    const exit = vi.fn();
    backend.onExit(exit);
    tmuxKillSession(backend.name!);
    expect(tmuxPaneState(backend.name!)).toBeNull();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce());
    expect(backend.processState?.running).toBe(false);
  });
  it('client detachment does not signal an agent exit', async () => {
    const backend = await retained('sleep 30');
    const exit = vi.fn();
    const disconnect = vi.fn();
    backend.onExit(exit);
    backend.onDisconnect?.(disconnect);
    // Wait for this client to attach before asking tmux to detach it.
    await vi.waitFor(() => {
      const clients = execFileSync(
        'tmux',
        ['list-clients', '-t', `=${backend.name}:`],
        { encoding: 'utf8' }
      );
      expect(clients.trim()).not.toBe('');
    });
    execFileSync('tmux', ['detach-client', '-s', `=${backend.name}:`]);
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(exit).not.toHaveBeenCalled();
    expect(tmuxPaneState(backend.name!)?.paneDead).toBe(false);
    await vi.waitFor(
      () => {
        const clients = execFileSync(
          'tmux',
          ['list-clients', '-t', `=${backend.name}:`],
          { encoding: 'utf8' }
        );
        expect(clients.trim()).not.toBe('');
      },
      { timeout: 4000 }
    );
    expect(backend.processState?.running).toBe(true);
  });
});
