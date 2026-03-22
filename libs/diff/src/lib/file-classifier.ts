import type { DiffFile, FileCategory } from './types.js';

const LOCKFILE_PATTERNS = [
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^bun\.lockb$/,
  /^Gemfile\.lock$/,
  /^Cargo\.lock$/,
  /^poetry\.lock$/,
  /^composer\.lock$/,
  /^Pipfile\.lock$/,
  /^go\.sum$/,
];

const GENERATED_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.generated\.\w+$/,
  /^dist\//,
  /^build\//,
  /\.d\.ts$/,
  /\.map$/,
  /\.snap$/,
];

export function classifyFile(file: DiffFile): FileCategory {
  if (file.binary) return 'binary';
  if (LOCKFILE_PATTERNS.some((p) => p.test(file.filename))) return 'lockfile';
  if (GENERATED_PATTERNS.some((p) => p.test(file.filename))) return 'generated';
  return 'normal';
}

export function partitionFiles(files: DiffFile[]) {
  const normal: DiffFile[] = [];
  const skipped: DiffFile[] = [];
  for (const f of files) {
    if (classifyFile(f) === 'normal') {
      normal.push(f);
    } else {
      skipped.push(f);
    }
  }
  return { normal, skipped };
}

export function getDisplayFiles(
  files: DiffFile[],
  showSkipped: boolean
): DiffFile[] {
  const { normal, skipped } = partitionFiles(files);
  return showSkipped ? [...normal, ...skipped] : normal;
}
