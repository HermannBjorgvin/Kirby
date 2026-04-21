import { WTerm } from '@wterm/dom';
import type { ControlMessage } from '../protocol.js';

const root = document.getElementById('wterm-root');
if (!root) throw new Error('missing #wterm-root');

const term = new WTerm(root, {
  cols: 100,
  rows: 30,
  autoResize: true,
});
await term.init();
term.focus();

// Auto-reconnecting WebSocket. The browser sometimes drops the initial WS
// with code 1001 during cold start (especially under automation harnesses);
// the server keeps the PTY alive and buffers output, so we just need to
// reconnect and replay picks up the missed bytes.
const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${wsProtocol}://${location.host}/pty`;
let ws: WebSocket | null = null;
const RECONNECT_DELAY_MS = 200;

let connectAttempts = 0;
function connect(): void {
  connectAttempts += 1;
  const attempt = connectAttempts;
  console.log(`[client] WS connect attempt #${attempt}`);
  const current = new WebSocket(wsUrl);
  current.binaryType = 'arraybuffer';
  ws = current;

  current.onopen = () => {
    console.log(`[client] WS #${attempt} open`);
    sendControl({ type: 'resize', cols: term.cols, rows: term.rows });
  };
  current.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(event.data));
    }
  };
  current.onclose = (ev) => {
    console.log(
      `[client] WS #${attempt} close code=${ev.code} reason=${
        ev.reason || '-'
      } wasClean=${ev.wasClean}`
    );
    if (ws === current) {
      ws = null;
      setTimeout(() => {
        console.log(`[client] reconnecting after WS #${attempt}`);
        connect();
      }, RECONNECT_DELAY_MS);
    }
  };
  current.onerror = () => {
    console.log(`[client] WS #${attempt} error`);
    try {
      current.close();
    } catch {
      /* ignore */
    }
  };
}

function sendControl(msg: ControlMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendBytes(data: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(new TextEncoder().encode(data));
  }
}

term.onData = (data) => sendBytes(data);
term.onResize = (cols, rows) => sendControl({ type: 'resize', cols, rows });

interface WTermTestHandle {
  send(bytes: string): void;
  resize(cols: number, rows: number): void;
  getText(): string;
}
(window as unknown as { __wterm: WTermTestHandle }).__wterm = {
  send(bytes) {
    sendBytes(bytes);
  },
  resize(cols, rows) {
    term.resize(cols, rows);
    sendControl({ type: 'resize', cols, rows });
  },
  getText() {
    return root?.textContent ?? '';
  },
};

connect();
