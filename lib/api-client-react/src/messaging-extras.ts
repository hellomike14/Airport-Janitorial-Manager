/**
 * Hand-written client helpers for messaging endpoints that are not generated
 * by orval (group conversations and per-message edit). These live here
 * so codegen can clean the generated/ directory without removing them.
 */

import { customFetch } from "./custom-fetch";
import type {
  ConversationSummary,
  ChatMessage,
  GroupConversationStartInput,
  UpdateChatMessageInput,
} from "./generated/api.schemas";

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
