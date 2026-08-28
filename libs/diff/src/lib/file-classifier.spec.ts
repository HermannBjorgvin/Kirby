import { describe, expect, it } from 'vitest';
import type { DiffFile } from './types.js';
import {
  classifyFile,
  getDisplayFiles,
  partitionFiles,
} from './file-classifier.js';

/**
 * What gets hidden from a review by default.
 *
 * Being wrong in one direction buries a real change under a lockfile;
 * being wrong in the other hides a file the reviewer needed to see. The
 * second is the dangerous one, which is why the patterns are anchored
 * and why "looks a bit like a lockfile" has to stay normal.
 */

const file = (filename: string, binary = false): DiffFile =>
  ({ filename, binary } as DiffFile);

describe('classifyFile', () => {
  it.each([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Cargo.lock',
    'go.sum',
  ])('treats %s as a lockfile', (name) => {
    expect(classifyFile(file(name))).toBe('lockfile');
  });

  it.each([
    'app.min.js',
    'vendor.bundle.css',
    'schema.generated.ts',
    'dist/index.js',
    'build/main.js',
    'types.d.ts',
    'bundle.js.map',
    '__snapshots__/x.snap',
  ])('treats %s as generated', (name) => {
    expect(classifyFile(file(name))).toBe('generated');
  });

  it.each([
    'src/index.ts',
    'README.md',
    'src/lockfile-parser.ts',
    'src/package-lock-reader.ts',
    'docs/dist-notes.md',
    'src/build.ts',
  ])('leaves %s alone', (name) => {
    // Hiding one of these would hide a change the reviewer came for.
    expect(classifyFile(file(name))).toBe('normal');
  });

  it('calls a binary file binary whatever it is named', () => {
    expect(classifyFile(file('src/index.ts', true))).toBe('binary');
    expect(classifyFile(file('package-lock.json', true))).toBe('binary');
  });

  it('does not mistake a file that merely ends in a lockfile name', () => {
    // `not-yarn.lock` is somebody's own file.
    expect(classifyFile(file('not-yarn.lock'))).toBe('normal');
  });

  it('recognises a lockfile only at the repository root', () => {
    // Recording current behaviour rather than endorsing it: the
    // patterns are anchored to the whole path, so a workspace's own
    // `packages/app/package-lock.json` is reviewed like source. Worth a
    // decision for monorepos — until then, this is what happens.
    expect(classifyFile(file('packages/app/package-lock.json'))).toBe('normal');
  });
});

describe('partitionFiles', () => {
  const files = [
    file('src/a.ts'),
    file('package-lock.json'),
    file('src/b.ts'),
    file('dist/out.js'),
  ];

  it('splits normal from skipped, keeping each in order', () => {
    const { normal, skipped } = partitionFiles(files);
    expect(normal.map((f) => f.filename)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(skipped.map((f) => f.filename)).toEqual([
      'package-lock.json',
      'dist/out.js',
    ]);
  });

  it('loses nothing', () => {
    const { normal, skipped } = partitionFiles(files);
    expect(normal.length + skipped.length).toBe(files.length);
  });
});

describe('getDisplayFiles', () => {
  const files = [file('src/a.ts'), file('package-lock.json'), file('src/b.ts')];

  it('shows only the interesting files by default', () => {
    expect(getDisplayFiles(files, false).map((f) => f.filename)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('appends the skipped ones on request, rather than reordering', () => {
    // Revealing them must not shuffle what the reviewer was reading.
    expect(getDisplayFiles(files, true).map((f) => f.filename)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'package-lock.json',
    ]);
  });
});
