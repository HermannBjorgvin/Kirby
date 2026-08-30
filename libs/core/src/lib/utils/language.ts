// File-extension → highlight.js language tag.
//
// Intentionally small: the long tail of rarely-seen extensions isn't
// worth the maintenance. Add entries as they come up; anything not
// recognized renders unhighlighted, which is a perfectly fine fallback.

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
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
  toml: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  sql: 'sql',
};

export function languageFromFilename(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) return undefined;
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return EXT_TO_LANG[ext];
}
