import { WTerm } from '@wterm/dom';
import type { ControlMessage } from '../protocol.js';

const params = new URLSearchParams(location.search);
const sessionId = params.get('session') ?? 'dev-session';

const root = document.getElementById('wterm-root');
if (!root) throw new Error('missing #wterm-root');

const term = new WTerm(root, {
  cols: 100,
  rows: 30,
  autoResize: true,
});
await term.init();
term.focus();

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(
  `${wsProtocol}://${location.host}/pty?session=${encodeURIComponent(
    sessionId
  )}`
);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
  sendControl({ type: 'resize', cols: term.cols, rows: term.rows });
};

ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    try {
      const msg = JSON.parse(event.data) as ControlMessage;
      if (msg.type === 'exit')
        console.info('[kirby] pty exited with code', msg.code);
      else if (msg.type === 'error')
        console.error('[kirby] server error:', msg.message);
    } catch {
      /* ignore malformed control */
    }
    return;
  }
  term.write(new Uint8Array(event.data as ArrayBuffer));
};

term.onData = (data) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(new TextEncoder().encode(data));
  }
};

term.onResize = (cols, rows) => {
  sendControl({ type: 'resize', cols, rows });
};

function sendControl(msg: ControlMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

interface WTermTestHandle {
  send(bytes: string): void;
  resize(cols: number, rows: number): void;
  getText(): string;
}
(window as unknown as { __wterm: WTermTestHandle }).__wterm = {
  send(bytes) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(bytes));
    }
  },
  resize(cols, rows) {
    term.resize(cols, rows);
    sendControl({ type: 'resize', cols, rows });
  },
  getText() {
    return root?.textContent ?? '';
  },
};
