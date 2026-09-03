export function filterConversationsByArchiveState<T extends { id: number }>(
  conversations: T[],
  archivedConversationIds: ReadonlySet<number>,
  includeArchived: boolean,
): T[] {
  return conversations.filter(
    (conversation) =>
      archivedConversationIds.has(conversation.id) === includeArchived,
  );
}
