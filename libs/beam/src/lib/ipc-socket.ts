/**
 * The local IPC socket: `$BEAM_DIR/run/inbox.sock`, mode 0600,
 * line-delimited JSON. Any process on the machine can `send`, `subscribe`
 * or ask `status` without holding the identity itself. See docs/beam.md.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import { dirname } from 'node:path';
import type { Envelope } from './mailbox/envelope.js';
import type { Mailbox, SendOutcome } from './mailbox/mailbox.js';

interface Subscriber {
  socket: Socket;
  topic?: string;
}

export interface IpcSocketOptions {
  path: string;
  mailbox: Mailbox;
  log?: (message: string) => void;
}

function writeLine(socket: Socket, value: unknown): void {
  if (socket.writable) socket.write(`${JSON.stringify(value)}\n`);
}

function toWireOutcome(outcome: SendOutcome): Record<string, unknown> {
  const { outcome: status, ...rest } = outcome;
  return { status, ...rest };
}

/** True if something is actively listening on `path` right now. */
function probeAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Remove a stale socket file left by a crashed node — never one a live
 * node is still listening on, checked by actually trying to connect. */
async function removeStaleSocket(
  path: string,
  log: (message: string) => void
): Promise<void> {
  if (!existsSync(path)) return;
  if (await probeAlive(path)) {
    throw new Error(`a node is already listening on ${path}`);
  }
  log(`removing stale inbox socket at ${path}`);
  unlinkSync(path);
}

export class IpcSocket {
  private readonly path: string;
  private readonly mailbox: Mailbox;
  private readonly log: (message: string) => void;
  private server: Server | null = null;
  private readonly subscribers: Subscriber[] = [];
  /** Envelopes accepted but not yet acknowledged by a subscriber, oldest
   * first. An envelope leaves this list only once acked — a subscriber
   * that disconnects mid-message puts it straight back. */
  private readonly pending: Envelope[] = [];
  private current: { envelope: Envelope; subscriber: Subscriber } | null = null;
  private unsubscribeMailbox: (() => void) | null = null;

  constructor(options: IpcSocketOptions) {
    this.path = options.path;
    this.mailbox = options.mailbox;
    this.log = options.log ?? (() => undefined);
  }

  async listen(): Promise<void> {
    await removeStaleSocket(this.path, this.log);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.unsubscribeMailbox = this.mailbox.onMessage((envelope) => {
      this.pending.push(envelope);
      this.pump();
    });
    this.server = createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.path, () => resolve());
    });
    chmodSync(this.path, 0o600);
  }

  close(): Promise<void> {
    this.unsubscribeMailbox?.();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        try {
          unlinkSync(this.path);
        } catch {
          // Already gone — fine.
        }
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineAt: number;
      while ((newlineAt = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineAt);
        buffer = buffer.slice(newlineAt + 1);
        if (line.trim()) this.handleLine(socket, line);
      }
    });
    socket.on('close', () => this.handleSocketClosed(socket));
  }

  private handleSocketClosed(socket: Socket): void {
    const index = this.subscribers.findIndex((s) => s.socket === socket);
    if (index >= 0) this.subscribers.splice(index, 1);
    if (this.current?.subscriber.socket === socket) {
      // The consumer dropped mid-message: it stays unacknowledged and goes
      // back to the front of the line for whoever subscribes next.
      this.pending.unshift(this.current.envelope);
      this.current = null;
      this.pump();
    }
  }

  private handleLine(socket: Socket, line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const record = message as Record<string, unknown>;
    switch (record['op']) {
      case 'send':
        void this.handleSend(socket, record);
        return;
      case 'subscribe':
        this.handleSubscribe(socket, record);
        return;
      case 'status':
        writeLine(socket, { peers: this.mailbox.status() });
        return;
      case 'ack':
        this.handleAck(socket, record);
        return;
      default:
        return;
    }
  }

  private async handleSend(
    socket: Socket,
    record: Record<string, unknown>
  ): Promise<void> {
    const { to, topic, payload, encoding } = record;
    if (
      typeof to !== 'string' ||
      typeof topic !== 'string' ||
      typeof payload !== 'string'
    ) {
      writeLine(socket, {
        status: 'rejected',
        reason: 'malformed send request',
      });
      return;
    }
    const outcome = await this.mailbox.send({
      to,
      topic,
      payload,
      encoding: encoding === 'base64' ? 'base64' : 'utf8',
    });
    writeLine(socket, toWireOutcome(outcome));
  }

  private handleSubscribe(
    socket: Socket,
    record: Record<string, unknown>
  ): void {
    const topic =
      typeof record['topic'] === 'string' ? record['topic'] : undefined;
    this.subscribers.push({ socket, topic });
    this.pump();
  }

  private handleAck(socket: Socket, record: Record<string, unknown>): void {
    if (!this.current || this.current.subscriber.socket !== socket) return;
    if (record['id'] !== this.current.envelope.id) return;
    this.current = null;
    this.pump();
  }

  /** Hand the oldest pending envelope a matching subscriber can take to
   * that subscriber, one at a time — the next one waits for this one's ack
   * (or its consumer's disconnect) before anything else moves. */
  private pump(): void {
    if (this.current) return;
    const index = this.pending.findIndex((envelope) =>
      this.subscribers.some((s) => !s.topic || s.topic === envelope.topic)
    );
    if (index < 0) return;
    const envelope = this.pending[index];
    const subscriber = this.subscribers.find(
      (s) => !s.topic || s.topic === envelope.topic
    );
    if (!envelope || !subscriber) return;
    this.pending.splice(index, 1);
    this.current = { envelope, subscriber };
    writeLine(subscriber.socket, envelope);
  }
}
