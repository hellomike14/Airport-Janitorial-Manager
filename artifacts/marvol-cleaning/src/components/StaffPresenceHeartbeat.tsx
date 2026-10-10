import { useEffect } from "react";
import { postStaffPresenceActivity } from "@workspace/api-client-react";

export const PRESENCE_IDLE_MS = 2 * 60 * 1000;
export const PRESENCE_HEARTBEAT_MS = 30 * 1000;

export function isPresenceHeartbeatDue(input: {
  loggedIn: boolean;
  visible: boolean;
  lastInteractionAt: number;
  lastHeartbeatAt: number | null;
  now: number;
}): boolean {
  const idleFor = input.now - input.lastInteractionAt;
  return input.loggedIn && input.visible && idleFor >= 0 && idleFor <= PRESENCE_IDLE_MS &&
    (input.lastHeartbeatAt == null || input.now - input.lastHeartbeatAt >= PRESENCE_HEARTBEAT_MS);
}

export function StaffPresenceHeartbeat({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let lastInteractionAt = 0;
    let lastHeartbeatAt: number | null = null;
    let inFlight = false;
    let disposed = false;
    const visible = () => document.visibilityState === "visible";
    let timer: number | undefined;
    const sendIfDue = () => {
      const now = Date.now();
      if (disposed || inFlight || !isPresenceHeartbeatDue({
        loggedIn: enabled,
        visible: visible(),
        lastInteractionAt,
        lastHeartbeatAt,
        now,
      })) return;
      lastHeartbeatAt = now;
      inFlight = true;
      void postStaffPresenceActivity({
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined).finally(() => {
        inFlight = false;
        if (!disposed) scheduleNext();
      });
    };
    const scheduleNext = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (disposed || inFlight || !visible() || lastInteractionAt === 0) return;
      const now = Date.now();
      const idleRemaining = PRESENCE_IDLE_MS - (now - lastInteractionAt);
      if (idleRemaining <= 0) return;
      const heartbeatRemaining = lastHeartbeatAt == null
        ? 0
        : Math.max(0, PRESENCE_HEARTBEAT_MS - (now - lastHeartbeatAt));
      timer = window.setTimeout(() => {
        timer = undefined;
        sendIfDue();
        scheduleNext();
      }, Math.min(idleRemaining, heartbeatRemaining));
    };
    const interacted = () => {
      if (!visible()) return;
      lastInteractionAt = Date.now();
      sendIfDue();
      scheduleNext();
    };
    const onVisibility = () => {
      if (!visible()) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (visible() && document.hasFocus()) interacted();
    };
    window.addEventListener("pointerdown", interacted, { passive: true });
    window.addEventListener("keydown", interacted);
    window.addEventListener("touchstart", interacted, { passive: true });
    window.addEventListener("focus", interacted);
    document.addEventListener("visibilitychange", onVisibility);
    if (visible() && document.hasFocus()) interacted();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", interacted);
      window.removeEventListener("keydown", interacted);
      window.removeEventListener("touchstart", interacted);
      window.removeEventListener("focus", interacted);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
  return null;
}
