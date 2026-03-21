import { useState } from 'react';

export function useCommentState() {
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null
  );
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<
    string | null
  >(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');

  return {
    selectedCommentId,
    setSelectedCommentId,
    pendingDeleteCommentId,
    setPendingDeleteCommentId,
    editingCommentId,
    setEditingCommentId,
    editBuffer,
    setEditBuffer,
  };
}
