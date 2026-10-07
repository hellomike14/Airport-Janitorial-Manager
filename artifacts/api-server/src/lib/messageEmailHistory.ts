export type OutboxHistoryRow = {
  messageId: number;
  status: string;
  acceptedAt: Date | null;
};

export function groupInspectorEmailAcceptedAt(rows: readonly OutboxHistoryRow[]): Map<number, string | null> {
  const grouped = new Map<number, OutboxHistoryRow[]>();
  for (const row of rows) {
    const entries = grouped.get(row.messageId) ?? [];
    entries.push(row);
    grouped.set(row.messageId, entries);
  }

  return new Map([...grouped].map(([messageId, entries]) => {
    if (entries.some((entry) => entry.status !== "accepted" || !entry.acceptedAt)) return [messageId, null];
    const acceptedAt = Math.max(...entries.map((entry) => entry.acceptedAt!.getTime()));
    return [messageId, new Date(acceptedAt).toISOString()];
  }));
}

export function groupInboundEmailReceivedAt(
  rows: readonly { messageId: number | null; receivedAt: Date }[],
): Map<number, string> {
  const receivedAtByMessageId = new Map<number, string>();
  for (const row of rows) {
    if (row.messageId === null) continue;
    const existing = receivedAtByMessageId.get(row.messageId);
    const receivedAt = existing
      ? Math.min(new Date(existing).getTime(), row.receivedAt.getTime())
      : row.receivedAt.getTime();
    receivedAtByMessageId.set(row.messageId, new Date(receivedAt).toISOString());
  }
  return receivedAtByMessageId;
}
