import { mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kirby-e2e-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@kirby.dev"', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby Test"', { cwd: dir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "initial"', {
    cwd: dir,
    stdio: 'pipe',
  });
  return dir;
}

export function cleanupTestRepo(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
