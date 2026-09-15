import * as repoRoot from '../repo-root.js';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import { tmuxSetOption } from '@kirby/terminal-tmux';
import { orchestraFixture } from '../../../tests/orchestra-fixture.js';
import { diffScans } from '../discovery/discovery-model.js';
import {
  getSession,
  isSessionAlive,
  liveSessionNames,
} from '../pty-registry.js';
import { resolveSessionByName } from '../session-resolver.js';
import { terminalSessionKey } from '../session-key.js';
import { sessionTags } from '../session-identity.js';
import { launchTerminalSession } from './launch-terminal.js';

describe.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'terminal name allocation',
  () => {
    let fixture: ReturnType<typeof orchestraFixture>;
    beforeEach(() => {
      fixture = orchestraFixture();
      vi.spyOn(repoRoot, 'getRepoRoot').mockReturnValue(fixture.repo);
    });
    afterEach(() => {
      fixture?.close();
      vi.restoreAllMocks();
    });

    it('retains an exited agent terminal and resumes it with the same identity', async () => {
      const params = {
        kind: 'agent' as const,
        cwd: fixture.repo,
        cols: 80,
        rows: 24,
        config: {
          agentId: 'codex' as const,
          vendorAuth: {},
          vendorProject: {},
        },
      };
      const entry = await launchTerminalSession(params);
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      const first = JSON.parse(fixture.read('agent-start.json')) as {
        pid: number;
      };
      process.kill(first.pid, 'SIGTERM');
      await expect
        .poll(() => resolveSessionByName(entry.pty.name!)?.paneDead)
        .toBe(true);
      await expect.poll(() => entry.exited).toBe(true);
      rmSync(join(fixture.home, 'agent-start.json'));
      const resumed = await launchTerminalSession({
        ...params,
        name: entry.name,
        config: { ...params.config, agentId: 'claude' },
      });
      await expect
        .poll(() => existsSync(join(fixture.home, 'agent-start.json')))
        .toBe(true);
      const next = JSON.parse(fixture.read('agent-start.json'));
      expect(next.args).toEqual(['resume', '--last']);
      expect(next.pid).not.toBe(first.pid);
      expect(resumed.name).toBe(entry.name);
      expect(resumed.agent).toBe('codex');
      expect(resolveSessionByName(entry.pty.name!)?.paneDead).toBe(false);
    });

    it.each(['disappears', 'appears'] as const)(
      'uses the allocated name when another session %s before creation',
      async (change) => {
        if (change === 'disappears')
          fixture.tmux('new-session', '-d', '-s', 'shop-shell', 'sleep', '300');
        if (change === 'disappears')
          fixture.tmux('kill-session', '-t', '=shop-shell:');
        else {
          fixture.tmux('new-session', '-d', '-s', 'shop-shell', 'sleep', '300');
          for (const [key, value] of Object.entries(
            sessionTags(fixture.repo, { type: 'shell' })
          )) {
            tmuxSetOption('shop-shell', key, value);
          }
        }
        const expected =
          change === 'disappears' ? 'shop-shell' : 'shop-shell-2';
        const entry = await launchTerminalSession({
          kind: 'shell',
          cwd: fixture.repo,
          cols: 80,
          rows: 24,
          config: {} as AppConfig,
        });
        expect(entry.name).toBe(terminalSessionKey(expected));
        expect(entry.pty.name).toBe(expected);
        expect(getSession(terminalSessionKey(expected))).toBe(entry);
        expect(liveSessionNames()).toEqual([terminalSessionKey(expected)]);
        expect(resolveSessionByName(expected)).not.toBeNull();
        const delta = diffScans(
          null,
          {
            worktrees: [],
            persisted: new Set(),
            terminals: [
              {
                name: terminalSessionKey(expected),
                kind: 'shell',
                path: fixture.repo,
              },
            ],
          },
          isSessionAlive
        );
        expect(delta.adoptableTerminals).toEqual([]);
      }
    );
  }
);
