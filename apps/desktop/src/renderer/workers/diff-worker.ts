/**
 * Off-main-thread diff machinery. The UI thread was paying for
 * whole-file shiki tokenization, multi-megabyte unified-diff parsing
 * and per-pair word diffs for every open PR tab — enough to make
 * typing stutter. All of it runs here instead; the renderer talks to
 * this worker through lib/diff-worker-client.ts.
 */
import { parseUnifiedDiff, type DiffLine } from '@kirby/diff';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';
import { buildSplitRows } from '../lib/diff/diff-model.js';
import { wordDiff, type CharRange } from '../lib/diff/word-diff.js';
import { languageForFile, languageForTag, THEME } from '../lib/diff/lang-map.js';

export interface SlimToken {
  content: string;
  color?: string;
}

export type WorkerRequest =
  | { id: number; type: 'parse'; text: string }
  | {
      id: number;
      type: 'analyze';
      filename: string;
      lines: DiffLine[];
      theme: 'light' | 'dark';
    }
  | {
      id: number;
      type: 'code';
      code: string;
      tag: string;
      theme: 'light' | 'dark';
    };

export type WorkerResponse =
  | { id: number; type: 'parse'; entries: [string, DiffLine[]][] }
  | {
      id: number;
      type: 'analyze';
      tokens: SlimToken[][] | null;
      wordRanges: [number, CharRange[]][];
    }
  | { id: number; type: 'code'; tokens: SlimToken[][] | null }
  | { id: number; type: 'error'; message: string };

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighterPromise;
}

async function tokenize(
  code: string,
  lang: string,
  theme: 'light' | 'dark'
): Promise<SlimToken[][] | null> {
  const themeName = THEME[theme];
  const langLoader = bundledLanguages[lang as keyof typeof bundledLanguages];
  if (!langLoader) return null;
  const hl = await getHighlighter();
  if (!loadedThemes.has(themeName)) {
    const t = bundledThemes[themeName as keyof typeof bundledThemes];
    if (t) {
      await hl.loadTheme(t);
      loadedThemes.add(themeName);
    }
  }
  if (!loadedLangs.has(lang)) {
    await hl.loadLanguage(langLoader);
    loadedLangs.add(lang);
  }
  const { tokens } = hl.codeToTokens(code, {
    lang: lang as never,
    theme: themeName as never,
  });
  return tokens.map((line) =>
    line.map((t) => ({ content: t.content, color: t.color }))
  );
}

function computeWordRanges(lines: DiffLine[]): [number, CharRange[]][] {
  const out: [number, CharRange[]][] = [];
  const pairs = buildSplitRows(
    lines,
    lines.map((_, index) => ({ kind: 'line', index }))
  );
  for (const r of pairs) {
    if (r.kind !== 'pair' || !r.left || !r.right) continue;
    const d = wordDiff(r.left.line.content, r.right.line.content);
    if (!d) continue;
    out.push([r.left.index, d.old]);
    out.push([r.right.index, d.new]);
  }
  return out;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'parse') {
      const entries = [...parseUnifiedDiff(msg.text).entries()];
      postMessage({
        id: msg.id,
        type: 'parse',
        entries,
      } satisfies WorkerResponse);
    } else if (msg.type === 'analyze') {
      const lang = languageForFile(msg.filename);
      const tokens = lang
        ? await tokenize(
            msg.lines.map((l) => l.content).join('\n'),
            lang,
            msg.theme
          )
        : null;
      postMessage({
        id: msg.id,
        type: 'analyze',
        tokens,
        wordRanges: computeWordRanges(msg.lines),
      } satisfies WorkerResponse);
    } else if (msg.type === 'code') {
      const lang = languageForTag(msg.tag);
      const tokens = lang ? await tokenize(msg.code, lang, msg.theme) : null;
      postMessage({
        id: msg.id,
        type: 'code',
        tokens,
      } satisfies WorkerResponse);
    }
  } catch (err) {
    postMessage({
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
