import { useState, useEffect, useCallback, useRef } from 'react';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { DiffFile } from '@kirby/core';
import { resolveRef, fetchFileDiffText } from '@kirby/core';
import { beginOp } from './useAsyncOperation.js';

const execFile = promisify(execFileCb);

/**
 * Environment variables that prevent git/SSH from prompting for auth.
 * Mirrors the same constant in @kirby/worktree-manager's exec.ts.
 */
const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
};

function mapNameStatus(letter: string): DiffFile['status'] {
  const code = letter.charAt(0);
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'removed';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'changed';
    default:
      return 'modified';
  }
}

// 5 min — target branches (typically `main`) move slowly and a small
// staleness window is acceptable for diff display. The compare ref
// is still `targetRef...sourceRef`, so a slightly old base just shifts
// the diff line range, doesn't break correctness.
const TARGET_FETCH_TTL_MS = 5 * 60 * 1000;
const targetFetchedAt = new Map<string, number>();

async function localRefSha(ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--verify', ref]);
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Test-only: drop the target-fetch TTL bookkeeping so each spec
 *  starts from a clean slate. The map is module-level (intentionally
 *  process-scoped so warm opens stay warm across MainTabBody remounts),
 *  which means tests would otherwise leak state between cases.  */
export function __resetTargetFetchTtlForTest(): void {
  targetFetchedAt.clear();
}

function fetchBranch(branch: string): Promise<unknown> {
  return execFile('git', ['fetch', 'origin', branch], {
    timeout: 30_000,
    env: { ...process.env, ...GIT_NO_PROMPT_ENV },
  });
}

/**
 * Bring both sides' `origin/` refs up to date, skipping the network wherever
 * freshness can already be established.
 *
 * The two sides get different evidence. The source has a head SHA from the
 * PR, so a matching local ref proves it is current. The target has none, so
 * it falls back to a TTL — the first open per target per process always
 * fetches, later ones inside the window do not.
 *
 * A failed fetch is deliberately not fatal: the branch may already exist
 * locally, and it is `resolveRef` that actually has to succeed. The target's
 * timestamp is only recorded on success, so a failed fetch is retried rather
 * than papered over for the length of the TTL.
 */
async function ensureBranchesFetched(
  sourceBranch: string,
  targetBranch: string,
  expectedSourceSha: string | undefined
): Promise<void> {
  const localSourceSha = await localRefSha(`origin/${sourceBranch}`);
  const sourceFresh =
    !!expectedSourceSha && localSourceSha === expectedSourceSha;

  const lastTargetFetch = targetFetchedAt.get(targetBranch) ?? 0;
  const targetFresh = Date.now() - lastTargetFetch < TARGET_FETCH_TTL_MS;

  await Promise.all([
    sourceFresh
      ? Promise.resolve()
      : fetchBranch(sourceBranch).catch(() => {
          /* branch may already exist locally */
        }),
    targetFresh
      ? Promise.resolve()
      : fetchBranch(targetBranch)
          .then(() => {
            targetFetchedAt.set(targetBranch, Date.now());
          })
          .catch(() => {
            /* branch may already exist locally */
          }),
  ]);
}

interface NumstatEntry {
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Parse `git diff --numstat`: "<added>\t<deleted>\t<file>", or "-\t-\t<file>"
 * for a binary file, which has no line counts to report.
 */
function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const entries = new Map<string, NumstatEntry>();
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const binary = parts[0] === '-' && parts[1] === '-';
    // A path may itself contain tabs, so it is everything past the counts.
    const filename = parts.slice(2).join('\t');
    entries.set(filename, {
      additions: binary ? 0 : Number(parts[0]),
      deletions: binary ? 0 : Number(parts[1]),
      binary,
    });
  }
  return entries;
}

/**
 * numstat keys a rename by git's combined "old => new" path while
 * name-status reports the two sides separately, so an exact lookup misses
 * and we fall back to the first entry that mentions either side.
 */
function lookupStats(
  entries: Map<string, NumstatEntry>,
  filename: string,
  previousFilename: string | undefined
): NumstatEntry | undefined {
  const exact = entries.get(filename);
  if (exact) return exact;

  for (const [key, val] of entries) {
    if (
      key.includes(filename) ||
      (previousFilename && key.includes(previousFilename))
    ) {
      return val;
    }
  }
  return undefined;
}

/**
 * Where a `--name-status` line's path fields are. A rename or copy carries
 * both the old and new path; every other status carries one.
 */
function splitPaths(parts: string[]): {
  filename: string;
  previousFilename: string | undefined;
} {
  const statusLetter = parts[0];
  if (statusLetter.startsWith('R') || statusLetter.startsWith('C')) {
    return { filename: parts[2], previousFilename: parts[1] };
  }
  return { filename: parts[1], previousFilename: undefined };
}

/** Join `git diff --name-status` output against the per-file numstat. */
function toDiffFiles(
  stdout: string,
  entries: Map<string, NumstatEntry>
): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const { filename, previousFilename } = splitPaths(parts);
    const stats = lookupStats(entries, filename, previousFilename);

    files.push({
      filename,
      status: mapNameStatus(parts[0]),
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
      binary: stats?.binary ?? false,
      previousFilename,
    });
  }
  return files;
}

export async function fetchAllFiles(
  sourceBranch: string,
  targetBranch: string,
  expectedSourceSha: string | undefined
): Promise<{ files: DiffFile[]; sourceRef: string; targetRef: string }> {
  await ensureBranchesFetched(sourceBranch, targetBranch, expectedSourceSha);

  const [sourceRef, targetRef] = await Promise.all([
    resolveRef(sourceBranch),
    resolveRef(targetBranch),
  ]);

  // Two views of the same diff: numstat carries the line counts, name-status
  // the status letter and the rename pairing. Neither has both.
  const range = `${targetRef}...${sourceRef}`;
  const { stdout: numstatOut } = await execFile(
    'git',
    ['diff', '--numstat', range],
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const { stdout: nameStatusOut } = await execFile(
    'git',
    ['diff', '--name-status', range],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  const files = toDiffFiles(nameStatusOut, parseNumstat(numstatOut));

  return { files, sourceRef, targetRef };
}

interface FilesCacheEntry {
  files: DiffFile[];
  sourceRef: string;
  targetRef: string;
}

// Returned whenever no PR is selected. Module-level so the identity is
// stable across renders — consumers (and the containers' memo deps)
// would otherwise see a "new" empty list on every render. Neither is
// ever mutated: every update below builds a fresh value.
const NO_FILES: DiffFile[] = [];
const NO_FILE_DIFFS = new Map<string, string>();

export function useDiffData(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  // `loadedFiles` / `loadedFileDiffs` hold whatever the last load
  // produced. What the caller sees is derived from `prNumber` below —
  // see the `files` / `fileDiffs` bindings.
  const [loadedFiles, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFileDiffs, setFileDiffs] = useState<Map<string, string>>(
    new Map()
  );
  const [fileDiffLoading, setFileDiffLoading] = useState<string | null>(null);
  // Caches scoped to the current mount — MainTabBody remounts on every
  // sidebar-item switch, which is intentional: switching to another
  // worktree/PR should re-check freshness. Within a single mount,
  // navigating between files of the same PR stays instant.
  //
  // Keys include `headSha` so a force-push or new commit during the
  // mount naturally invalidates. `unknown` falls back to
  // PR-number-only behaviour when the provider didn't give us a head
  // SHA (some ADO edge cases).
  const filesCacheRef = useRef<Map<string, FilesCacheEntry>>(new Map());
  const fileDiffCacheRef = useRef<Map<string, string>>(new Map());
  const cacheKey = prNumber ? `${prNumber}:${headSha ?? 'unknown'}` : null;

  const loadFiles = useCallback(async () => {
    if (!prNumber || !sourceBranch || !targetBranch || !cacheKey) return;

    const cached = filesCacheRef.current.get(cacheKey);
    if (cached) {
      setFiles(cached.files);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const endOp = beginOp('load-pr-files');
    try {
      const result = await fetchAllFiles(sourceBranch, targetBranch, headSha);
      filesCacheRef.current.set(cacheKey, result);
      setFiles(result.files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      endOp();
      setLoading(false);
    }
  }, [prNumber, sourceBranch, targetBranch, headSha, cacheKey]);

  // "No PR selected" is not a state the hook has to be walked into —
  // it's a property of the argument. Deriving it here rather than
  // having an effect write emptiness into state means the empty view
  // is correct on the very first render, with no intermediate commit
  // showing the previous PR's files. The loaded state stays put and is
  // simply not read.
  const files = prNumber ? loadedFiles : NO_FILES;
  const fileDiffs = prNumber ? loadedFileDiffs : NO_FILE_DIFFS;

  // Auto-load files when prNumber or headSha changes. A fetch is the
  // one thing here that genuinely needs an effect.
  useEffect(() => {
    if (prNumber) {
      loadFiles();
    }
  }, [prNumber, loadFiles]);

  // Fetch a single file's diff on demand. Cached per (prNumber, filename)
  // so revisiting a file is instant. Replaces the old whole-PR prefetch:
  // `git diff -U99999` across a 30-file PR produces multi-megabyte output
  // that blocked the viewer for seconds; scoping to one file keeps it
  // sub-100 ms.
  const loadFileDiff = useCallback(
    async (filename: string) => {
      if (!prNumber || !sourceBranch || !targetBranch || !filename || !cacheKey)
        return;
      const key = `${cacheKey}:${filename}`;
      const cached = fileDiffCacheRef.current.get(key);
      if (cached !== undefined) {
        setFileDiffs((prev) => {
          if (prev.get(filename) === cached) return prev;
          const next = new Map(prev);
          next.set(filename, cached);
          return next;
        });
        return;
      }

      const entry = filesCacheRef.current.get(cacheKey);
      const preResolved = entry
        ? { sourceRef: entry.sourceRef, targetRef: entry.targetRef }
        : undefined;

      setFileDiffLoading(filename);
      try {
        const text = await fetchFileDiffText(
          sourceBranch,
          targetBranch,
          filename,
          preResolved
        );
        fileDiffCacheRef.current.set(key, text);
        setFileDiffs((prev) => {
          const next = new Map(prev);
          next.set(filename, text);
          return next;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setFileDiffLoading((cur) => (cur === filename ? null : cur));
      }
    },
    [prNumber, sourceBranch, targetBranch, cacheKey]
  );

  return {
    files,
    loading,
    error,
    fileDiffs,
    fileDiffLoading,
    loadFiles,
    loadFileDiff,
  };
}
