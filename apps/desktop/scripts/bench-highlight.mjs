// Where the ~1s before a diff colours in actually goes.
//
// Mirrors workers/diff-worker.ts exactly — same shiki entry points,
// same engine, same lazy grammar import — so the split between "load
// the highlighter" and "tokenize the file" is measurable without an
// Electron window in the way.
//
//   node apps/desktop/scripts/bench-highlight.mjs [lines] [files]
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

const LINES = Number(process.argv[2] ?? 400);
const FILES = Number(process.argv[3] ?? 24);
const LANG = 'typescript';
const THEME = 'github-light';

const file = Array.from(
  { length: LINES },
  (_, i) =>
    `export function fn_${i}(input: string) { const total = input.length * ${i}; return { id: '${i}', value: total }; }`
).join('\n');

const t = (label, ms) =>
  console.log(`${label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms`);

let mark = performance.now();
const hl = await createHighlighterCore({
  themes: [],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});
t('createHighlighterCore', performance.now() - mark);

mark = performance.now();
const themeMod = await bundledThemes[THEME]();
t(`import theme (${THEME})`, performance.now() - mark);

mark = performance.now();
await hl.loadTheme(themeMod);
t('loadTheme', performance.now() - mark);

mark = performance.now();
const langMod = await bundledLanguages[LANG]();
t(`import grammar (${LANG})`, performance.now() - mark);

mark = performance.now();
await hl.loadLanguage(langMod);
t('loadLanguage', performance.now() - mark);

mark = performance.now();
hl.codeToTokens(file, { lang: LANG, theme: THEME });
t(`codeToTokens, first ${LINES} lines`, performance.now() - mark);

mark = performance.now();
for (let i = 0; i < FILES; i++) {
  hl.codeToTokens(file + `\n// variant ${i}`, { lang: LANG, theme: THEME });
}
const total = performance.now() - mark;
t(`codeToTokens x${FILES} (warm)`, total);
t('  … per file', total / FILES);
