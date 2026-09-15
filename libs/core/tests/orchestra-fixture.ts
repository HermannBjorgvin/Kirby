import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { killAll } from '../src/lib/pty-registry.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const archiveHash =
  '745ec2a22cfdd8b9548b50e2f42e9fba1544504541a5634c35b12789bdd0150e';

/** One plugin install, repository and tmux server per test. */
export function orchestraFixture() {
  const home = mkdtempSync(join(tmpdir(), 'kirby-orchestra-'));
  const repo = join(home, 'shop');
  const socketDir = join(home, 'tmux');
  const pluginDir = join(home, '.claude/plugins');
  const bin = join(home, 'bin');
  for (const dir of [repo, socketDir, pluginDir, bin])
    mkdirSync(dir, { recursive: true });
  const archive = readFileSync(join(fixtures, 'orchestra.tar.gz'));
  if (createHash('sha256').update(archive).digest('hex') !== archiveHash) {
    throw new Error('Orchestra fixture checksum mismatch');
  }
  execFileSync('tar', [
    '-xzf',
    join(fixtures, 'orchestra.tar.gz'),
    '-C',
    pluginDir,
  ]);
  for (const agent of ['codex', 'claude']) {
    writeFileSync(
      join(bin, agent),
      `#!${process.execPath}\n` +
        readFileSync(join(fixtures, 'fake-orchestra-agent.mjs')),
      { mode: 0o755 }
    );
  }
  writeFileSync(join(bin, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(
    join(home, '.tmux.conf'),
    'set-option -g default-shell /bin/sh\n'
  );
  vi.stubEnv('HOME', home);
  vi.stubEnv('TMUX_TMPDIR', socketDir);
  vi.stubEnv('TMUX', undefined);
  vi.stubEnv('TMUX_PANE', undefined);
  for (const key of [
    'ORCH_REPO',
    'ORCHESTRA_SESSION',
    'ORCHESTRA_SOCKET',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(home, '.gitconfig'));
  vi.stubEnv('XDG_CONFIG_HOME', join(home, '.config'));
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, {
      cwd: repo,
      encoding: 'utf8',
      timeout: 15_000,
    });
  const assertIsolated = () => {
    if (
      process.env.TMUX ||
      process.env.TMUX_TMPDIR !== socketDir ||
      process.env.HOME !== home
    )
      throw new Error('Unsafe tmux fixture environment');
  };
  const tmux = (...args: string[]) => {
    assertIsolated();
    return run('tmux', args).trim();
  };
  run('git', ['init', '-b', 'main']);
  run('git', [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  ]);
  tmux('new-session', '-d', '-s', 'fixture-anchor', 'sleep', '300');
  const scriptPath = (name: string) =>
    join(pluginDir, 'orchestra/skills/orchestrator/scripts', name);
  return {
    home,
    repo,
    plugin: join(pluginDir, 'orchestra'),
    tmux,
    script: (name: string, ...args: string[]) => {
      assertIsolated();
      return spawnSync('bash', [scriptPath(name), ...args], {
        cwd: repo,
        encoding: 'utf8',
        timeout: 15_000,
      });
    },
    read: (name: string) => readFileSync(join(home, name), 'utf8'),
    close: () => {
      killAll();
      // Only this fixture's server; the last individually killed session
      // shuts it down. Never kill-server, even on a scratch socket.
      for (const name of tmux('list-sessions', '-F', '#{session_name}').split(
        '\n'
      )) {
        tmux('kill-session', '-t', `=${name}:`);
      }
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
