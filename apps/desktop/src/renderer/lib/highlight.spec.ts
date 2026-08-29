import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import {
  codeTokensQuery,
  fileAnalysisQuery,
  wantedFilesKey,
} from './highlight.js';
import { snippetAround } from './diff-model.js';
import type * as ContentKey from './content-key.js';

const { analyze, tokenize, hash } = vi.hoisted(() => ({
  analyze: vi.fn(),
  tokenize: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('./diff-worker-client.js', () => ({
  analyzeFileInWorker: analyze,
  tokenizeCodeInWorker: tokenize,
}));

// The real hash, counted. Hashing a whole file is ~4 ms at 20 000
// lines, so *how often* it runs is as much a part of the contract as
// what it returns — hence a spy over the real thing rather than a stub.
vi.mock('./content-key.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ContentKey>();
  hash.mockImplementation(actual.contentKey);
  return { contentKey: hash };
});

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
  // Clear, never reset: a reset would drop the real implementation the
  // mock factory installed once.
  hash.mockClear();
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

  it('tells a removed line from an added one with the same text', async () => {
    // The word diff pairs removes against adds, so the two produce
    // different ranges from identical text. A key that saw only the
    // text would hand one line the other's highlighting.
    const qc = client();
    const removed: DiffLine[] = [
      { type: 'remove', content: 'const a = 1;', oldLine: 1 },
    ];
    const added: DiffLine[] = [
      { type: 'add', content: 'const a = 1;', newLine: 1 },
    ];

    await qc.fetchQuery(fileAnalysisQuery('a.ts', removed, 'dark'));
    await qc.fetchQuery(fileAnalysisQuery('a.ts', added, 'dark'));

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

/**
 * The review walkthrough (ReviewStepper → StepCard → SnippetView) hands
 * the highlighter a *fresh array of the same lines* on every render:
 * `snippetAround` is called inline in ReviewStepper's JSX, StepCard is
 * not memoised, and SnippetView's `useMemo(() => rows.map(r => r.line))`
 * turns each new `rows` into a new `lines`. Nothing on screen changed,
 * so nothing should be tokenized twice.
 *
 * This is the shape a key built on array *identity* gets wrong, and the
 * virtualized whole-file path is the one it gets right — the key has to
 * hold for both.
 */
describe('the review walkthrough snippet path', () => {
  const FILE: DiffLine[] = [
    { type: 'hunk-header', content: '@@ -1,6 +1,6 @@' },
    { type: 'context', content: 'const a = 1;', oldLine: 1, newLine: 1 },
    { type: 'context', content: 'const b = 2;', oldLine: 2, newLine: 2 },
    { type: 'remove', content: 'const c = 3;', oldLine: 3 },
    { type: 'add', content: 'const c = 4;', newLine: 3 },
    { type: 'context', content: 'const d = 5;', oldLine: 4, newLine: 4 },
    { type: 'context', content: 'const e = 6;', oldLine: 5, newLine: 5 },
  ];

  /** One render of StepCard's snippet, from the stepper down. */
  function renderSnippetLines(): DiffLine[] {
    const rows = snippetAround(FILE, 'RIGHT', 3, 3);
    return rows.map((r) => r.line);
  }

  it('hands a re-render the same query key', () => {
    const first = fileAnalysisQuery('a.ts', renderSnippetLines(), 'dark');
    const second = fileAnalysisQuery('a.ts', renderSnippetLines(), 'dark');

    expect(second.queryKey).toEqual(first.queryKey);
  });

  it('tokenizes a snippet once however often the card re-renders', async () => {
    const qc = client();

    // Five renders of one step: a keystroke in the draft editor, a
    // toast, a `drafts` refetch — none of them touch the snippet.
    for (let i = 0; i < 5; i++) {
      await qc.fetchQuery(
        fileAnalysisQuery('a.ts', renderSnippetLines(), 'dark')
      );
    }

    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('still separates two snippets of one file', async () => {
    const qc = client();

    const here = snippetAround(FILE, 'RIGHT', 1, 1).map((r) => r.line);
    const there = snippetAround(FILE, 'RIGHT', 5, 5).map((r) => r.line);

    await qc.fetchQuery(fileAnalysisQuery('a.ts', here, 'dark'));
    await qc.fetchQuery(fileAnalysisQuery('a.ts', there, 'dark'));

    expect(analyze).toHaveBeenCalledTimes(2);
  });
});

/**
 * The other half of the same contract. `VirtualDiffList` memoizes
 * `linesByFile`, so the arrays here keep their identity while the user
 * scrolls — but `useFileAnalyses` rebuilds its query list every time a
 * file enters or leaves the viewport, calling `fileAnalysisQuery` for
 * every on-screen file each time.
 *
 * Whole-file diffs (`-U99999`) run to tens of thousands of lines, where
 * hashing costs ~4 ms. Doing that per scroll frame would trade one
 * regression for another, so the count below is the real assertion:
 * once per file, not once per frame.
 */
describe('the virtualized whole-file path', () => {
  function wholeFile(seed: string): DiffLine[] {
    return Array.from({ length: 2000 }, (_, i) => ({
      type: i % 9 === 0 ? ('add' as const) : ('context' as const),
      content: `  const ${seed}${i} = ${i};`,
      oldLine: i + 1,
      newLine: i + 1,
    }));
  }

  it('neither re-tokenizes nor re-hashes a file while it scrolls', async () => {
    const qc = client();
    const files = new Map([
      ['a.ts', wholeFile('a')],
      ['b.ts', wholeFile('b')],
      ['c.ts', wholeFile('c')],
    ]);

    // A scroll down and back up: each step is one rebuild of the query
    // list, over whichever files the virtualizer has on screen.
    const viewports = [
      ['a.ts'],
      ['a.ts', 'b.ts'],
      ['b.ts'],
      ['b.ts', 'c.ts'],
      ['b.ts'],
      ['a.ts', 'b.ts'],
      ['a.ts'],
    ];
    for (const viewport of viewports) {
      for (const file of viewport) {
        await qc.fetchQuery(fileAnalysisQuery(file, files.get(file)!, 'dark'));
      }
    }

    expect(analyze).toHaveBeenCalledTimes(3);
    expect(hash).toHaveBeenCalledTimes(3);
  });

  it('re-hashes when the lines themselves change', () => {
    const before = wholeFile('a');
    const after = wholeFile('a');
    after[1200] = { ...after[1200], content: '  const edited = 0;' };

    const first = fileAnalysisQuery('a.ts', before, 'dark');
    const second = fileAnalysisQuery('a.ts', after, 'dark');

    expect(second.queryKey).not.toEqual(first.queryKey);
  });

  it('does not put the lines themselves in the key', () => {
    // TanStack re-stringifies a query key on every render of every
    // observer; a 20 000-line array in there is ~5.6 ms a render.
    const key = fileAnalysisQuery('a.ts', wholeFile('a'), 'dark').queryKey;

    expect(JSON.stringify(key).length).toBeLessThan(120);
  });
});
