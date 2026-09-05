/**
 * One line for `git fetch`, per repository.
 *
 * Two loops fetch: the remote sync pass (`git fetch --all --prune`,
 * hourly) and every babysitter (its pull request's two refs, every few
 * minutes). Two fetches running at once in one repository contend for
 * the same ref locks and one of them fails with "cannot lock ref",
 * which the babysitter then reports as a merge check that could not
 * run. So every fetch goes through here, and fetches of one repository
 * run one after another.
 *
 * A fetch also remembers when it landed, so a caller that would accept
 * refs a few minutes old (`maxAgeMs`) is answered from the last fetch
 * of the same refs instead of starting another. The same refs, by
 * name: a `git fetch --all` that succeeded says nothing about a
 * particular branch — on a repository with no remote it succeeds
 * having fetched nothing, and a fetch of the branch would have failed
 * and said so. Only a fetch that succeeded is reused: a failure may
 * have been transient.
 */
import { fetchBranches, fetchRemote } from '@kirby/worktree-manager';

export interface FetchRequest {
  /** The repository to fetch in. */
  cwd: string;
  /** Which refs, or everything (`git fetch --all --prune`). */
  refs: readonly string[] | 'all';
  /** Accept a successful fetch of these refs no older than this
   *  rather than fetching again. Zero, the default, always fetches. */
  maxAgeMs?: number;
}

const ALL = '*';

interface RepoQueue {
  tail: Promise<unknown>;
  /** Ref-set key → when a fetch of it last succeeded. */
  fetchedAt: Map<string, number>;
}

const queues = new Map<string, RepoQueue>();

function queueFor(cwd: string): RepoQueue {
  let queue = queues.get(cwd);
  if (!queue) {
    queue = { tail: Promise.resolve(), fetchedAt: new Map() };
    queues.set(cwd, queue);
  }
  return queue;
}

function keyOf(refs: FetchRequest['refs']): string {
  return refs === 'all' ? ALL : [...refs].sort().join('\n');
}

async function run(queue: RepoQueue, req: FetchRequest): Promise<boolean> {
  const key = keyOf(req.refs);
  const maxAge = req.maxAgeMs ?? 0;
  const last = queue.fetchedAt.get(key) ?? -Infinity;
  if (maxAge > 0 && Date.now() - last < maxAge) return true;
  const ok =
    req.refs === 'all'
      ? await fetchRemote(req.cwd)
      : await fetchBranches([...req.refs], req.cwd);
  if (ok) queue.fetchedAt.set(key, Date.now());
  return ok;
}

/**
 * Fetch, after every fetch already queued for the repository. Resolves
 * to whether the fetch succeeded — never rejects, so a failure in one
 * caller's fetch cannot take the line down for the next.
 */
export function fetchRefs(req: FetchRequest): Promise<boolean> {
  const queue = queueFor(req.cwd);
  const job = queue.tail.then(
    () => run(queue, req),
    () => run(queue, req)
  );
  queue.tail = job.catch(() => false);
  return job.catch(() => false);
}

/** Test hook: forget every queue and every fetch time. */
export function __resetFetchQueueForTests(): void {
  queues.clear();
}
