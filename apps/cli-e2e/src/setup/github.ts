import { execSync } from 'node:child_process';

/**
 * Create a local branch, make an empty commit, and push to origin.
 */
export function createTestBranch(repoDir: string, branchName: string): void {
  execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'pipe' });
  execSync(`git commit --allow-empty -m "e2e test branch: ${branchName}"`, {
    cwd: repoDir,
    stdio: 'pipe',
  });
  execSync(`git push -u origin ${branchName}`, {
    cwd: repoDir,
    stdio: 'pipe',
  });
}

/**
 * Create a PR via gh CLI. Returns the PR number.
 */
export function createPullRequest(
  repoFullName: string,
  branchName: string,
  cwd: string
): number {
  const output = execSync(
    `gh pr create --repo ${repoFullName} --head ${branchName} --title "e2e: ${branchName}" --body "Automated e2e test PR"`,
    { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  // gh pr create prints the PR URL; extract number from it
  const match = output.trim().match(/\/pull\/(\d+)$/);
  if (match) return parseInt(match[1], 10);

  // Fallback: query for it
  const prNum = execSync(
    `gh pr view ${branchName} --repo ${repoFullName} --json number -q .number`,
    { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return parseInt(prNum.trim(), 10);
}

/**
 * Merge PR via gh CLI (merge commit strategy, no remote branch deletion).
 */
export function mergePullRequest(repoFullName: string, prNumber: number): void {
  execSync(`gh pr merge ${prNumber} --repo ${repoFullName} --merge --admin`, {
    stdio: 'pipe',
  });
}

/**
 * Close a PR (best-effort cleanup).
 */
export function closePullRequest(repoFullName: string, prNumber: number): void {
  try {
    execSync(`gh pr close ${prNumber} --repo ${repoFullName}`, {
      stdio: 'pipe',
    });
  } catch {
    /* best effort */
  }
}

/**
 * Delete a remote branch (best-effort cleanup).
 */
export function deleteRemoteBranch(
  repoFullName: string,
  branchName: string
): void {
  try {
    execSync(
      `gh api -X DELETE repos/${repoFullName}/git/refs/heads/${branchName}`,
      { stdio: 'pipe' }
    );
  } catch {
    /* best effort */
  }
}
