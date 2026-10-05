type MessagingActor = { role: string };
export const isInspectorManager = (role: string) => role === "admin" || role === "supervisor";

export function isAllowedPair(a: MessagingActor, b: MessagingActor): boolean {
  const isMgr = (s: MessagingActor) => s.role === "admin" || s.role === "supervisor";
  if (a.role === "staff" && isMgr(b)) return true;
  if (b.role === "staff" && isMgr(a)) return true;
  if (isMgr(a) && isMgr(b)) return true;
  if (
    (isInspectorManager(a.role) && b.role === "inspector") ||
    (a.role === "inspector" && isInspectorManager(b.role))
  )
    return true;
  return false;
}

// Who can start a 1:1 conversation:
//   admin      → staff, supervisor
//   supervisor → staff, admin, inspector
//   inspector  → supervisor
//   staff      → supervisor
export function canStart(sender: MessagingActor, recipient: MessagingActor): boolean {
  const isMgr = (s: MessagingActor) => s.role === "admin" || s.role === "supervisor";
  if (sender.role === "admin") return recipient.role === "staff" || recipient.role === "supervisor" || recipient.role === "inspector";
  if (sender.role === "supervisor") return recipient.role === "staff" || isMgr(recipient) || recipient.role === "inspector";
  if (sender.role === "inspector") return isInspectorManager(recipient.role);
  if (sender.role === "staff") return recipient.role === "supervisor";
  return false;
}

