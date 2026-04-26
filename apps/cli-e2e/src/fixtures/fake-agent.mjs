#!/usr/bin/env node
//
// fake-agent.mjs
//
// Scriptable stand-in for an AI agent (Claude/Codex/etc.) that Kirby
// can spawn through its normal `aiCommand` path. Used by e2e tests so
// session activity timing — burst → idle → maybe-burst → exit — is
// deterministic without depending on a real agent or wall-clock luck.
//
// Default behavior (`node fake-agent.mjs`) prints the banner, emits one
// short burst, and exits. Flags below configure other shapes.
//
// Manual repros for each canned scenario:
//
//   # (i) emit then idle then exit
//   node apps/cli-e2e/src/fixtures/fake-agent.mjs --bursts=1 --burst-ms=500
//
//   # (ii) silent forever (Ctrl+C to stop)
//   node apps/cli-e2e/src/fixtures/fake-agent.mjs --silent
//
//   # (iii) periodic bursts forever
//   node apps/cli-e2e/src/fixtures/fake-agent.mjs --bursts=inf --burst-ms=500 --idle-ms=3000
//
//   # (iv) echo stdin after a delay (run in a real TTY)
//   node apps/cli-e2e/src/fixtures/fake-agent.mjs --silent --echo --echo-delay-ms=200
//
//   # (v) exit after N seconds
//   node apps/cli-e2e/src/fixtures/fake-agent.mjs --silent --exit-after-ms=2000
//
// Flags:
//   --banner=<str>         initial line (default "kirby-fake-agent-ready")
//   --bursts=<n|inf>       number of bursts before going silent (default 1)
//   --burst-ms=<n>         duration of each burst (default 500)
//   --burst-bytes=<n>      bytes emitted per 100ms tick within a burst (default 64)
//   --idle-ms=<n>          silence between bursts (default 0 = continuous)
//   --silent               banner then sleep forever; overrides --bursts
//   --echo                 echo stdin back after --echo-delay-ms
//   --echo-delay-ms=<n>    echo delay (default 0)
//   --exit-after-ms=<n>    self-exit after N ms (default never)

const args = parseArgs(process.argv.slice(2));
const banner = args.banner ?? 'kirby-fake-agent-ready';
const bursts = args.silent ? 0 : parseBursts(args.bursts ?? '1');
const burstMs = parseInt(args['burst-ms'] ?? '500', 10);
const burstBytes = parseInt(args['burst-bytes'] ?? '64', 10);
const idleMs = parseInt(args['idle-ms'] ?? '0', 10);
const echo = !!args.echo;
const echoDelayMs = parseInt(args['echo-delay-ms'] ?? '0', 10);
const exitAfterMs = args['exit-after-ms']
  ? parseInt(args['exit-after-ms'], 10)
  : null;

const timers = new Set();
const setTimer = (fn, ms) => {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
  return id;
};
const setRepeating = (fn, ms) => {
  const id = setInterval(fn, ms);
  timers.add(id);
  return id;
};
const clearAllTimers = () => {
  for (const id of timers) {
    clearTimeout(id);
    clearInterval(id);
  }
  timers.clear();
};

function shutdown() {
  clearAllTimers();
  try {
    process.stdout.end();
  } catch {
    /* best effort */
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

process.stdout.write(banner + '\n');

if (echo) {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', (chunk) => {
    setTimer(() => process.stdout.write(chunk), echoDelayMs);
  });
  process.stdin.resume();
}

if (exitAfterMs != null) setTimer(shutdown, exitAfterMs);

runBursts();

// ── helpers ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq === -1) out[a.slice(2)] = true;
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

function parseBursts(v) {
  if (v === 'inf' || v === 'infinite') return Infinity;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 1;
}

function runBursts() {
  if (bursts === 0) return;
  let remaining = bursts;
  const chunk = '.'.repeat(burstBytes);
  const startBurst = () => {
    const ticker = setRepeating(() => process.stdout.write(chunk), 100);
    setTimer(() => {
      clearInterval(ticker);
      timers.delete(ticker);
      process.stdout.write('\n');
      remaining--;
      if (remaining <= 0) {
        // No more bursts. Stay alive so the PTY doesn't close until the
        // test or signal handler asks us to exit (matches a real agent
        // sitting at a prompt).
        if (!echo && exitAfterMs == null) keepAlive();
        return;
      }
      setTimer(startBurst, idleMs);
    }, burstMs);
  };
  startBurst();
}

function keepAlive() {
  // Cheap way to prevent Node's event loop from emptying out.
  setRepeating(() => undefined, 60_000);
}
