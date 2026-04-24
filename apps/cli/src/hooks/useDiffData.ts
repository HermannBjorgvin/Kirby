import { useState, useEffect, useCallback, useRef } from 'react';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { DiffFile } from '../types.js';
import {
  resolveRef,
  fetchDiffText,
  fetchFileDiffText,
} from '../utils/diff-fetcher.js';

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

async function fetchAllFiles(
  sourceBranch: string,
  targetBranch: string
): Promise<{ files: DiffFile[]; sourceRef: string; targetRef: string }> {
  // Try to fetch latest from remote (tolerate failures for branches
  // that already exist locally, e.g. via worktrees)
  await Promise.all([
    execFile('git', ['fetch', 'origin', sourceBranch], {
      timeout: 30_000,
    }).catch(() => {
      /* branch may already exist locally */
    }),
    execFile('git', ['fetch', 'origin', targetBranch], {
      timeout: 30_000,
    }).catch(() => {
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
  targetBranch: string
) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [fileDiffs, setFileDiffs] = useState<Map<string, string>>(new Map());
  const [fileDiffLoading, setFileDiffLoading] = useState<string | null>(null);
  const cacheRef = useRef<Map<number, FilesCacheEntry>>(new Map());
  const diffCacheRef = useRef<Map<number, string>>(new Map());
  // Per-file diff cache keyed by `${prNumber}:${filename}` so reopening
  // a file after switching back from the list is instant.
  const fileDiffCacheRef = useRef<Map<string, string>>(new Map());

  const loadFiles = useCallback(async () => {
    if (!prNumber || !sourceBranch || !targetBranch) return;

    const cached = cacheRef.current.get(prNumber);
    if (cached) {
      setFiles(cached.files);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchAllFiles(sourceBranch, targetBranch);
      cacheRef.current.set(prNumber, result);
      setFiles(result.files);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [prNumber, sourceBranch, targetBranch]);

  const loadDiffText = useCallback(async () => {
    if (!prNumber || !sourceBranch || !targetBranch) return;

    const cached = diffCacheRef.current.get(prNumber);
    if (cached) {
      setDiffText(cached);
      setDiffLoading(false);
      return;
    }

    // Reuse refs resolved by loadFiles if available — saves two
    // `git rev-parse --verify` execs per PR open.
    const entry = cacheRef.current.get(prNumber);
    const preResolved = entry
      ? { sourceRef: entry.sourceRef, targetRef: entry.targetRef }
      : undefined;

    setDiffLoading(true);
    try {
      const text = await fetchDiffText(sourceBranch, targetBranch, preResolved);
      diffCacheRef.current.set(prNumber, text);
      setDiffText(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setDiffLoading(false);
    }
  }, [prNumber, sourceBranch, targetBranch]);

  // Auto-load files when prNumber changes.
  useEffect(() => {
    if (prNumber) {
      loadFiles();
    } else {
      setFiles([]);
      setDiffText(null);
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
      if (!prNumber || !sourceBranch || !targetBranch || !filename) return;
      const key = `${prNumber}:${filename}`;
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

      const entry = cacheRef.current.get(prNumber);
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
    [prNumber, sourceBranch, targetBranch]
  );

  return {
    files,
    loading,
    error,
    diffText,
    diffLoading,
    fileDiffs,
    fileDiffLoading,
    loadDiffText,
    loadFiles,
    loadFileDiff,
  };
}
