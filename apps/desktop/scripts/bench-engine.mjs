// Shiki's two regex engines, on the same file.
//
// The diff worker picks the JavaScript engine. That was the right
// default for a bundle (no .wasm asset to ship) but it is the thing
// doing ~130 ms of work per file, so it is worth knowing what the
// alternative costs before optimising around it.
//
//   node apps/desktop/scripts/bench-engine.mjs [lines] [reps]
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

const LINES = Number(process.argv[2] ?? 400);
const REPS = Number(process.argv[3] ?? 10);
const THEME = 'github-light';

const files = {
  typescript: Array.from(
    { length: LINES },
    (_, i) =>
      `export function fn_${i}(input: string) { const total = input.length * ${i}; return { id: '${i}', value: total }; }`
  ).join('\n'),
  markdown: Array.from({ length: LINES }, (_, i) =>
    i % 5 === 0
      ? `## Heading ${i}`
      : `Some *emphasised* text with \`code\` on line ${i}.`
  ).join('\n'),
};

async function make(engine) {
  const hl = await createHighlighterCore({ themes: [], langs: [], engine });
  await hl.loadTheme(await bundledThemes[THEME]());
  return hl;
}

async function run(name, engine) {
  const hl = await make(engine);
  console.log(`\n── ${name} ${'─'.repeat(40 - name.length)}`);
  for (const [lang, code] of Object.entries(files)) {
    const t0 = performance.now();
    await hl.loadLanguage(await bundledLanguages[lang]());
    const load = performance.now() - t0;

    hl.codeToTokens(code, { lang, theme: THEME }); // warm
    const t1 = performance.now();
    for (let i = 0; i < REPS; i++) {
      hl.codeToTokens(code + `\n// ${i}`, { lang, theme: THEME });
    }
    const per = (performance.now() - t1) / REPS;
    console.log(
      `${lang.padEnd(12)} grammar ${load.toFixed(1).padStart(7)} ms   ` +
        `tokenize ${per.toFixed(1).padStart(7)} ms / ${LINES} lines`
    );
  }
}

await run(
  'javascript engine',
  createJavaScriptRegexEngine({ forgiving: true })
);
await run(
  'oniguruma engine (wasm)',
  await createOnigurumaEngine(import('shiki/wasm'))
);
