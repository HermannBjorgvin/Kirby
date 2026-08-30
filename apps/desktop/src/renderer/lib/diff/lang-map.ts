/** Filename/fence-tag → shiki grammar id. Shared by the diff worker. */

export const THEME: Record<'light' | 'dark', string> = {
  dark: 'github-dark-default',
  light: 'github-light-default',
};

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'mdx',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  tf: 'terraform',
  lua: 'lua',
  zig: 'zig',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  hs: 'haskell',
  ps1: 'powershell',
  ini: 'ini',
  diff: 'diff',
  makefile: 'makefile',
};

export function languageForFile(filename: string): string | null {
  const base = filename.split('/').pop() ?? filename;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile') return 'makefile';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_TO_LANG[lower.slice(dot + 1)] ?? null;
}

const TAG_ALIAS: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  'c++': 'cpp',
  kt: 'kotlin',
  cs: 'csharp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  gql: 'graphql',
  py: 'python',
  rs: 'rust',
  rb: 'ruby',
};

export function languageForTag(tag: string): string | null {
  const t = tag.toLowerCase();
  return TAG_ALIAS[t] ?? t;
}
