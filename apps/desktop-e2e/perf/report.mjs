#!/usr/bin/env node
/**
 * Compare two benchmark runs.
 *
 *   node perf/report.mjs before after
 *   node perf/report.mjs before            # against "current"
 *   node perf/report.mjs                   # list what has been recorded
 *
 * Reports the median of each metric and the change between runs. Medians
 * rather than means because one iteration that hit a GC pause or a busy
 * core should not decide the verdict, and a change under ~5% on a
 * developer machine is noise — the column says so rather than inviting
 * you to read it as a win.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, '..', 'perf-output');

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

if (!existsSync(DIR)) {
  console.error(`No results yet — run \`node run-perf.mjs\` first (${DIR}).`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const labels = [...new Set(files.map((f) => f.split('.')[0]))];
const scenarios = [...new Set(files.map((f) => f.split('.')[1]))];

const [before, after = 'current'] = process.argv.slice(2);
if (!before) {
  console.log(`labels:    ${labels.join(', ')}`);
  console.log(`scenarios: ${scenarios.join(', ')}`);
  console.log('\nUsage: node perf/report.mjs <before> [after]');
  process.exit(0);
}

const read = (label, scenario) => {
  const f = join(DIR, `${label}.${scenario}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

let missing = 0;
for (const scenario of scenarios) {
  const a = read(before, scenario);
  const b = read(after, scenario);
  if (!a || !b) {
    missing++;
    continue;
  }
  console.log(`\n── ${scenario}  (${before} → ${after}) ${'─'.repeat(30)}`);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    if (!a[k]?.length || !b[k]?.length) continue;
    const ma = median(a[k]);
    const mb = median(b[k]);
    const pct = ma === 0 ? 0 : ((mb - ma) / ma) * 100;
    const verdict =
      Math.abs(pct) < 5
        ? '·'
        : pct < 0
        ? `${pct.toFixed(0)}%`
        : `+${pct.toFixed(0)}%`;
    console.log(
      `${k.padEnd(24)} ${ma.toFixed(1).padStart(9)} → ${mb
        .toFixed(1)
        .padStart(9)}   ${verdict.padStart(6)}`
    );
  }
}

if (missing === scenarios.length) {
  console.error(
    `\nNothing to compare: no scenario has both ${before} and ${after}.`
  );
  process.exit(1);
}
