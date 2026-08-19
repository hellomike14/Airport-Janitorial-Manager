/**
 * Hand-written client helpers for messaging endpoints that are not generated
 * by orval (group conversations, per-message delete/edit).  These live here
 * so codegen can clean the generated/ directory without removing them.
 */

import { customFetch } from "./custom-fetch";
import type { ConversationSummary, ChatMessage } from "./generated/api.schemas";

export interface GroupConversationStartInput {
  staffId: number;
  recipientIds: number[];
  groupName?: string;
}

export interface UpdateChatMessageInput {
  senderId: number;
  /** @minLength 1 @maxLength 2000 */
  body: string;
}

export const startGroupConversation = async (
  input: GroupConversationStartInput,
  options?: RequestInit,
): Promise<ConversationSummary> => {
  return customFetch<ConversationSummary>(`/api/conversations/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(input),
    ...options,
  });
};

export const deleteConversationMessage = async (
  conversationId: number,
  messageId: number,
  params: { staffId: number },
  options?: RequestInit,
): Promise<{ deleted: boolean }> => {
  return customFetch<{ deleted: boolean }>(
    `/api/conversations/${conversationId}/messages/${messageId}?staffId=${params.staffId}`,
    { method: "DELETE", ...options },
  );
};

export const updateConversationMessage = async (
  conversationId: number,
  messageId: number,
  input: UpdateChatMessageInput,
  options?: RequestInit,
): Promise<ChatMessage> => {
  return customFetch<ChatMessage>(
    `/api/conversations/${conversationId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...options?.headers },
      body: JSON.stringify(input),
      ...options,
    },
  );
};
