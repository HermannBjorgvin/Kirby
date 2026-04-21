import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { spawn as spawnPty, type IPty } from 'node-pty';
import type { ControlMessage, SpawnRequest } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/main.js → walk up to workspace root (dist → apps/cli-wterm-host → apps → root)
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const cliBinary = path.resolve(workspaceRoot, 'apps/cli/dist/main.js');
const publicDir = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PORT ?? 5174);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

interface PendingSession extends SpawnRequest {
  sessionId: string;
}

const pendingSessions = new Map<string, PendingSession>();
const activePtys = new Map<string, IPty>();

function createDevSessionSpawn(): PendingSession {
  const home = execSync(`mktemp -d "${tmpdir()}/kirby-wterm-dev-home.XXXXXX"`)
    .toString()
    .trim();
  const repo = execSync(`mktemp -d "${tmpdir()}/kirby-wterm-dev-repo.XXXXXX"`)
    .toString()
    .trim();
  execSync('git init', { cwd: repo, stdio: 'pipe' });
  execSync('git config user.email "dev@kirby.dev"', {
    cwd: repo,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby Dev"', { cwd: repo, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "initial"', {
    cwd: repo,
    stdio: 'pipe',
  });
  execSync(`mkdir -p "${path.join(home, '.kirby')}"`, { stdio: 'pipe' });
  return { sessionId: 'dev-session', repoPath: repo, homeDir: home };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relPath);
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404).end('not found');
  }
}

function isLocalhost(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/__spawn') {
    if (!isLocalhost(req)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as PendingSession;
      if (!parsed.sessionId || !parsed.repoPath || !parsed.homeDir) {
        res.writeHead(400).end('missing sessionId, repoPath, or homeDir');
        return;
      }
      pendingSessions.set(parsed.sessionId, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400).end((err as Error).message);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__kill') {
    if (!isLocalhost(req)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const sessionId = url.searchParams.get('session');
    if (!sessionId) {
      res.writeHead(400).end('missing session');
      return;
    }
    pendingSessions.delete(sessionId);
    const pty = activePtys.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {
        /* ignore */
      }
      activePtys.delete(sessionId);
    }
    res.writeHead(200).end('ok');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__health') {
    res.writeHead(200).end('ok');
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405).end('method not allowed');
    return;
  }

  await serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname !== '/pty') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleWs(ws, url);
  });
});

function handleWs(ws: WebSocket, url: URL): void {
  const sessionId = url.searchParams.get('session') ?? 'dev-session';
  let cfg = pendingSessions.get(sessionId);
  if (!cfg) {
    if (sessionId === 'dev-session') {
      cfg = createDevSessionSpawn();
    } else {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `unknown session: ${sessionId}`,
        } satisfies ControlMessage)
      );
      ws.close();
      return;
    }
  }
  pendingSessions.delete(sessionId);

  const pty = spawnPty('node', [cliBinary, cfg.repoPath], {
    name: 'xterm-256color',
    cols: cfg.cols ?? 100,
    rows: cfg.rows ?? 30,
    cwd: workspaceRoot,
    env: {
      ...process.env,
      HOME: cfg.homeDir,
      TERM: 'xterm-256color',
      ...cfg.env,
    },
  });
  activePtys.set(sessionId, pty);

  pty.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(Buffer.from(data, 'utf8'), { binary: true });
    }
  });
  pty.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'exit',
          code: exitCode,
        } satisfies ControlMessage)
      );
      ws.close();
    }
    activePtys.delete(sessionId);
  });

  ws.on('message', (raw, isBinary) => {
    const buf = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.from(raw as ArrayBuffer);
    if (isBinary) {
      pty.write(buf.toString('utf8'));
      return;
    }
    try {
      const msg = JSON.parse(buf.toString('utf8')) as ControlMessage;
      if (msg.type === 'resize') {
        pty.resize(msg.cols, msg.rows);
      }
    } catch {
      /* ignore */
    }
  });

  ws.on('close', () => {
    const active = activePtys.get(sessionId);
    if (active) {
      try {
        active.kill();
      } catch {
        /* ignore */
      }
      activePtys.delete(sessionId);
    }
  });
}

function cleanup(): void {
  for (const pty of activePtys.values()) {
    try {
      pty.kill();
    } catch {
      /* ignore */
    }
  }
  activePtys.clear();
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

server.listen(PORT, 'localhost', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`listening on http://localhost:${port}`);
});
