import { useCallback, useMemo } from 'react';
import {
  queryOptions,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { DiffLine } from '@kirby/diff';
import { contentKey } from './content-key.js';
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
 * The worker's answer for a line is a pure function of its `type` and
 * `content` — shiki tokenizes the joined contents, and the word-diff
 * pairs removes with adds by type. Line numbers steer neither, so they
 * stay out of the key and two identical snippets share one analysis.
 *
 * NUL separates, and appears in neither a type nor a line of a text
 * diff (git calls a file with one binary and stops emitting lines).
 */
function linesContent(lines: readonly DiffLine[]): string {
  const parts = new Array<string>(lines.length);
  for (let i = 0; i < lines.length; i++) {
    parts[i] = `${lines[i].type}\0${lines[i].content}`;
  }
  return parts.join('\0');
}

/**
 * Content key for a DiffLine[], memoized on the array instance.
 *
 * Identity alone does not work. It is stable on the virtualized path,
 * where `linesByFile` is memoized, but not in the review walkthrough:
 * `ReviewStepper` calls `snippetAround` inline in its JSX, `StepCard`
 * is not memoized, and `SnippetView` maps `rows` to `lines` — so every
 * render mints a fresh array of the same seven lines, and an identity
 * key would re-tokenize each time. That re-tokenizing is the thing the
 * worker exists to avoid.
 *
 * Content alone does not work either, at whole-file sizes. Measured
 * here (node 22), serializing and hashing a `DiffLine[]`:
 *
 * |     lines |   text | linesContent + contentKey |
 * | --------- | ------ | ------------------------- |
 * |         7 |  <1 KB | 0.004 ms                  |
 * |       500 |  31 KB | 0.07 ms                   |
 * |     3 000 | 191 KB | 0.49 ms                   |
 * |    20 000 | 1.3 MB | 4.13 ms                   |
 * |    60 000 | 3.9 MB | 12.34 ms                  |
 *
 * Whole-file diffs (`-U99999`) reach the bottom rows, and paying that
 * on every scroll frame would be worse than the bug.
 *
 * So: hash the content, and memoize the hash on the array. The two
 * paths then each get what they need from a different half. Big arrays
 * are memoized by their producer, so the hash is paid once per parse,
 * for the files actually on screen, and a scroll frame is a WeakMap
 * hit (~0 ms). Snippet arrays miss the WeakMap every render — and it
 * does not matter, because 0.004 ms later they produce *the same key*
 * as the render before.
 *
 * The key has to be a short string either way: TanStack re-runs
 * `JSON.stringify` over a query key on every render of every observer,
 * which is 0.0002 ms for this and 5.6 ms for a raw 20 000-line array.
 */
const lineKeys = new WeakMap<readonly DiffLine[], string>();

export function linesKey(lines: readonly DiffLine[]): string {
  let key = lineKeys.get(lines);
  if (key === undefined) {
    key = contentKey(linesContent(lines));
    lineKeys.set(lines, key);
  }
  return key;
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
    queryKey: keys.fileAnalysis(filename, linesKey(lines), theme),
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
