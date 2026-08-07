import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── A dockerized beam host for e2e tests ───────────────────────────
//
// The container plays Hermann's desktop: sshd + tmux + git, reachable
// over real ssh with a throwaway keypair. Kirby on the outside talks
// to it through the real beam CLI (Kristján's checkout, run via bun),
// wired in with two PATH shims:
//
//   ssh  → the system ssh forced onto a test-owned config, because
//          OpenSSH resolves the user config from the passwd database,
//          so a fake HOME cannot redirect it
//   beam → bun <beam checkout>/src/beam.ts
//
// Everything the test needs from the environment is checked up front;
// when docker, bun or the beam checkout is missing the suite skips.

const DOCKER_CONTEXT = fileURLToPath(
  new URL('../fixtures/beam-host', import.meta.url)
);
const IMAGE = 'kirby-beam-e2e:latest';
const CONTAINER = `kirby-beam-e2e-${process.pid}`;
const SSH_ALIAS = 'kirby-beam-e2e-host';

/** The beam checkout the test drives. Override with BEAM_REPO. */
export function beamRepoPath(): string {
  return (
    process.env.BEAM_REPO ??
    join(homedir(), 'Documents', 'Code', 'Personal', 'beam')
  );
}

function has(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return r.status === 0;
}

/** Why the beam e2e suite cannot run here, or null when it can. */
export function beamHostUnavailableReason(): string | null {
  if (!has('docker', ['info'])) return 'docker is not available';
  if (!has('bun', ['--version'])) return 'bun is not installed';
  if (!existsSync(join(beamRepoPath(), 'src', 'beam.ts'))) {
    return `no beam checkout at ${beamRepoPath()} (set BEAM_REPO)`;
  }
  return null;
}

export interface BeamHost {
  /** Name of the beam remote registered for the container. */
  remote: string;
  /** Path of the fixture repo inside the container. */
  repoPath: string;
  /** Environment for the Kirby spawn: PATH with the shims first, and
   *  the test-owned beam config. */
  env: Record<string, string>;
  /** Run a shell script inside the container; throws on failure. */
  exec(script: string): string;
  /** tmux session names currently live in the container. */
  sessions(): string[];
  stop(): void;
}

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

/**
 * Build and start the container, install a throwaway key, prepare the
 * fixture repo, and write the ssh/beam shims + beam config. Costs a
 * few seconds warm, longer on the first image build.
 */
export function startBeamHost(): BeamHost {
  // Short base path: tmux socket paths must fit in a sockaddr_un.
  const root = mkdtempSync('/tmp/kirby-beam-e2e-');
  const bin = join(root, 'bin');
  const beamCfg = join(root, 'beam');
  mkdirSync(bin, { recursive: true });
  mkdirSync(beamCfg, { recursive: true });

  sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(root, 'id')]);
  sh('docker', ['build', '-q', '-t', IMAGE, DOCKER_CONTEXT]);
  sh('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER,
    '-p',
    '127.0.0.1::22',
    IMAGE,
  ]);

  const cleanup = () => {
    spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
    rmSync(root, { recursive: true, force: true });
  };

  try {
    const portLine = sh('docker', ['port', CONTAINER, '22']).trim();
    const port = portLine.split('\n')[0]?.split(':').pop();
    if (!port) throw new Error(`could not read container port: ${portLine}`);

    const pubkey = sh('cat', [join(root, 'id.pub')]);
    execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'sh', '-c', 'cat > /root/.ssh/authorized_keys'],
      { input: pubkey }
    );

    writeFileSync(
      join(root, 'ssh_config'),
      [
        `Host ${SSH_ALIAS}`,
        '  HostName 127.0.0.1',
        `  Port ${port}`,
        '  User root',
        `  IdentityFile ${join(root, 'id')}`,
        '  IdentitiesOnly yes',
        '  StrictHostKeyChecking no',
        '  UserKnownHostsFile /dev/null',
        '  LogLevel ERROR',
        '',
      ].join('\n')
    );

    const sshShim = join(bin, 'ssh');
    writeFileSync(
      sshShim,
      `#!/bin/sh\nexec /usr/bin/ssh -F ${join(root, 'ssh_config')} "$@"\n`
    );
    chmodSync(sshShim, 0o755);

    const beamShim = join(bin, 'beam');
    writeFileSync(
      beamShim,
      `#!/bin/sh\nexec bun '${join(beamRepoPath(), 'src', 'beam.ts')}' "$@"\n`
    );
    chmodSync(beamShim, 0o755);

    writeFileSync(
      join(beamCfg, 'config.json'),
      JSON.stringify(
        {
          remotes: {
            desktop: { host: SSH_ALIAS, ip: '127.44.0.99' },
          },
        },
        null,
        2
      ) + '\n'
    );

    const exec = (script: string) =>
      sh('docker', ['exec', CONTAINER, 'sh', '-c', script]);

    // Wait for sshd through the shim, proving the whole chain.
    const deadline = Date.now() + 60_000;
    for (;;) {
      const probe = spawnSync(
        sshShim,
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=2', SSH_ALIAS, 'true'],
        { stdio: 'ignore' }
      );
      if (probe.status === 0) break;
      if (Date.now() > deadline) throw new Error('sshd never became reachable');
      execFileSync('sleep', ['0.4']);
    }

    const repoPath = '/root/fixture';
    exec(
      [
        `mkdir -p ${repoPath}`,
        `cd ${repoPath}`,
        'git init -q -b main',
        'git config user.email t@t',
        'git config user.name t',
        'echo hello > readme.txt',
        'git add readme.txt',
        'git commit -qm init',
      ].join(' && ')
    );

    return {
      remote: 'desktop',
      repoPath,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        BEAM_CONFIG_DIR: beamCfg,
      },
      exec,
      sessions: () => {
        const r = spawnSync(
          'docker',
          ['exec', CONTAINER, 'tmux', 'ls', '-F', '#{session_name}'],
          { encoding: 'utf8' }
        );
        if (r.status !== 0) return [];
        return r.stdout.trim().split('\n').filter(Boolean);
      },
      stop: cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}
