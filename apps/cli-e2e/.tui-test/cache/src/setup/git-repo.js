//# hash=5b2cb8ffafefcf1d5085c5db0a4039f5
//# sourceMappingURL=git-repo.js.map

import { mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export function createTestRepo() {
  var dir = mkdtempSync(join(tmpdir(), 'kirby-e2e-'));
  execSync('git init', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git config user.email "test@kirby.dev"', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby Test"', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git commit --allow-empty -m "initial"', {
    cwd: dir,
    stdio: 'pipe',
  });
  return dir;
}
export function cleanupTestRepo(dir) {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  } catch (unused) {
    /* best effort */
  }
}
