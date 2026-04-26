import { useState, useEffect, useCallback, useRef } from 'react';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { DiffFile } from '../types.js';
import { resolveRef, fetchFileDiffText } from '../utils/diff-fetcher.js';
import { beginOp } from './useAsyncOperation.js';

const execFile = promisify(execFileCb);

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

export async function fetchAllFiles(
  sourceBranch: string,
  targetBranch: string,
  expectedSourceSha: string | undefined
): Promise<{ files: DiffFile[]; sourceRef: string; targetRef: string }> {
  // Source: skip the network round-trip when local `origin/<source>`
  // already matches the PR's reported head SHA. Falls through to
  // `git fetch` when the SHA is unknown, the local ref is missing,
  // or the local ref is behind.
  const localSourceSha = await localRefSha(`origin/${sourceBranch}`);
  const sourceFresh =
    !!expectedSourceSha && localSourceSha === expectedSourceSha;

  // Target: no head SHA available, so use a TTL. First fetch per
  // target per process always runs; later opens within the window
  // skip it.
  const lastTargetFetch = targetFetchedAt.get(targetBranch) ?? 0;
  const targetFresh = Date.now() - lastTargetFetch < TARGET_FETCH_TTL_MS;

  await Promise.all([
    sourceFresh
      ? Promise.resolve()
      : execFile('git', ['fetch', 'origin', sourceBranch], {
          timeout: 30_000,
        }).catch(() => {
          /* branch may already exist locally */
        }),
    targetFresh
      ? Promise.resolve()
      : execFile('git', ['fetch', 'origin', targetBranch], {
          timeout: 30_000,
        })
          .then(() => {
            targetFetchedAt.set(targetBranch, Date.now());
          })
          .catch(() => {
            /* branch may already exist locally */
          }),
  ]);

  const [sourceRef, targetRef] = await Promise.all([
    resolveRef(sourceBranch),
    resolveRef(targetBranch),
  ]);

  // Get additions/deletions per file (binary files show - - for stats)
  const { stdout: numstatOut } = await execFile(
    'git',
    ['diff', '--numstat', `${targetRef}...${sourceRef}`],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  // Get status letter per file
  const { stdout: nameStatusOut } = await execFile(
    'git',
    ['diff', '--name-status', `${targetRef}...${sourceRef}`],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  // Parse --numstat: "<added>\t<deleted>\t<file>" or "-\t-\t<file>" for binary
  const numstatMap = new Map<
    string,
    { additions: number; deletions: number; binary: boolean }
  >();
  for (const line of numstatOut.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const isBinary = parts[0] === '-' && parts[1] === '-';
    // For renames: "old => new" or "{old => new}" path
    const filename = parts.slice(2).join('\t');
    numstatMap.set(filename, {
      additions: isBinary ? 0 : Number(parts[0]),
      deletions: isBinary ? 0 : Number(parts[1]),
      binary: isBinary,
    });
  }

  // Parse --name-status: "<status>\t<file>" or "<status>\t<old>\t<new>" for renames
  const files: DiffFile[] = [];
  for (const line of nameStatusOut.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const statusLetter = parts[0];
    const status = mapNameStatus(statusLetter);

    let filename: string;
    let previousFilename: string | undefined;

    if (statusLetter.startsWith('R') || statusLetter.startsWith('C')) {
      // Rename/copy: status\told\tnew
      previousFilename = parts[1];
      filename = parts[2];
    } else {
      filename = parts[1];
    }

    // Look up numstat by filename (for renames, numstat uses "old => new" format)
    // Try exact match first, then search for a line containing the filename
    let stats = numstatMap.get(filename);
    if (!stats) {
      for (const [key, val] of numstatMap) {
        if (
          key.includes(filename) ||
          (previousFilename && key.includes(previousFilename))
        ) {
          stats = val;
          break;
        }
      }
    }

    files.push({
      filename,
      status,
      additions: stats?.additions ?? 0,
      deletions: stats?.deletions ?? 0,
      binary: stats?.binary ?? false,
      previousFilename,
    });
  }

  return { files, sourceRef, targetRef };
}

interface FilesCacheEntry {
  files: DiffFile[];
  sourceRef: string;
  targetRef: string;
}

export function useDiffData(
  prNumber: number | null,
  sourceBranch: string,
  targetBranch: string,
  headSha: string | undefined
) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileDiffs, setFileDiffs] = useState<Map<string, string>>(new Map());
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

  // Auto-load files when prNumber or headSha changes.
  useEffect(() => {
    if (prNumber) {
      loadFiles();
    } else {
      setFiles([]);
      setFileDiffs(new Map());
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
