import { createHash } from "node:crypto";

export type MessageReceiptDirection = "to_inspector" | "from_inspector";

export type MessageReceiptActor = {
  id: number;
  name: string;
  role: string;
  active: boolean;
  loginEnabled: boolean;
  formerEmployee: boolean;
};

export type MessageReceiptFacts = {
  messageId: number;
  conversationId: number;
  senderId: number;
  senderRole: string;
  body: string;
  version: number;
  inspectorId: number | null;
  hasOutboundEmail: boolean;
  hasInboundEmail: boolean;
};

export type MessageReceiptEvent = {
  messageVersion: number;
  bodySha256: string;
  confirmedByName: string;
  confirmedByRole: string;
  confirmedAt: Date | string;
};

export type MessageReceiptSummary = {
  version: number;
  confirmedBy: { name: string; role: string };
  confirmedAt: string;
};

export type MessageReceiptView = {
  applicable: boolean;
  direction: MessageReceiptDirection | null;
  status: "not_applicable" | "unconfirmed" | "confirmed";
  version: number;
  canConfirm: boolean;
  confirmedBy: { name: string; role: string } | null;
  confirmedAt: string | null;
  previousVersions: MessageReceiptSummary[];
};

export function hashMessageBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function getMessageReceiptDirection(
  facts: Pick<MessageReceiptFacts, "senderId" | "senderRole" | "inspectorId" | "hasOutboundEmail" | "hasInboundEmail">,
): MessageReceiptDirection | null {
  if (facts.inspectorId === null) return null;

  if (facts.hasInboundEmail && facts.senderId === facts.inspectorId) {
    return "from_inspector";
  }

  if (facts.hasOutboundEmail && isManagementRole(facts.senderRole)) {
    return "to_inspector";
  }

  return null;
}

export function canConfirmMessageReceipt(
  actor: MessageReceiptActor,
  facts: Pick<MessageReceiptFacts, "senderId" | "inspectorId">,
  direction: MessageReceiptDirection | null,
): boolean {
  if (
    direction === null ||
    !actor.active ||
    !actor.loginEnabled ||
    actor.formerEmployee ||
    actor.id === facts.senderId
  ) {
    return false;
  }

  if (direction === "to_inspector") {
    return actor.role === "inspector" && actor.id === facts.inspectorId;
  }

  return isManagementRole(actor.role);
}

export function buildMessageReceiptView(
  facts: MessageReceiptFacts,
  events: MessageReceiptEvent[],
  actor: MessageReceiptActor,
): MessageReceiptView {
  const direction = getMessageReceiptDirection(facts);
  if (direction === null) {
    return {
      applicable: false,
      direction: null,
      status: "not_applicable",
      version: facts.version,
      canConfirm: false,
      confirmedBy: null,
      confirmedAt: null,
      previousVersions: [],
    };
  }

  const currentHash = hashMessageBody(facts.body);
  const currentEvent = events.find(
    (event) => event.messageVersion === facts.version && event.bodySha256 === currentHash,
  );
  const previousVersions = events
    .filter((event) => event !== currentEvent)
    .sort((left, right) => right.messageVersion - left.messageVersion)
    .map((event) => ({
      version: event.messageVersion,
      confirmedBy: { name: event.confirmedByName, role: event.confirmedByRole },
      confirmedAt: toIsoString(event.confirmedAt),
    }));

  return {
    applicable: true,
    direction,
    status: currentEvent ? "confirmed" : "unconfirmed",
    version: facts.version,
    canConfirm: !currentEvent && canConfirmMessageReceipt(actor, facts, direction),
    confirmedBy: currentEvent
      ? { name: currentEvent.confirmedByName, role: currentEvent.confirmedByRole }
      : null,
    confirmedAt: currentEvent ? toIsoString(currentEvent.confirmedAt) : null,
    previousVersions,
  };
}

function isManagementRole(role: string): boolean {
  return role === "admin" || role === "supervisor";
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
