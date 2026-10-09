import { facilityDateKey } from "@/lib/facilityDate";

export type MessagesSourceLink = {
  conversationId: number;
  messageId: number;
};

export type InspectorReportLink = {
  assignmentTaskId: number | null;
  from: string | null;
  to: string | null;
};

function singleValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 && values[0] !== "" ? values[0]! : null;
}

function positiveSafeInteger(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validDateOnly(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseMessagesSourceLink(search: string): MessagesSourceLink | null {
  const params = new URLSearchParams(search);
  const conversationId = positiveSafeInteger(singleValue(params, "conversationId"));
  const messageId = positiveSafeInteger(singleValue(params, "messageId"));
  return conversationId && messageId ? { conversationId, messageId } : null;
}

export function parseInspectorAssignmentTaskId(search: string): number | null {
  return positiveSafeInteger(singleValue(new URLSearchParams(search), "assignmentTaskId"));
}

export function parseInspectorReportLink(search: string): InspectorReportLink {
  const params = new URLSearchParams(search);
  const assignmentTaskId = positiveSafeInteger(singleValue(params, "assignmentTaskId"));
  const from = singleValue(params, "from");
  const to = singleValue(params, "to");
  if (!validDateOnly(from) || !validDateOnly(to) || from > to) {
    return { assignmentTaskId, from: null, to: null };
  }
  return { assignmentTaskId, from, to };
}

export function findVisibleConversation<T extends { id: number; conversationIds?: number[] }>(
  conversations: T[],
  linkedConversationId: number,
): T | null {
  return conversations.find((conversation) =>
    conversation.id === linkedConversationId || conversation.conversationIds?.includes(linkedConversationId),
  ) ?? null;
}

export function sourceMessageMatches<T extends { id: number; conversationId: number }>(
  link: MessagesSourceLink,
  conversation: { id: number; conversationIds?: number[] },
  message: T,
): boolean {
  const allowedIds = conversation.conversationIds?.length
    ? conversation.conversationIds
    : [conversation.id];
  return allowedIds.includes(link.conversationId) &&
    message.id === link.messageId &&
    message.conversationId === link.conversationId;
}

export function inspectorAssignmentHref(taskId: number): string {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return "/issues";
  return `/issues?${new URLSearchParams({ assignmentTaskId: String(taskId) })}`;
}

export function sourceMessageHref(conversationId: number, messageId: number): string {
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0 ||
      !Number.isSafeInteger(messageId) || messageId <= 0) return "/messages";
  const params = new URLSearchParams({
    conversationId: String(conversationId),
    messageId: String(messageId),
  });
  return `/messages?${params.toString()}`;
}

export function inspectorReportHref(taskId: number, sourceReceivedAt: string): string | null {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return null;
  const date = new Date(sourceReceivedAt);
  if (Number.isNaN(date.getTime())) return null;
  const dateOnly = facilityDateKey(date);
  const params = new URLSearchParams({
    from: dateOnly,
    to: dateOnly,
    assignmentTaskId: String(taskId),
  });
  return `/report?${params.toString()}`;
}
