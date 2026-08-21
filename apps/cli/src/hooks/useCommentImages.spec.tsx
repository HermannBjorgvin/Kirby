import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { useCommentImages } from './useCommentImages.js';

vi.mock('@kirby/image-loader', () => ({
  fetchImageBytes: vi.fn(),
  decodeImage: vi.fn(),
}));
vi.mock('../utils/gh-token.js', () => ({
  getGhToken: vi.fn(async () => null),
}));

import { fetchImageBytes, decodeImage } from '@kirby/image-loader';

const URL = 'https://x/shot.png';

function thread(body: string): RemoteCommentThread {
  return {
    id: 't1',
    file: null,
    lineStart: null,
    lineEnd: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: false,
    comments: [
      { id: 'c0', author: 'a', body, createdAt: '2026-01-01T00:00:00Z' },
    ],
  };
}

function Probe({ threads }: { threads: RemoteCommentThread[] }) {
  const value = useCommentImages(threads, 40, {});
  const parts = [...value.images.entries()].map(
    ([url, s]) => `${url}=${s.status}${s.id ? `#${s.id}` : ''}`
  );
  return <Text>{`[${value.enabled ? 'on' : 'off'}] ${parts.join('|')}`}</Text>;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('useCommentImages', () => {
  let writes: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env['KIRBY_IMAGES'] = 'kitty';
    writes = [];
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    delete process.env['KIRBY_IMAGES'];
    vi.clearAllMocks();
  });

  it('fetches, decodes, transmits once, and reports ready', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(decodeImage).mockResolvedValue({
      format: 'png',
      width: 100,
      height: 50,
      png: new Uint8Array([1, 2, 3]),
    });

    const { lastFrame, rerender } = render(
      <Probe threads={[thread(`![s](${URL})`)]} />
    );
    await flush();
    expect(lastFrame()).toContain(`${URL}=ready#1`);

    const transmit = writes.find((w) => w.startsWith('\x1b_G'));
    expect(transmit).toBeDefined();
    expect(transmit).toContain('q=2,f=100,i=1');
    expect(transmit).toContain('U=1');

    // A rerender with the same threads must not retransmit
    const before = writes.filter((w) => w.startsWith('\x1b_G')).length;
    rerender(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    expect(writes.filter((w) => w.startsWith('\x1b_G')).length).toBe(before);
  });

  it('marks failed downloads and emits nothing', async () => {
    vi.mocked(fetchImageBytes).mockRejectedValue(new Error('404'));

    const { lastFrame } = render(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    expect(lastFrame()).toContain(`${URL}=failed`);
    expect(writes.find((w) => w.startsWith('\x1b_G'))).toBeUndefined();
  });

  it('is inert when kitty graphics is off', async () => {
    process.env['KIRBY_IMAGES'] = 'off';
    const { lastFrame } = render(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    expect(lastFrame()).toContain('[off]');
    expect(vi.mocked(fetchImageBytes)).not.toHaveBeenCalled();
  });

  it('deletes transmitted images on unmount', async () => {
    vi.mocked(fetchImageBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(decodeImage).mockResolvedValue({
      format: 'png',
      width: 10,
      height: 10,
      png: new Uint8Array([1]),
    });
    const { unmount } = render(<Probe threads={[thread(`![s](${URL})`)]} />);
    await flush();
    unmount();
    expect(writes).toContain('\x1b_Ga=d,d=I,i=1\x1b\\');
  });
});
