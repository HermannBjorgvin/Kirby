import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPtyBackendFactory } from '@kirby/terminal-pty';
import { createTmuxBackendFactory } from '@kirby/terminal-tmux';
import { orchestraFixture } from '../../tests/orchestra-fixture.js';
import { diffScans } from './discovery/discovery-model.js';
import {
  getSession,
  isSessionAlive,
  killSession,
  setSessionBackendFactory,
  spawnSession,
} from './pty-registry.js';
import { worktreeSessionKey } from './session-key.js';
import { probeTmuxAvailability, resetRepoRoot } from './session-backend.js';
import { kirbyTmuxFactoryOptions } from './tmux-factory-options.js';
import { launchTerminalSession } from './terminal/launch-terminal.js';
import { newTerminalSessionName } from './terminal/terminal-name.js';
import { removeWorktreeSession } from './session/remove-worktree.js';

// Real backends and private tmux server; no model or personal sessions involved.
describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'qualified registry identities',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    beforeEach(async () => {
      fixture = orchestraFixture();
      await probeTmuxAvailability();
    });
    afterEach(() => {
      fixture.close();
      resetRepoRoot();
    });
    function checkout(branch: string, directory: string, repo = fixture.repo) {
      const path = join(repo, '.claude', 'worktrees', directory);
      execFileSync('git', ['worktree', 'add', '-b', branch, path], {
        cwd: repo,
        stdio: 'ignore',
      });
      return path;
    }
    function factory(backend: 'pty' | 'tmux') {
      setSessionBackendFactory(
        backend === 'tmux'
          ? createTmuxBackendFactory(kirbyTmuxFactoryOptions(fixture.repo))
          : createPtyBackendFactory()
      );
    }
    it.each(['pty', 'tmux'] as const)(
      '%s keeps a same-label terminal alive when a worktree is removed, in either creation order',
      async (backend) => {
        factory(backend);
        for (const order of ['terminal-first', 'worktree-first']) {
          const branch = 'shop-shell';
          const path = checkout(branch, order);
          const key = worktreeSessionKey(branch, fixture.repo);
          const worktree = () =>
            spawnSession(key, '/bin/sh', ['-c', 'sleep 300'], 80, 24, path);
          const terminal = () =>
            launchTerminalSession({
              name: newTerminalSessionName(),
              fresh: true,
              kind: 'shell',
              cwd: fixture.repo,
              cols: 80,
              rows: 24,
              config: {
                terminalBackend: backend,
                vendorAuth: {},
                vendorProject: {},
              },
            });
          const [agent, tab] =
            order === 'terminal-first'
              ? (() => {
                  const tab = terminal();
                  return [worktree(), tab] as const;
                })()
              : ([worktree(), terminal()] as const);
          expect(tab.name).not.toBe(key);
          expect(getSession(key)).toBe(agent);
          expect(getSession(tab.name)).toBe(tab);
          expect(isSessionAlive(key)).toBe(true);
          expect(await removeWorktreeSession(branch, true, fixture.repo)).toBe(
            true
          );
          expect(isSessionAlive(key)).toBe(false);
          expect(isSessionAlive(tab.name)).toBe(true);
          killSession(tab.name);
        }
      }
    );
    it.each(['pty', 'tmux'] as const)(
      '%s keeps exact branches and repositories separate',
      (backend) => {
        factory(backend);
        const otherRepo = join(fixture.home, 'other');
        mkdirSync(otherRepo);
        execFileSync('git', ['clone', fixture.repo, otherRepo], {
          stdio: 'ignore',
        });
        const cases = [
          { branch: 'feature/login', repo: fixture.repo, directory: 'slash' },
          { branch: 'feature-login', repo: fixture.repo, directory: 'hyphen' },
          { branch: 'feature/login', repo: otherRepo, directory: 'slash' },
        ];
        const keys = cases.map(({ branch, repo, directory }) => {
          const key = worktreeSessionKey(branch, repo);
          spawnSession(
            key,
            '/bin/sh',
            ['-c', 'sleep 300'],
            80,
            24,
            checkout(branch, directory, repo)
          );
          return key;
        });
        expect(new Set(keys).size).toBe(3);
        keys.forEach((key) => expect(isSessionAlive(key)).toBe(true));
        killSession(keys[0]);
        expect(isSessionAlive(keys[1])).toBe(true);
        expect(isSessionAlive(keys[2])).toBe(true);
        keys.forEach(killSession);
      }
    );
    it('offers a tagged worktree for discovery even when a same-label terminal is held', () => {
      factory('tmux');
      const branch = 'shop-shell';
      const path = checkout(branch, 'player');
      const key = worktreeSessionKey(branch, fixture.repo);
      const tab = launchTerminalSession({
        name: newTerminalSessionName(),
        fresh: true,
        kind: 'shell',
        cwd: fixture.repo,
        cols: 80,
        rows: 24,
        config: { terminalBackend: 'tmux', vendorAuth: {}, vendorProject: {} },
      });
      // A second creator uses the same protocol as Orchestra.
      const external = createTmuxBackendFactory(
        kirbyTmuxFactoryOptions(fixture.repo)
      )({
        name: key,
        cmd: '/bin/sh',
        args: ['-c', 'sleep 300'],
        cwd: path,
        cols: 80,
        rows: 24,
      });
      const delta = diffScans(
        null,
        {
          worktrees: [{ name: key, branch, path }],
          persisted: new Set([key]),
          terminals: [],
        },
        isSessionAlive
      );
      expect(delta.adoptable.map((w) => w.name)).toEqual([key]);
      const adopted = spawnSession(
        key,
        '/bin/sh',
        ['-c', 'exit 99'],
        80,
        24,
        path
      );
      expect(adopted.pty.name).toBe(external.name);
      expect(isSessionAlive(tab.name)).toBe(true);
      external.dispose();
    });
    it.each(['pty', 'tmux'] as const)(
      '%s rejects a checkout on another branch before replacing any session',
      (backend) => {
        factory(backend);
        const path = checkout('feature/login', 'login');
        const key = worktreeSessionKey('feature/login', fixture.repo);
        const agent = spawnSession(
          key,
          '/bin/sh',
          ['-c', 'sleep 300'],
          80,
          24,
          path
        );
        expect(() =>
          spawnSession(
            worktreeSessionKey('feature-login', fixture.repo),
            '/bin/sh',
            [],
            80,
            24,
            path
          )
        ).toThrow('Worktree is on');
        expect(getSession(key)).toBe(agent);
        expect(isSessionAlive(key)).toBe(true);
        killSession(key);
      }
    );
  }
);
