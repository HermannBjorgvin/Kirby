import { describe, expect, it } from 'vitest';
import { encodeFrame, FrameType } from './protocol.js';
import { Muxer } from './muxer.js';
import { StreamRegistry } from './stream-registry.js';
import type { BeamStream } from './stream.js';

/** Wire two muxers directly together, as if connected by a lossless transport. */
function wirePair(registryA: StreamRegistry, registryB: StreamRegistry) {
  const a = new Muxer(registryA, {
    role: 'initiator',
    sendBytes: (bytes) => b.receive(bytes),
  });
  const b = new Muxer(registryB, {
    role: 'acceptor',
    sendBytes: (bytes) => a.receive(bytes),
  });
  return { a, b };
}

describe('Muxer open/ack/data/close round trip', () => {
  it('resolves openStream once the peer acks, and delivers data both ways', async () => {
    const registryB = new StreamRegistry();
    registryB.register('echo', (stream) => {
      stream.control({ kind: 'opened' });
      stream.onData((data) => stream.write(data));
    });
    const { a } = wirePair(new StreamRegistry(), registryB);

    const stream = await a.openStream('echo');
    const received = new Promise<Uint8Array>((resolve) =>
      stream.onData(resolve)
    );
    stream.write(new TextEncoder().encode('ping'));
    expect(new TextDecoder().decode(await received)).toBe('ping');
  });

  it('rejects openStream when no handler is registered for the name', async () => {
    const { a } = wirePair(new StreamRegistry(), new StreamRegistry());
    await expect(a.openStream('nope')).rejects.toThrow(/unsupported stream/);
  });

  it('a "pty" handler also answers "pty:<program>"', async () => {
    const registryB = new StreamRegistry();
    const seen: string[] = [];
    registryB.register('pty', (stream) => {
      seen.push(stream.name);
      stream.control({ kind: 'opened' });
    });
    const { a } = wirePair(new StreamRegistry(), registryB);
    await a.openStream('pty:bash');
    expect(seen).toEqual(['pty:bash']);
  });

  it('closing a stream notifies the peer with the given reason', async () => {
    const registryB = new StreamRegistry();
    let closedReason: string | undefined;
    registryB.register('echo', (stream) => {
      stream.control({ kind: 'opened' });
      stream.onClose((reason) => {
        closedReason = reason;
      });
    });
    const { a } = wirePair(new StreamRegistry(), registryB);
    const stream = await a.openStream('echo');
    stream.close('done');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closedReason).toBe('done');
  });

  it('a duplicate Open on a live stream id is rejected without displacing the handler', () => {
    const registryB = new StreamRegistry();
    const opens: string[] = [];
    registryB.register('echo', (stream) => opens.push(stream.name));
    const sent: Uint8Array[] = [];
    const b = new Muxer(registryB, {
      role: 'acceptor',
      sendBytes: (bytes) => sent.push(bytes),
    });

    const open = encodeFrame({
      type: FrameType.Open,
      streamId: 5,
      seq: 0,
      payload: new TextEncoder().encode('echo'),
    });
    b.receive(open);
    b.receive(open);
    expect(opens).toHaveLength(1);
  });

  it('control messages route to the specific stream they name', async () => {
    const registryB = new StreamRegistry();
    const resizes: unknown[] = [];
    registryB.register('pty', (stream) => {
      stream.control({ kind: 'opened' });
      stream.onControl((message) => resizes.push(message));
    });
    const { a } = wirePair(new StreamRegistry(), registryB);
    const stream = await a.openStream('pty');
    stream.control({ kind: 'resize', cols: 100, rows: 40 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resizes).toEqual([
      { kind: 'resize', cols: 100, rows: 40, streamId: stream.id },
    ]);
  });

  it('dispose reaps every open stream with a reason', async () => {
    const registryB = new StreamRegistry();
    registryB.register('echo', (stream) => stream.control({ kind: 'opened' }));
    const { a, b } = wirePair(new StreamRegistry(), registryB);
    const stream = await a.openStream('echo');
    const closed = new Promise<string | undefined>((resolve) =>
      stream.onClose(resolve)
    );
    b.dispose('peer gone');
    // b's dispose does not talk to a's transport (a real socket close would);
    // exercise a's own dispose to prove its side reaps too.
    a.dispose('peer gone');
    expect(await closed).toBe('peer gone');
  });

  it("closing a stream locally frees its id in this side's own live set", () => {
    const registryB = new StreamRegistry();
    let opens = 0;
    let lastStream: BeamStream | undefined;
    registryB.register('echo', (stream) => {
      opens += 1;
      lastStream = stream;
      stream.control({ kind: 'opened' });
    });
    const b = new Muxer(registryB, {
      role: 'acceptor',
      sendBytes: () => undefined,
    });
    const open = encodeFrame({
      type: FrameType.Open,
      streamId: 9,
      seq: 0,
      payload: new TextEncoder().encode('echo'),
    });
    b.receive(open);
    // A handler that closes locally (a pty exiting, say) must free the id
    // in this side's own live set — nothing else would ever remove it,
    // since the peer has no reason to send a Close back for a stream it
    // never asked to close.
    lastStream?.close('done locally');
    b.receive(open);
    expect(opens).toBe(2);
  });

  it('A6: sends open name+params in one frame — no stray Data frame reaches the handler before the ack', async () => {
    const registryB = new StreamRegistry();
    const receivedBeforeAck: Uint8Array[] = [];
    let acked = false;
    registryB.register('exec', (stream) => {
      // Regression for the pre-D1 bug: the old protocol sent params as an
      // immediate Data frame, and `stream.onData` was wired before the ack
      // — so the params would be delivered as if they were input. Proves
      // nothing arrives on this stream before the handler explicitly acks.
      stream.onData((data) => receivedBeforeAck.push(data));
      expect(receivedBeforeAck).toHaveLength(0);
      expect(stream.openParams).toEqual({ argv: ['echo', 'hi'] });
      acked = true;
      stream.control({ kind: 'opened' });
    });
    const { a } = wirePair(new StreamRegistry(), registryB);
    await a.openStream('exec', { argv: ['echo', 'hi'] });
    expect(acked).toBe(true);
    expect(receivedBeforeAck).toHaveLength(0);
  });

  it('A6: a bare (non-JSON) Open payload still works as the host-poc name form', async () => {
    const registryB = new StreamRegistry();
    let seenParams: Record<string, unknown> | undefined = { still: 'set' };
    registryB.register('echo', (stream) => {
      seenParams = stream.openParams;
      stream.control({ kind: 'opened' });
    });
    const { a } = wirePair(new StreamRegistry(), registryB);
    await a.openStream('echo');
    expect(seenParams).toBeUndefined();
  });

  it('A7: a sequence gap closes the stream instead of delivering the frame as ordinary data', () => {
    const registryB = new StreamRegistry();
    let opened: BeamStream | undefined;
    const delivered: Uint8Array[] = [];
    let closeReason: string | undefined;
    registryB.register('echo', (stream) => {
      opened = stream;
      stream.onData((d) => delivered.push(d));
      stream.onClose((reason) => {
        closeReason = reason;
      });
      stream.control({ kind: 'opened' });
    });
    const b = new Muxer(registryB, {
      role: 'acceptor',
      sendBytes: () => undefined,
    });
    b.receive(
      encodeFrame({
        type: FrameType.Open,
        streamId: 7,
        seq: 0,
        payload: new TextEncoder().encode('echo'),
      })
    );
    expect(opened).toBeDefined();
    // Seq 1 would be the legitimate next frame; jumping to 3 is a gap.
    b.receive(
      encodeFrame({
        type: FrameType.Data,
        streamId: 7,
        seq: 3,
        payload: new TextEncoder().encode('should not be delivered'),
      })
    );
    expect(delivered).toHaveLength(0);
    expect(closeReason).toMatch(/sequence error/);
  });

  it('A7: a duplicate Data frame is dropped, not delivered a second time', () => {
    const registryB = new StreamRegistry();
    const delivered: string[] = [];
    registryB.register('echo', (stream) => {
      stream.onData((d) => delivered.push(new TextDecoder().decode(d)));
      stream.control({ kind: 'opened' });
    });
    const b = new Muxer(registryB, {
      role: 'acceptor',
      sendBytes: () => undefined,
    });
    b.receive(
      encodeFrame({
        type: FrameType.Open,
        streamId: 11,
        seq: 0,
        payload: new TextEncoder().encode('echo'),
      })
    );
    const dataFrame = encodeFrame({
      type: FrameType.Data,
      streamId: 11,
      seq: 1,
      payload: new TextEncoder().encode('once'),
    });
    b.receive(dataFrame);
    // The identical frame again — e.g. a resend after a crash before the
    // sender saw the ack. The stream must see it exactly once.
    b.receive(dataFrame);
    expect(delivered).toEqual(['once']);
  });

  it('initiator and acceptor allocate disjoint stream ids', async () => {
    const registryA = new StreamRegistry();
    const registryB = new StreamRegistry();
    const idsSeenByB: number[] = [];
    const idsSeenByA: number[] = [];
    registryA.register('reverse', (stream) => {
      idsSeenByA.push(stream.id);
      stream.control({ kind: 'opened' });
    });
    registryB.register('echo', (stream) => {
      idsSeenByB.push(stream.id);
      stream.control({ kind: 'opened' });
    });
    const { a, b } = wirePair(registryA, registryB);
    const fromA = (await a.openStream('echo')) as BeamStream;
    const fromB = (await b.openStream('reverse')) as BeamStream;
    expect(fromA.id % 2).toBe(1);
    expect(fromB.id % 2).toBe(0);
    expect(fromA.id).not.toBe(fromB.id);
  });
});
