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
  RowMap,
  RowMapEntry,
  BuildRowMapInputs,
} from './lib/comment-renderer.js';
export {
  computeInsertionMap,
  computeRemoteInsertionMap,
  interleaveComments,
  getCommentPositions,
  buildRowMap,
  estimateBodyRows,
  estimateCardRows,
  estimateLocalCardRows,
  REPLY_INPUT_ROWS,
  EDIT_INPUT_SLACK_ROWS,
} from './lib/comment-renderer.js';
