import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { createTestRepo, cleanupTestRepo } from './setup/git-repo.js';

// Exercise the real host and node-pty exit event. A delayed shutdown write
// makes acknowledgement-before-exit observable without racing filesystem rm.
test('host kill waits for the PTY to finish its final HOME write', async ({
  fixtureHome,
  baseURL,
}) => {
  const repoPath = createTestRepo();
  const preload = join(fixtureHome, 'shutdown-hook.mjs');
  const marker = join(fixtureHome, 'shutdown-complete');
  await writeFile(
    preload,
    `
    import { writeFileSync } from 'node:fs';
    process.on('SIGHUP', () => setTimeout(() => {
      writeFileSync(${JSON.stringify(marker)}, 'complete');
      process.exit(0);
    }, 150));
    process.stdout.write('shutdown-hook-ready');
  `
  );
  const host = baseURL;
  try {
    const spawned = await fetch(`${host}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoPath,
        homeDir: fixtureHome,
        env: { NODE_OPTIONS: `--import=${preload}` },
      }),
    });
    expect(spawned.ok).toBe(true);
    await expect
      .poll(async () => {
        const response = await fetch(`${host}/output`);
        const { base64 } = (await response.json()) as { base64: string };
        return Buffer.from(base64, 'base64').toString();
      })
      .toContain('shutdown-hook-ready');
    const stopped = await fetch(`${host}/kill`, { method: 'POST' });
    expect(stopped.ok).toBe(true);
    expect(await readFile(marker, 'utf8')).toBe('complete');
    expect(await (await fetch(`${host}/status`)).json()).toMatchObject({
      ptyAlive: false,
    });
  } finally {
    await fetch(`${host}/kill`, { method: 'POST' });
    // Also finish safely when proving the regression against the old host.
    await expect
      .poll(() => readFile(marker, 'utf8').catch(() => ''))
      .toBe('complete');
    cleanupTestRepo(repoPath);
  }
});
