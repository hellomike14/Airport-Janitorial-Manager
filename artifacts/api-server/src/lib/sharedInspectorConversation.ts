import { isInspectorManager } from "./conversationPolicy";

type Person = { id: number; role: string; email?: string | null };
type Conversation = { isGroup: boolean; participantAId: number | null; participantBId: number | null };
type IdentifiedConversation = Conversation & { id: number };
type ActiveManager = Person & { active?: boolean; loginEnabled?: boolean; formerEmployee?: boolean };

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

/** Groups only direct threads belonging to the same dedicated inspector identity. */
export function groupSharedInspectorThreads<T extends IdentifiedConversation>(
  conversations: T[],
  people: Person[],
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const conversation of conversations) {
    const inspector = sharedInspector(conversation, people);
    if (!inspector) continue;
    const threads = groups.get(inspector.id) ?? [];
    threads.push(conversation);
    groups.set(inspector.id, threads);
  }
  return groups;
}

/** Keep inbound mail and new management messages on the same active-manager thread. */
export function canonicalSharedInspectorThread<T extends IdentifiedConversation>(
  threads: T[],
  people: ActiveManager[],
): T | undefined {
  const ordered = [...threads].sort((left, right) => left.id - right.id);
  return ordered.find((thread) => {
    const inspector = sharedInspector(thread, people);
    if (!inspector) return false;
    const managerId = thread.participantAId === inspector.id ? thread.participantBId : thread.participantAId;
    const manager = people.find((person) => person.id === managerId);
    return !!manager && isInspectorManager(manager.role) && manager.active === true &&
      manager.loginEnabled === true && manager.formerEmployee === false;
  }) ?? ordered[0];
}

export function sharedInspectorGroupIsArchived(threadIds: number[], archivedConversationIds: Set<number>): boolean {
  return threadIds.length > 0 && threadIds.every((id) => archivedConversationIds.has(id));
}

export function canReadSharedInspector(actor: Person & { active: boolean; loginEnabled: boolean; formerEmployee: boolean }, conversation: Conversation, people: Person[]): boolean {
  return actor.active && actor.loginEnabled && !actor.formerEmployee && isInspectorManager(actor.role) && !!sharedInspector(conversation, people);
}

export function sharedMessageIsRead(message: { senderId: number; createdAt: Date }, viewerId: number, lastReadAt: Date | null): boolean {
  return message.senderId === viewerId || !!(lastReadAt && message.createdAt <= lastReadAt);
}
