import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ReviewComment } from '@n10/review-comments';
import type * as Core from '@n10/core';
import type * as Util from './util.js';
import { parseArgs } from './util.js';

/** The diff the anchor check sees; set per test. `null` = file not in
 *  the diff; `'unresolvable'` = the target branch is unknown here. */
const anchorEnv = vi.hoisted(() => ({
  lines: { right: [{ start: 7, end: 13 }], left: [] } as
    | { right: { start: number; end: number }[]; left: never[] }
    | null
    | 'unresolvable',
}));

vi.mock('@n10/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  return {
    ...actual,
    commentableLines: async () => {
      if (anchorEnv.lines === 'unresolvable') {
        throw new Error('Cannot resolve ref for branch: main');
      }
      return anchorEnv.lines;
    },
  };
});

describe('parseArgs', () => {
  it('parses simple key=value', () => {
    expect(parseArgs(['--body=noquotes'])).toEqual({ body: 'noquotes' });
  });

  it('strips double quotes', () => {
    expect(parseArgs(['--body="hello world"'])).toEqual({
      body: 'hello world',
    });
  });

  it('strips single quotes', () => {
    expect(parseArgs(["--body='single'"])).toEqual({ body: 'single' });
  });

  it('preserves equals signs inside quoted values', () => {
    expect(parseArgs(['--key="value=with=equals"'])).toEqual({
      key: 'value=with=equals',
    });
  });

  it('does not strip mismatched quotes', () => {
    expect(parseArgs(['--key="mixed\'']).key).toBe('"mixed\'');
  });

  it('ignores args without -- prefix', () => {
    expect(parseArgs(['foo=bar'])).toEqual({});
  });

  it('parses multiple args', () => {
    expect(
      parseArgs(['--pr=123', '--file="src/foo.ts"', '--severity=major'])
    ).toEqual({ pr: '123', file: 'src/foo.ts', severity: 'major' });
  });
});

/**
 * What `add-comment` actually writes.
 *
 * The command is the agent's whole interface to the review — a
 * subprocess with no state — so the file it leaves behind is the
 * contract, and asserting on the parsed flags alone would not have
 * caught a field that never reached disk.
 */
describe('add-comment', () => {
  let home: string;
  let originalHome: string | undefined;
  let util: typeof Util;

  const PR = 7;
  const BASE = [
    `--pr=${PR}`,
    '--file=src/undo.c',
    '--lineStart=12',
    '--lineEnd=12',
    '--severity=major',
    '--body=The undo stack is never bounded.',
  ];

  beforeEach(async () => {
    originalHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'n10-util-'));
    process.env.HOME = home;
    // ~/.n10 is resolved once at import time, so the module chain has
    // to be re-imported after HOME moves.
    vi.resetModules();
    util = await import('./util.js');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Read the drafts file the way the reader does — off disk, at the
   * path the agent's subprocess wrote it to. Going through the store's
   * own API instead would prove the two agree with each other and
   * nothing about the file that is actually the contract.
   */
  const stored = (): ReviewComment[] => {
    const path = join(home, '.n10', 'reviews', `pr-${PR}`, 'comments.json');
    return (
      JSON.parse(readFileSync(path, 'utf8')) as {
        comments: ReviewComment[];
      }
    ).comments;
  };

  it('writes the draft the flags describe', async () => {
    await util.handleUtilCommand(['add-comment', ...BASE]);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      file: 'src/undo.c',
      lineStart: 12,
      lineEnd: 12,
      severity: 'major',
      body: 'The undo stack is never bounded.',
      side: 'RIGHT',
      status: 'draft',
    });
  });

  /** The id the provider knows the conversation by. Without it the
   *  draft is only a file and a line, and nothing downstream can tell
   *  which thread it answers. */
  it('records the thread a draft answers', async () => {
    await util.handleUtilCommand([
      'add-comment',
      ...BASE,
      '--thread=PRRT_kwDOAbC123',
    ]);
    expect(stored()[0].threadId).toBe('PRRT_kwDOAbC123');
  });

  /** The body's own header states a severity too, and the two must not
   *  be able to disagree: everything downstream — the walkthrough
   *  order, the rail dot, the TUI chip, the posted body — reads the
   *  stored one. */
  it('raises the stored severity to match a louder header in the body', async () => {
    await util.handleUtilCommand([
      'add-comment',
      `--pr=${PR}`,
      '--file=src/undo.c',
      '--lineStart=12',
      '--lineEnd=12',
      '--severity=nit',
      '--body=question (blocking): does this drop writes on crash?',
    ]);
    expect(stored()[0].severity).toBe('critical');
  });

  it('will not let an accidental label quieten the declared severity', async () => {
    await util.handleUtilCommand([
      'add-comment',
      `--pr=${PR}`,
      '--file=src/undo.c',
      '--lineStart=12',
      '--lineEnd=12',
      '--severity=critical',
      '--body=Note: this drops writes on crash',
    ]);
    expect(stored()[0].severity).toBe('critical');
  });

  it('leaves threadId off a draft that answers nothing', async () => {
    await util.handleUtilCommand(['add-comment', ...BASE]);
    expect(stored()[0].threadId).toBeUndefined();
  });

  /**
   * The other two anchors. A remark about code the pull request did
   * not change has no line the provider would take; a remark about
   * the change as a whole has no file. Both are drafts all the same.
   */
  describe('anchors', () => {
    let exit: ReturnType<typeof vi.spyOn>;
    let errors: string[];

    beforeEach(() => {
      errors = [];
      vi.spyOn(console, 'error').mockImplementation((m: unknown) => {
        errors.push(String(m));
      });
      exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`exit ${String(code)}`);
      });
      anchorEnv.lines = { right: [{ start: 7, end: 13 }], left: [] };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const run = (...args: string[]) =>
      util.handleUtilCommand([
        'add-comment',
        `--pr=${PR}`,
        '--severity=minor',
        '--body=A remark.',
        ...args,
      ]);

    it('writes a whole-file draft when no lines are given', async () => {
      await run('--file=src/undo.c');
      expect(stored()[0]).toMatchObject({
        file: 'src/undo.c',
        lineStart: null,
        lineEnd: null,
      });
    });

    it('writes a whole-PR draft when no file is given', async () => {
      await run();
      expect(stored()[0]).toMatchObject({
        file: null,
        lineStart: null,
        lineEnd: null,
      });
    });

    it('refuses half an anchor', async () => {
      await expect(run('--file=src/undo.c', '--lineStart=3')).rejects.toThrow(
        'exit 1'
      );
      await expect(run('--lineStart=3', '--lineEnd=3')).rejects.toThrow(
        'exit 1'
      );
      expect(errors.join('\n')).toContain('go together');
      expect(errors.join('\n')).toContain('need --file');
    });

    /** The 422 this replaces arrived at post time with no line named.
     *  Refusing here, with the commentable lines in the message, lets
     *  the agent pick one while it still has the file open. */
    it('refuses a line outside the diff when the base is known', async () => {
      await expect(
        run(
          '--file=src/undo.c',
          '--lineStart=93',
          '--lineEnd=99',
          '--base=main'
        )
      ).rejects.toThrow('exit 1');
      expect(errors.join('\n')).toContain('src/undo.c:93-99 is not part');
      expect(errors.join('\n')).toContain('7-13');
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('accepts a line inside the diff', async () => {
      await run(
        '--file=src/undo.c',
        '--lineStart=8',
        '--lineEnd=9',
        '--base=main'
      );
      expect(stored()).toHaveLength(1);
    });

    it('refuses a file the diff does not touch', async () => {
      anchorEnv.lines = null;
      await expect(
        run('--file=src/other.c', '--lineStart=1', '--lineEnd=1', '--base=main')
      ).rejects.toThrow('exit 1');
      expect(errors.join('\n')).toContain('src/other.c is not part');
    });

    /** A whole-file draft (`--file` alone) with `--base` is checked
     *  too: the file itself still has to be part of the diff, even
     *  though there is no line to anchor within it. */
    it('refuses a whole-file draft when the base is known and the file is not in the diff', async () => {
      anchorEnv.lines = null;
      await expect(run('--file=src/other.c', '--base=main')).rejects.toThrow(
        'exit 1'
      );
      expect(errors.join('\n')).toContain('src/other.c is not part');
    });

    it('accepts a whole-file draft when the base is known and the file is in the diff', async () => {
      await run('--file=src/undo.c', '--base=main');
      expect(stored()).toHaveLength(1);
    });

    /** A checkout without the target branch fetched cannot verify;
     *  losing the draft over that would be worse than a later 422. */
    it('records the draft unchecked when the base cannot be resolved', async () => {
      anchorEnv.lines = 'unresolvable';
      await run(
        '--file=src/undo.c',
        '--lineStart=93',
        '--lineEnd=99',
        '--base=main'
      );
      expect(stored()).toHaveLength(1);
      expect(errors.join('\n')).toContain('warning: could not check');
    });

    it('does not check without a base', async () => {
      anchorEnv.lines = null;
      await run('--file=src/undo.c', '--lineStart=93', '--lineEnd=99');
      expect(stored()).toHaveLength(1);
    });
  });
});
