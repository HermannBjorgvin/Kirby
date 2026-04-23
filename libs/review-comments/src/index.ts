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
  RemoteInsertionMap,
} from './lib/comment-renderer.js';
export {
  computeInsertionMap,
  computeRemoteInsertionMap,
  interleaveComments,
  renderRemoteThread,
  getCommentPositions,
} from './lib/comment-renderer.js';
