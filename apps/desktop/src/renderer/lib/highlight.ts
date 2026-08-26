import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffLine } from '@kirby/diff';
import type { CharRange } from './diff-model.js';
import {
  analyzeFileInWorker,
  tokenizeCodeInWorker,
  type FileAnalysis,
  type LineTokens,
} from './diff-worker-client.js';
import type { ResolvedTheme } from './theme.js';

export type { LineTokens };

const EMPTY: FileAnalysis = { tokens: null, wordRanges: new Map() };

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
  const [result, setResult] = useState<{ key: string; value: FileAnalysis }>();
  const key = `${filename} ${theme} ${lines.length}`;

  useEffect(() => {
    if (!enabled || lines.length === 0) return;
    let cancelled = false;
    void analyzeFileInWorker(filename, lines, theme)
      .then((value) => {
        if (!cancelled) setResult({ key, value });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, value: EMPTY });
      });
    return () => {
      cancelled = true;
    };
    // key covers filename/theme/line-count; lines identity is stable
    // (memoized from the parsed diff).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, lines]);

  if (!enabled || !result || result.key !== key) return EMPTY;
  return result.value;
}

const EMPTY_MAP: ReadonlyMap<string, FileAnalysis> = new Map();

/**
 * On-demand per-file analyses for the virtualized diff: a file's
 * tokens + word-diff ranges are requested (once) when it first shows
 * up in `wanted` — i.e. when one of its rows scrolls into view — and
 * rows render plain until the worker answers. A new diff or theme
 * invalidates everything.
 */
export function useFileAnalyses(
  files: ReadonlyMap<string, DiffLine[]>,
  theme: ResolvedTheme,
  wanted: ReadonlySet<string>
): ReadonlyMap<string, FileAnalysis> {
  // Generation token: new object identity per (files, theme) pair.
  const gen = useMemo(() => ({ files, theme }), [files, theme]);
  const [state, setState] = useState<{
    gen: unknown;
    results: Map<string, FileAnalysis>;
  }>(() => ({ gen, results: new Map() }));
  const requested = useRef<{ gen: unknown; names: Set<string> }>({
    gen,
    names: new Set(),
  });

  useEffect(() => {
    if (requested.current.gen !== gen) {
      requested.current = { gen, names: new Set() };
    }
    const req = requested.current;
    for (const file of wanted) {
      if (req.names.has(file)) continue;
      const lines = files.get(file);
      if (!lines || lines.length === 0) continue;
      req.names.add(file);
      void analyzeFileInWorker(file, lines, theme)
        .then((value) => {
          setState((prev) => {
            if (requested.current.gen !== gen) return prev;
            const results =
              prev.gen === gen ? new Map(prev.results) : new Map();
            results.set(file, value);
            return { gen, results };
          });
        })
        .catch(() => {
          // Highlights degrade to plain text; nothing to store.
        });
    }
  }, [gen, files, theme, wanted]);

  return state.gen === gen ? state.results : EMPTY_MAP;
}

/** Worker-tokenized fenced code block (comment markdown). */
export function useHighlightedCodeBlock(
  code: string,
  tag: string | undefined,
  theme: ResolvedTheme
): LineTokens[] | null {
  const [result, setResult] = useState<{
    key: string;
    tokens: LineTokens[] | null;
  }>();
  const key = `${tag} ${theme} ${code}`;

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    void tokenizeCodeInWorker(code, tag, theme)
      .then((tokens) => {
        if (!cancelled) setResult({ key, tokens });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, tokens: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!tag || !result || result.key !== key) return null;
  return result.tokens;
}

export type { CharRange };
