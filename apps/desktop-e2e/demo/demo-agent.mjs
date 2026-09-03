#!/usr/bin/env node
/**
 * The agent that appears in README captures.
 *
 * The e2e fake agent is deliberately ugly — a bare banner and echo
 * lines, built to be asserted against. A capture needs the opposite: a
 * terminal that *looks* like an agent at work, with believable pacing,
 * while staying fully deterministic and offline. Same contract as any
 * agent Kirby launches: spawned as the configured aiCommand, seeded
 * through KIRBY_SEED_PROMPT.
 */

const CSI = '\x1b[';
const dim = (s) => `${CSI}2m${s}${CSI}0m`;
const bold = (s) => `${CSI}1m${s}${CSI}0m`;
const cyan = (s) => `${CSI}36m${s}${CSI}0m`;
const green = (s) => `${CSI}32m${s}${CSI}0m`;
const yellow = (s) => `${CSI}33m${s}${CSI}0m`;
const magenta = (s) => `${CSI}35m${s}${CSI}0m`;

const out = (s = '') => process.stdout.write(s + '\r\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function banner() {
  out();
  out(`  ${magenta('✳')} ${bold('agent')} ${dim('· connected to workspace')}`);
  out(dim('  ────────────────────────────────────────────'));
  out();
}

/** Render the seeded prompt the way an agent shows the user message. */
function showPrompt(prompt) {
  const lines = prompt.split('\n');
  const shown = lines.slice(0, 14);
  for (const line of shown) out(dim(`  │ `) + dim(line));
  if (lines.length > shown.length) {
    out(dim(`  │ … ${lines.length - shown.length} more lines`));
  }
  out();
}

async function work(steps) {
  for (const [delay, line] of steps) {
    await sleep(delay);
    out(line);
  }
}

const PLAN_STEPS = [
  [900, `  ${cyan('→')} Reading ${bold('src/palette.ts')}`],
  [1300, `  ${cyan('→')} Reading ${bold('src/keyboard.ts')}`],
  [
    1600,
    dim('    the filter re-runs on every keystroke — memoizing per query'),
  ],
  [900, `  ${yellow('✎')} Editing ${bold('src/palette.ts')} ${dim('+14 −3')}`],
  [1800, `  ${yellow('✎')} Editing ${bold('src/palette.ts')} ${dim('+2 −1')}`],
  [1400, `  ${cyan('$')} npm test ${dim('— 42 passing')}`],
  [1700, `  ${green('✓')} 1. Memoized the palette filter per query prefix`],
  [500, `  ${green('✓')} 2. Escape now clears the query before closing`],
  [600, ''],
  [200, dim('  Done. 2 review comments resolved — ready for another look.')],
];

/** What the agent does with a babysitter's status update. */
const BABYSIT_STEPS = [
  [
    900,
    `  ${cyan('→')} Reading the failed check ${dim('· ci / test (node 22)')}`,
  ],
  [
    1500,
    dim('    retry.test.ts: "gives up after N attempts" — timer never fires'),
  ],
  [1100, `  ${cyan('→')} Reading ${bold('src/retry.ts')}`],
  [1300, `  ${yellow('✎')} Editing ${bold('src/retry.ts')} ${dim('+3 −1')}`],
  [1200, `  ${cyan('$')} npm test ${dim('— 43 passing')}`],
  [1000, `  ${cyan('$')} git push ${dim('· retry-backoff')}`],
  [
    800,
    `  ${green('✓')} Capped the backoff and pushed a fix; CI is re-running`,
  ],
  [400, `  ${green('✓')} Replied on the review thread`],
  [500, ''],
  [200, dim('  Done. Will pick up the next update when it lands.')],
];

const BLANK_STEPS = [
  [700, `  ${cyan('→')} Reading ${bold('package.json')}`],
  [1100, `  ${cyan('→')} Scanning ${bold('src/')} ${dim('· 6 files')}`],
  [1200, ''],
  [300, dim('  Workspace indexed. What should I work on?')],
];

const seed = process.env.KIRBY_SEED_PROMPT;
// A babysitter starts this agent in a pane that is still being laid
// out; a beat before the first line lets the terminal take its final
// width, so the update is not wrapped for a pane that no longer exists.
if (seed?.startsWith('Status update')) await sleep(1500);
banner();
if (seed) {
  showPrompt(seed);
  await work(seed.startsWith('Status update') ? BABYSIT_STEPS : PLAN_STEPS);
} else {
  await work(BLANK_STEPS);
}

// Stay alive at a quiet prompt, like a real agent waiting.
process.stdout.write('\r\n  ' + dim('❯') + ' ');
setInterval(() => undefined, 60_000);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
