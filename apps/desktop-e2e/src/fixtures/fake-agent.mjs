#!/usr/bin/env node
//
// fake-agent.mjs — scriptable stand-in for an AI agent, spawned through
// the desktop's normal `aiCommand` path.
//
// The desktop only needs two shapes of agent, so this is deliberately
// smaller than the CLI suite's harness (apps/cli-e2e/src/fixtures):
//
//   idle    — prints a banner, then sits at a prompt forever. Session is
//             alive but `active` is false, so closing its tab must kill
//             it without a confirmation.
//   working — never stops producing output, which keeps the activity
//             registry's `active` flag set and makes the close
//             confirmation appear.
//
// Flags:
//   --banner=<str>       first line (default "kirby-fake-agent-ready")
//   --stream             emit a line every --interval-ms, forever
//   --interval-ms=<n>    stream interval (default 150)
//   --stream-ms=<n>      stop streaming after N ms but stay alive — an
//                        agent that finished a piece of work and is now
//                        waiting at its prompt
//   --exit-after-ms=<n>  self-exit after N ms (default never)
//   --print-seed         print the seed prompt the launcher handed it
//                        (KIRBY_SEED_PROMPT), one marked line per line, so
//                        a test can prove what the agent was actually
//                        started with rather than what the UI claimed.
//   --print-size         print the PTY's grid as `size:<cols>x<rows>#<pid>`,
//                        on start and again on every SIGWINCH. A real
//                        agent draws itself to whatever size it is given,
//                        so this is the only way a test can see the size
//                        the renderer actually asked for. The pid is what
//                        tells one agent's lines from the next one's: a
//                        restart under tmux repaints the screen, so
//                        counting lines cannot say whose they are.
//   --echo               echo each completed line of stdin back, so a test
//                        can prove input travelled renderer → IPC → PTY →
//                        agent → back. Line-buffered on purpose: a PTY in
//                        raw mode delivers one keystroke at a time, so an
//                        immediate echo would answer "hello" with five
//                        separate lines.

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
    })
);

const banner = args.banner ?? 'kirby-fake-agent-ready';
const intervalMs = parseInt(args['interval-ms'] ?? '150', 10);
const exitAfterMs = args['exit-after-ms']
  ? parseInt(args['exit-after-ms'], 10)
  : null;

process.stdout.write(banner + '\r\n');

if (args['print-seed']) {
  for (const line of (process.env.KIRBY_SEED_PROMPT ?? '').split('\n')) {
    process.stdout.write(`seed:${line}\r\n`);
  }
}

if (args['print-size']) {
  const report = () => {
    const { columns, rows } = process.stdout;
    process.stdout.write(`size:${columns ?? 0}x${rows ?? 0}#${process.pid}\r\n`);
  };
  report();
  process.stdout.on('resize', report);
}

const timers = new Set();
const shutdown = () => {
  for (const t of timers) clearInterval(t);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

if (args.echo) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  let line = '';
  process.stdin.on('data', (chunk) => {
    for (const ch of chunk.toString()) {
      if (ch === '\r' || ch === '\n') {
        process.stdout.write(`echo:${line}\r\n`);
        line = '';
      } else {
        line += ch;
      }
    }
  });
  process.stdin.resume();
}

if (args.stream) {
  let n = 0;
  const ticker = setInterval(() => {
    n += 1;
    process.stdout.write(`working ${n}\r\n`);
  }, intervalMs);
  timers.add(ticker);
  if (args['stream-ms']) {
    setTimeout(() => {
      clearInterval(ticker);
      timers.delete(ticker);
      process.stdout.write('done\r\n');
      // Stay alive, quiet, as an agent waiting for its next instruction.
      timers.add(setInterval(() => undefined, 60_000));
    }, parseInt(args['stream-ms'], 10));
  }
} else {
  // Keep the PTY open without producing output — a real agent waiting
  // at its prompt. Node would otherwise exit on an empty event loop.
  timers.add(setInterval(() => undefined, 60_000));
}

if (exitAfterMs != null) setTimeout(shutdown, exitAfterMs);
