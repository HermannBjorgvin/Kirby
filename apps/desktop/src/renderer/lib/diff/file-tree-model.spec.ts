import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ancestorDirs,
  buildTree,
  changedPaths,
  collapseAfterRefresh,
  NO_COLLAPSE,
  toggleCollapsed,
  type TreeCollapse,
  type TreeFile,
} from './file-tree-model.js';

const file = (path: string, revision = 'r1'): TreeFile => ({ path, revision });

/** The state after the user has closed `dirs`, reconciled against `files`. */
function closed(files: TreeFile[], ...dirs: string[]): TreeCollapse {
  let state = collapseAfterRefresh(NO_COLLAPSE, files);
  for (const dir of dirs) state = toggleCollapsed(state, dir);
  return state;
}

describe('buildTree', () => {
  it('keeps a compacted chain addressable by its full path', () => {
    const [node] = buildTree([{ path: 'src/lib/deep/a.ts' }, { path: 'b.ts' }]);
    expect(node).toMatchObject({
      kind: 'dir',
      name: 'src/lib/deep',
      path: 'src/lib/deep',
    });
  });

  it('sorts directories before files', () => {
    const tree = buildTree([{ path: 'a.ts' }, { path: 'z/b.ts' }]);
    expect(tree.map((n) => n.kind)).toEqual(['dir', 'file']);
  });
});

describe('ancestorDirs', () => {
  it('lists every containing directory, deepest last', () => {
    expect(ancestorDirs('a/b/c/d.ts')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('is empty for a file at the root', () => {
    expect(ancestorDirs('README.md')).toEqual([]);
  });
});

describe('changedPaths', () => {
  it('reports nothing before a first snapshot exists', () => {
    expect(changedPaths(null, [file('a/x.ts')])).toEqual([]);
  });

  it('reports a file whose contents moved, and only that one', () => {
    const seen = new Map([
      ['a/x.ts', 'r1'],
      ['b/y.ts', 'r1'],
    ]);
    expect(changedPaths(seen, [file('a/x.ts', 'r2'), file('b/y.ts')])).toEqual([
      'a/x.ts',
    ]);
  });
});

describe('collapseAfterRefresh', () => {
  const files = [file('src/a.ts'), file('docs/guide/one.md')];

  it('leaves a closed folder closed when the poll reports the same files', () => {
    const state = closed(files, 'docs/guide');
    const after = collapseAfterRefresh(state, files);
    // Same object: an unchanged poll is not a state change at all, so a
    // caller driving this from an effect does not re-render.
    expect(after).toBe(state);
  });

  it('leaves a closed folder closed when a file changes elsewhere', () => {
    const state = closed(files, 'docs/guide');
    const after = collapseAfterRefresh(state, [
      file('src/a.ts', 'r2'),
      file('docs/guide/one.md'),
    ]);
    expect([...after.collapsed]).toEqual(['docs/guide']);
  });

  it('leaves a closed folder closed when a file is added elsewhere', () => {
    const state = closed(files, 'docs/guide');
    const after = collapseAfterRefresh(state, [...files, file('src/new.ts')]);
    expect([...after.collapsed]).toEqual(['docs/guide']);
  });

  it('opens the ancestors of a file that changed inside a closed folder', () => {
    const state = closed(files, 'docs', 'docs/guide');
    const after = collapseAfterRefresh(state, [
      file('src/a.ts'),
      file('docs/guide/one.md', 'r2'),
    ]);
    expect([...after.collapsed]).toEqual([]);
  });

  it('opens the ancestors of a file added inside a closed folder', () => {
    const state = closed(files, 'docs/guide');
    const after = collapseAfterRefresh(state, [
      ...files,
      file('docs/guide/two.md'),
    ]);
    expect([...after.collapsed]).toEqual([]);
  });

  it('ignores the blank tick between two parses', () => {
    // The parse of a fresh patch runs off the main thread, so the tree
    // is handed an empty list for a render. Recording that as the
    // snapshot would make every file look new next time and throw the
    // whole tree open.
    const state = closed(files, 'docs/guide');
    const blank = collapseAfterRefresh(state, []);
    expect(blank).toBe(state);
    expect([...collapseAfterRefresh(blank, files).collapsed]).toEqual([
      'docs/guide',
    ]);
  });

  it('does not open anything on the first snapshot it ever sees', () => {
    const state = toggleCollapsed(NO_COLLAPSE, 'docs/guide');
    expect([...collapseAfterRefresh(state, files).collapsed]).toEqual([
      'docs/guide',
    ]);
  });
});

describe('toggleCollapsed', () => {
  it('closes an open folder and opens a closed one', () => {
    const once = toggleCollapsed(NO_COLLAPSE, 'src');
    expect([...once.collapsed]).toEqual(['src']);
    expect([...toggleCollapsed(once, 'src').collapsed]).toEqual([]);
  });
});

// ── Properties ───────────────────────────────────────────────────
//
// Collapse state is a function of the previous state and the delta
// between two snapshots. Every bug here has been a violation of that:
// something that reads the poll itself.

const arbPath = fc
  .array(fc.constantFrom('a', 'b', 'c'), { minLength: 0, maxLength: 3 })
  .chain((dirs) =>
    fc
      .constantFrom('one.ts', 'two.ts', 'three.ts')
      .map((name) => [...dirs, name].join('/'))
  );

const arbSnapshot = fc
  .uniqueArray(fc.tuple(arbPath, fc.constantFrom('r1', 'r2', 'r3')), {
    selector: ([path]) => path,
    minLength: 1,
    maxLength: 8,
  })
  .map((rows) => rows.map(([path, revision]) => file(path, revision)));

describe('collapse properties', () => {
  it('never opens a folder that no snapshot change reaches into', () => {
    fc.assert(
      fc.property(
        arbSnapshot,
        arbSnapshot,
        fc.array(fc.constantFrom('a', 'a/b', 'b', 'a/b/c'), { maxLength: 4 }),
        (first, second, dirs) => {
          const state = closed(first, ...dirs);
          const after = collapseAfterRefresh(state, second);
          const reached = new Set(
            changedPaths(state.seen, second).flatMap(ancestorDirs)
          );
          const untouched = [...state.collapsed].filter(
            (dir) => !reached.has(dir)
          );
          expect(untouched.filter((dir) => !after.collapsed.has(dir))).toEqual(
            []
          );
        }
      )
    );
  });

  it('is unmoved by repeating the same snapshot any number of times', () => {
    fc.assert(
      fc.property(
        arbSnapshot,
        fc.array(fc.constantFrom('a', 'a/b', 'b'), { maxLength: 3 }),
        fc.integer({ min: 1, max: 5 }),
        (files, dirs, polls) => {
          const state = closed(files, ...dirs);
          let after = state;
          for (let i = 0; i < polls; i++) {
            after = collapseAfterRefresh(after, files);
          }
          expect(after).toBe(state);
        }
      )
    );
  });

  it('never invents a collapsed folder', () => {
    fc.assert(
      fc.property(
        arbSnapshot,
        arbSnapshot,
        fc.array(fc.constantFrom('a', 'a/b', 'b'), { maxLength: 3 }),
        (first, second, dirs) => {
          const state = closed(first, ...dirs);
          const after = collapseAfterRefresh(state, second);
          expect(
            [...after.collapsed].filter((dir) => !state.collapsed.has(dir))
          ).toEqual([]);
        }
      )
    );
  });
});
