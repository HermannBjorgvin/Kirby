import { createContext, useContext } from 'react';
import type { CommentImageLayouts } from '@kirby/review-comments';

// Per-url state of comment images. `ready` images have been
// transmitted to the terminal (kitty graphics, virtual placement) and
// render as placeholder cells; anything else falls back to the raw
// markdown token text.
export interface CommentImageState {
  status: 'loading' | 'ready' | 'failed';
  /** kitty image id (1..255), set when ready. */
  id?: number;
  rows?: number;
  cols?: number;
}

export interface CommentImagesValue {
  /** Kitty graphics active — false renders bodies exactly as before. */
  enabled: boolean;
  images: ReadonlyMap<string, CommentImageState>;
  /** Derived url → {rows, cols} for ready images (row estimation). */
  layouts: CommentImageLayouts;
}

const EMPTY: CommentImagesValue = {
  enabled: false,
  images: new Map(),
  layouts: new Map(),
};

export const CommentImagesContext = createContext<CommentImagesValue>(EMPTY);

export function useCommentImagesValue(): CommentImagesValue {
  return useContext(CommentImagesContext);
}
