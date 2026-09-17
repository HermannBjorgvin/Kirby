/**
 * The mailbox envelope (docs/beam.md's durable mailbox section). beam never
 * parses `payload`; `topic` exists so a receiver can subscribe to what
 * concerns it.
 */

/** An envelope's payload, and therefore the whole envelope, must fit in one
 * frame (MAX_PAYLOAD in protocol.ts is 1 MiB) with headroom to spare. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export interface Envelope {
  id: string;
  from: string;
  to: string;
  /** Monotonic per (sender, recipient) pair, strictly increasing — see
   * SeqCounter and SeenTracker, which key on exactly that pair. */
  seq: number;
  topic: string;
  payload: string;
  encoding: 'utf8' | 'base64';
  createdAt: number;
}

export function payloadByteLength(
  envelope: Pick<Envelope, 'payload' | 'encoding'>
): number {
  return envelope.encoding === 'base64'
    ? Buffer.from(envelope.payload, 'base64').byteLength
    : Buffer.byteLength(envelope.payload, 'utf8');
}

/** Structural check used when reading an envelope back off disk or off the
 * wire — a value that fails this is treated as corrupt, never coerced. */
export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['from'] === 'string' &&
    typeof r['to'] === 'string' &&
    typeof r['seq'] === 'number' &&
    typeof r['topic'] === 'string' &&
    typeof r['payload'] === 'string' &&
    (r['encoding'] === 'utf8' || r['encoding'] === 'base64') &&
    typeof r['createdAt'] === 'number'
  );
}
