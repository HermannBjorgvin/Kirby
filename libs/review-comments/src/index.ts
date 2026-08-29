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
  CommentPositionInfo,
} from './lib/comment-renderer.js';
export {
  interleaveComments,
  getCommentPositions,
} from './lib/comment-renderer.js';
export type {
  InsertionMap,
  RemoteInsertionMap,
} from './lib/comment-placement.js';
export {
  computeInsertionMap,
  computeRemoteInsertionMap,
} from './lib/comment-placement.js';
export type {
  RowMap,
  RowMapEntry,
  BuildRowMapInputs,
} from './lib/comment-rows.js';
export {
  buildRowMap,
  estimateBodyRows,
  estimateCardRows,
  estimateLocalCardRows,
  REPLY_INPUT_ROWS,
  estimateReplyInputRows,
  EDIT_INPUT_SLACK_ROWS,
} from './lib/comment-rows.js';
