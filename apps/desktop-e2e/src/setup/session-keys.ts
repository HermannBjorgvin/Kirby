import type { Page } from '@playwright/test';

/** Decode the branch for assertions while IPC always receives the opaque key. */
export function sessionBranch(key: string): string {
  const [kind, , branch] = JSON.parse(key) as string[];
  if (kind !== 'worktree' || !branch)
    throw new Error(`Not a worktree key: ${key}`);
  return branch;
}

export async function sessionKey(page: Page, branch: string): Promise<string> {
  const sessions = await page.evaluate(() => window.kirby.listSessions());
  const session = sessions.find((s) => sessionBranch(s.name) === branch);
  if (!session) throw new Error(`No session for ${branch}`);
  return session.name;
}
