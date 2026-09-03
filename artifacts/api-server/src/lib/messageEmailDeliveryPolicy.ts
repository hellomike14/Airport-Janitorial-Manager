import type { MessageEmailDeliveryStatus } from "@workspace/db/schema";
import type {
  InspectorConversationEmailResult,
  OutboundBridgeConfiguration,
} from "./sendgridEmailBridge";

export type PublicEmailDeliveryStatus =
  | MessageEmailDeliveryStatus
  | "not_applicable";

export interface ExistingIdempotentMessage {
  conversationId: number;
  senderId: number;
  clientRequestId: string | null;
  body: string;
}

export interface RequestedIdempotentMessage {
  conversationId: number;
  senderId: number;
  clientRequestId: string;
  body: string;
}

export type OutboxTransition = {
  status: MessageEmailDeliveryStatus;
  nextAttemptAt: Date;
  acceptedAt: Date | null;
  lastError: string | null;
};

export function initialEmailDeliveryStatus(
  isSupervisorToInspector: boolean,
  configuration: OutboundBridgeConfiguration,
): PublicEmailDeliveryStatus {
  if (!isSupervisorToInspector) return "not_applicable";
  if (configuration.status === "configured") return "pending";
  return configuration.status;
}

/**
 * An idempotency key may replay only the exact same logical message. Reusing a
 * key with a changed body or conversation is a conflict, never an instruction
 * to return or mutate some unrelated message.
 */
export function isExactMessageReplay(
  existing: ExistingIdempotentMessage,
  requested: RequestedIdempotentMessage,
): boolean {
  return (
    existing.conversationId === requested.conversationId &&
    existing.senderId === requested.senderId &&
    existing.clientRequestId === requested.clientRequestId &&
    existing.body === requested.body
  );
}

function boundedError(error: string | undefined): string {
  const normalized = error?.trim() || "Unknown SendGrid delivery error";
  return Array.from(normalized).slice(0, 1_000).join("");
}

export function retryDelayMs(attemptCount: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(5_000 * 2 ** (normalizedAttempt - 1), 15 * 60_000);
}

export function outboxTransitionForResult(input: {
  result: InspectorConversationEmailResult;
  attemptCount: number;
  maxAttempts: number;
  now: Date;
}): OutboxTransition {
  const { result, now } = input;
  if (result.status === "accepted") {
    return {
      status: "accepted",
      nextAttemptAt: now,
      acceptedAt: now,
      lastError: null,
    };
  }
  if (result.status === "disabled" || result.status === "not_configured") {
    return {
      status: result.status,
      nextAttemptAt: now,
      acceptedAt: null,
      lastError:
        result.status === "disabled"
          ? "SendGrid email bridge is disabled"
          : "SendGrid email bridge is not configured",
    };
  }

  const attemptCount = Math.max(1, Math.floor(input.attemptCount));
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts));
  if (attemptCount >= maxAttempts) {
    return {
      status: "failed",
      nextAttemptAt: now,
      acceptedAt: null,
      lastError: boundedError(result.error),
    };
  }
  return {
    status: "retrying",
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount)),
    acceptedAt: null,
    lastError: boundedError(result.error),
  };
}
