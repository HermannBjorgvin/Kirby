export type {
  ReviewComment,
  ReviewCommentsFile,
  CommentSeverity,
} from './lib/types.js';
export {
  commentDirPath,
  commentFilePath,
  readComments,
  appendComment,
  updateComment,
  removeComment,
} from './lib/comment-store.js';
export { postReviewComments, type PostContext } from './lib/comment-poster.js';
export type {
  AnnotatedLine,
  InsertionMap,
  CommentPositionInfo,
} from './lib/comment-renderer.js';
export {
  computeInsertionMap,
  interleaveComments,
  getCommentPositions,
} from './lib/comment-renderer.js';
