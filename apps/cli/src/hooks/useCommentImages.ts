import { useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  collectImageUrls,
  type CommentImageLayouts,
  type CommentImageLayout,
} from '@kirby/review-comments';
import {
  detectKittyGraphics,
  encodeTransmitPng,
  encodeTransmitRgba,
  placementForImage,
  deleteImage,
} from '@kirby/kitty-graphics';
import { fetchImageBytes, decodeImage } from '@kirby/image-loader';
import type {
  CommentImagesValue,
  CommentImageState,
} from '../context/CommentImagesContext.js';
import { getGhToken } from '../utils/gh-token.js';

// Loads comment images and transmits them to the terminal via the
// kitty graphics protocol (virtual placements — see @kirby/kitty-graphics).
// Each distinct url is fetched, decoded, and transmitted exactly once
// per process; the resulting state map drives both rendering
// (CommentBody placeholders) and row estimation (imageLayouts).
export function useCommentImages(
  threads: RemoteCommentThread[],
  maxCols: number,
  vendorAuth: Record<string, string>
): CommentImagesValue {
  const enabled = useMemo(() => detectKittyGraphics(process.env), []);
  const [images, setImages] = useState<ReadonlyMap<string, CommentImageState>>(
    new Map()
  );
  // Urls ever started (never retried within a session) + allocated ids.
  const startedRef = useRef(new Set<string>());
  const nextIdRef = useRef(1);
  const transmittedIdsRef = useRef<number[]>([]);
  // Placement width is captured at load time; a later resize keeps the
  // transmitted placement (re-transmitting on resize is a follow-up).
  const maxColsRef = useRef(maxCols);
  useEffect(() => {
    maxColsRef.current = maxCols;
  }, [maxCols]);

  useEffect(() => {
    if (!enabled) return;
    const urls = collectImageUrls(threads).filter(
      (u) => !startedRef.current.has(u)
    );
    if (urls.length === 0) return;

    for (const url of urls) startedRef.current.add(url);
    setImages((prev) => {
      const next = new Map(prev);
      for (const url of urls) next.set(url, { status: 'loading' });
      return next;
    });

    let cancelled = false;
    const fail = (url: string) => {
      if (cancelled) return;
      setImages((prev) => new Map(prev).set(url, { status: 'failed' }));
    };

    for (const url of urls) {
      void (async () => {
        try {
          const githubToken = (await getGhToken()) ?? undefined;
          const bytes = await fetchImageBytes(url, {
            githubToken,
            azurePat: vendorAuth['pat'],
          });
          const decoded = decodeImage(bytes);
          if (!decoded || cancelled) return fail(url);
          if (nextIdRef.current > 255) return fail(url);
          const id = nextIdRef.current++;
          const placement = placementForImage(
            decoded.width,
            decoded.height,
            Math.max(1, maxColsRef.current)
          );
          const escape =
            decoded.format === 'png'
              ? encodeTransmitPng(id, decoded.png, placement)
              : encodeTransmitRgba(
                  id,
                  decoded.rgba,
                  decoded.width,
                  decoded.height,
                  placement
                );
          process.stdout.write(escape);
          transmittedIdsRef.current.push(id);
          if (cancelled) return;
          setImages((prev) =>
            new Map(prev).set(url, {
              status: 'ready',
              id,
              rows: placement.rows,
              cols: placement.cols,
            })
          );
        } catch {
          fail(url);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, threads, vendorAuth]);

  // Free the terminal's image memory when Kirby unmounts/exits.
  useEffect(() => {
    if (!enabled) return;
    const ids = transmittedIdsRef.current;
    return () => {
      for (const id of ids) process.stdout.write(deleteImage(id));
    };
  }, [enabled]);

  const layouts: CommentImageLayouts = useMemo(() => {
    const m = new Map<string, CommentImageLayout>();
    for (const [url, state] of images) {
      if (
        state.status === 'ready' &&
        state.rows !== undefined &&
        state.cols !== undefined
      ) {
        m.set(url, { rows: state.rows, cols: state.cols });
      }
    }
    return m;
  }, [images]);

  return useMemo(
    () => ({ enabled, images, layouts }),
    [enabled, images, layouts]
  );
}
