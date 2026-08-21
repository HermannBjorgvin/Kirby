import {
  listWorktrees as listWts,
  listBranches as listBr,
  createWorktree as createWt,
  removeWorktree as removeWt,
  canRemoveBranch as canRemoveBr,
} from '@kirby/worktree-manager';
import { requireRepo } from './repo.js';

// All worktree-manager functions resolve paths against process.cwd();
// openRepo() chdir'd into the active repo, so these are repo-scoped.

export function listWorktrees() {
  requireRepo();
  return listWts();
}

export function listBranches() {
  requireRepo();
  return listBr();
}

export function createWorktree(branch: string) {
  requireRepo();
  return createWt(branch);
}

export function removeWorktree(
  branch: string,
  force: boolean
): Promise<boolean> {
  requireRepo();
  return removeWt(branch, { force });
}

export function canRemoveBranch(branch: string) {
  requireRepo();
  return canRemoveBr(branch);
}
