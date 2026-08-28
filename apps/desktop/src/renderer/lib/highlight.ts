import { useCallback, useMemo } from 'react';
import {
  queryOptions,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { DiffLine } from '@kirby/diff';
import type { CharRange } from './diff-model.js';
import {
  analyzeFileInWorker,
  tokenizeCodeInWorker,
  type FileAnalysis,
  type LineTokens,
} from './diff-worker-client.js';
import { keys } from './queries.js';
import type { ResolvedTheme } from './theme.js';

export type { LineTokens };

const EMPTY: FileAnalysis = { tokens: null, wordRanges: new Map() };

/**
 * Identity token for a DiffLine[] instance, so a worker result can be
 * cached under a key that is cheap to compute yet never collides.
 *
 * Content hashing would be O(file) on the render path, and keying on
 * `lines.length` would let two same-length snippets of one file share
 * (wrong) tokens. Arrays here come from the parsed diff and are
 * memoized by their producers, so identity is both stable across
 * scrolling and distinct whenever the content is.
 */
const lineIds = new WeakMap<readonly DiffLine[], number>();
let nextLineId = 1;

export function linesId(lines: readonly DiffLine[]): number {
  let id = lineIds.get(lines);
  if (id === undefined) {
    id = nextLineId++;
    lineIds.set(lines, id);
  }
  return id;
}

/**
 * Query options for one file's worker analysis (shiki tokens +
 * intra-line word-diff ranges).
 *
 * `staleTime: Infinity` because the worker is a pure function of the
 * key: nothing it returns can go stale, so a file scrolled out of view
 * and back renders highlighted from cache with no second round trip.
 * Structural sharing is off — token arrays are large, never partially
 * change, and there is no refetch for it to diff against.
 */
export function fileAnalysisQuery(
  filename: string,
  lines: DiffLine[],
  theme: ResolvedTheme
) {
  return queryOptions({
    queryKey: keys.fileAnalysis(filename, linesId(lines), theme),
    queryFn: () => analyzeFileInWorker(filename, lines, theme),
    staleTime: Infinity,
    retry: false,
    structuralSharing: false,
  });
}

/** Query options for a fenced code block in comment markdown. */
export function codeTokensQuery(
  code: string,
  tag: string,
  theme: ResolvedTheme
) {
  return queryOptions({
    queryKey: keys.codeTokens(tag, theme, code),
    queryFn: () => tokenizeCodeInWorker(code, tag, theme),
    staleTime: Infinity,
    retry: false,
    structuralSharing: false,
  });
}

/**
 * Tokens + intra-line word-diff ranges for one file's diff, computed
 * in the diff worker so the UI thread never blocks on shiki or the
 * pairwise word diffs. Returns nulls/empties until ready.
 */
export function useFileAnalysis(
  filename: string,
  lines: DiffLine[],
  theme: ResolvedTheme,
  enabled = true
): FileAnalysis {
  const options = useMemo(
    () => fileAnalysisQuery(filename, lines, theme),
    [filename, lines, theme]
  );
  const { data } = useQuery({
    ...options,
    enabled: enabled && lines.length > 0,
  });
  return enabled ? data ?? EMPTY : EMPTY;
}

const WANTED_SEP = '\0';

/**
 * The set of on-screen files that actually have diff lines, flattened
 * to one order-independent string.
 *
 * The virtualizer hands `useFileAnalyses` a fresh Set on every scroll
 * frame, so this is what keeps the query list from being rebuilt when
 * the same files are still on screen. NUL can't appear in a git path.
 */
export function wantedFilesKey(
  files: ReadonlyMap<string, DiffLine[]>,
  wanted: ReadonlySet<string>
): string {
  const names: string[] = [];
  for (const file of wanted) {
    if ((files.get(file)?.length ?? 0) > 0) names.push(file);
  }
  return names.sort().join(WANTED_SEP);
}

/**
 * On-demand per-file analyses for the virtualized diff: a file's
 * tokens + word-diff ranges are requested (once) when it first shows
 * up in `wanted` — i.e. when one of its rows scrolls into view — and
 * rows render plain until the worker answers. A new diff or theme
 * invalidates everything, because both are part of every key.
 */
export function useFileAnalyses(
  files: ReadonlyMap<string, DiffLine[]>,
  theme: ResolvedTheme,
  wanted: ReadonlySet<string>
): ReadonlyMap<string, FileAnalysis> {
  const wantedKey = useMemo(
    () => wantedFilesKey(files, wanted),
    [files, wanted]
  );

  // names and queries are built together so their indices always line
  // up — `combine` reads file names out of `names` by position.
  const { names, queries } = useMemo(() => {
    const names: string[] = [];
    const queries: ReturnType<typeof fileAnalysisQuery>[] = [];
    const wantedNames = wantedKey === '' ? [] : wantedKey.split(WANTED_SEP);
    for (const file of wantedNames) {
      const lines = files.get(file);
      if (!lines || lines.length === 0) continue;
      names.push(file);
      queries.push(fileAnalysisQuery(file, lines, theme));
    }
    return { names, queries };
  }, [wantedKey, files, theme]);

  const combine = useCallback(
    (
      results: UseQueryResult<FileAnalysis>[]
    ): ReadonlyMap<string, FileAnalysis> => {
      const out = new Map<string, FileAnalysis>();
      results.forEach((result, i) => {
        // Absent = still working, or the worker failed: highlights
        // degrade to plain text either way.
        if (result.data) out.set(names[i], result.data);
      });
      return out;
    },
    [names]
  );

  return useQueries({ queries, combine });
}

/** Worker-tokenized fenced code block (comment markdown). */
export function useHighlightedCodeBlock(
  code: string,
  tag: string | undefined,
  theme: ResolvedTheme
): LineTokens[] | null {
  const { data } = useQuery({
    ...codeTokensQuery(code, tag ?? '', theme),
    enabled: !!tag,
  });
  return tag ? data ?? null : null;
}

export type { CharRange };
