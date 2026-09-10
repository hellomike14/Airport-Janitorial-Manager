import { isInspectorManager } from "./conversationPolicy";

type Person = { id: number; role: string; email?: string | null };
type Conversation = { isGroup: boolean; participantAId: number | null; participantBId: number | null };

/** Only dedicated inspector/management threads are shared, never ordinary DMs or groups. */
export function sharedInspector(conversation: Conversation, people: Person[]): Person | undefined {
  if (conversation.isGroup) return undefined;
  const a = people.find(p => p.id === conversation.participantAId);
  const b = people.find(p => p.id === conversation.participantBId);
  if (!a || !b) return undefined;
  const dedicated = (p: Person) => p.role === "inspector" && p.email?.trim().toLowerCase() === "inspector@marvolenterprises.com";
  if (dedicated(a) && isInspectorManager(b.role)) return a;
  if (dedicated(b) && isInspectorManager(a.role)) return b;
  return undefined;
}

export function canReadSharedInspector(actor: Person & { active: boolean; loginEnabled: boolean; formerEmployee: boolean }, conversation: Conversation, people: Person[]): boolean {
  return actor.active && actor.loginEnabled && !actor.formerEmployee && isInspectorManager(actor.role) && !!sharedInspector(conversation, people);
}

export function sharedMessageIsRead(message: { senderId: number; createdAt: Date }, viewerId: number, lastReadAt: Date | null): boolean {
  return message.senderId === viewerId || !!(lastReadAt && message.createdAt <= lastReadAt);
}
