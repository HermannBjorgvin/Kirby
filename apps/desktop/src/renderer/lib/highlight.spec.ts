import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import {
  codeTokensQuery,
  fileAnalysisQuery,
  wantedFilesKey,
} from './highlight.js';

const { analyze, tokenize } = vi.hoisted(() => ({
  analyze: vi.fn(),
  tokenize: vi.fn(),
}));

vi.mock('./diff-worker-client.js', () => ({
  analyzeFileInWorker: analyze,
  tokenizeCodeInWorker: tokenize,
}));

function line(content: string): DiffLine {
  return { type: 'context', content, oldLine: 1, newLine: 1 };
}

/**
 * Deliberately no `staleTime` default: anything these options don't
 * pin themselves would refetch on the second read.
 */
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  analyze.mockReset();
  analyze.mockImplementation((_file: string, lines: DiffLine[]) =>
    Promise.resolve({
      tokens: [[{ content: lines[0].content }]],
      wordRanges: new Map(),
    })
  );
  tokenize.mockReset();
  tokenize.mockImplementation((code: string) =>
    Promise.resolve([[{ content: code }]])
  );
});

describe('fileAnalysisQuery', () => {
  it('runs the worker once for a file however many times it is asked for', async () => {
    const qc = client();
    const lines = [line('a'), line('b')];

    const first = await qc.fetchQuery(fileAnalysisQuery('a.ts', lines, 'dark'));
    const second = await qc.fetchQuery(
      fileAnalysisQuery('a.ts', lines, 'dark')
    );

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('serves a cached analysis after the file has scrolled out of view', async () => {
    const qc = client();
    const lines = [line('a')];

    await qc.fetchQuery(fileAnalysisQuery('a.ts', lines, 'dark'));
    // Scrolled away: nothing observes the entry any more.
    await qc.fetchQuery(fileAnalysisQuery('b.ts', [line('b')], 'dark'));
    // ...and back.
    await qc.fetchQuery(fileAnalysisQuery('a.ts', lines, 'dark'));

    expect(analyze.mock.calls.map((c) => c[0])).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps two same-length snippets of one file apart', async () => {
    const qc = client();
    // SnippetView builds a fresh array per comment, and two comments
    // on one file can easily quote the same number of lines.
    const near = [line('first hunk')];
    const far = [line('second hunk')];

    const a = await qc.fetchQuery(fileAnalysisQuery('a.ts', near, 'dark'));
    const b = await qc.fetchQuery(fileAnalysisQuery('a.ts', far, 'dark'));

    expect(a.tokens?.[0][0].content).toBe('first hunk');
    expect(b.tokens?.[0][0].content).toBe('second hunk');
  });

  it('re-tokenizes when the theme flips', async () => {
    const qc = client();
    const lines = [line('a')];

    await qc.fetchQuery(fileAnalysisQuery('a.ts', lines, 'dark'));
    await qc.fetchQuery(fileAnalysisQuery('a.ts', lines, 'light'));

    expect(analyze.mock.calls.map((c) => c[2])).toEqual(['dark', 'light']);
  });

  it('does not share an analysis between two files', async () => {
    const qc = client();
    const lines = [line('a')];

    await qc.fetchQuery(fileAnalysisQuery('a.ts', lines, 'dark'));
    await qc.fetchQuery(fileAnalysisQuery('b.ts', lines, 'dark'));

    expect(analyze).toHaveBeenCalledTimes(2);
  });
});

describe('codeTokensQuery', () => {
  it('tokenizes one fenced block once and keys on its content', async () => {
    const qc = client();

    await qc.fetchQuery(codeTokensQuery('const a = 1', 'ts', 'dark'));
    await qc.fetchQuery(codeTokensQuery('const a = 1', 'ts', 'dark'));
    await qc.fetchQuery(codeTokensQuery('const b = 2', 'ts', 'dark'));

    expect(tokenize.mock.calls.map((c) => c[0])).toEqual([
      'const a = 1',
      'const b = 2',
    ]);
  });

  it('keys on the language tag and the theme too', async () => {
    const qc = client();

    await qc.fetchQuery(codeTokensQuery('x', 'ts', 'dark'));
    await qc.fetchQuery(codeTokensQuery('x', 'py', 'dark'));
    await qc.fetchQuery(codeTokensQuery('x', 'ts', 'light'));

    expect(tokenize).toHaveBeenCalledTimes(3);
  });
});

describe('wantedFilesKey', () => {
  const files = new Map<string, DiffLine[]>([
    ['a.ts', [line('a')]],
    ['b.ts', [line('b')]],
    ['empty.ts', []],
  ]);

  it('is the same for the same on-screen files in any order', () => {
    // The virtualizer yields a fresh Set per scroll frame, ordered by
    // whichever rows happen to be mounted.
    expect(wantedFilesKey(files, new Set(['a.ts', 'b.ts']))).toBe(
      wantedFilesKey(files, new Set(['b.ts', 'a.ts']))
    );
  });

  it('changes when a file scrolls into view', () => {
    expect(wantedFilesKey(files, new Set(['a.ts']))).not.toBe(
      wantedFilesKey(files, new Set(['a.ts', 'b.ts']))
    );
  });

  it('drops files with no lines and files not in the diff', () => {
    expect(
      wantedFilesKey(files, new Set(['a.ts', 'empty.ts', 'gone.ts']))
    ).toBe(wantedFilesKey(files, new Set(['a.ts'])));
  });
});
