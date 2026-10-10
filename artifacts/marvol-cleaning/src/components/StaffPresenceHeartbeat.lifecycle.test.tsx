// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postPresence } = vi.hoisted(() => ({ postPresence: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ postStaffPresenceActivity: postPresence }));

import { PRESENCE_HEARTBEAT_MS, PRESENCE_IDLE_MS, StaffPresenceHeartbeat } from "./StaffPresenceHeartbeat";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function interact() {
  await act(async () => {
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
  });
}

describe("StaffPresenceHeartbeat lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    postPresence.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not spin zero-delay timers while a slow heartbeat is pending and cleans up on unmount", async () => {
    let resolveRequest!: () => void;
    postPresence.mockImplementation(() => new Promise<void>(resolve => { resolveRequest = resolve; }));
    const view = render(<StaffPresenceHeartbeat enabled />);
    await interact();
    expect(postPresence).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS); });
    expect(postPresence).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    resolveRequest();
    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2); });
    expect(postPresence).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops scheduled heartbeats while hidden and after the idle window", async () => {
    render(<StaffPresenceHeartbeat enabled />);
    await interact();
    expect(postPresence).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(PRESENCE_IDLE_MS + PRESENCE_HEARTBEAT_MS); });
    expect(postPresence).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await interact();
    expect(postPresence).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(PRESENCE_IDLE_MS + 1); });
    const callsAfterIdle = postPresence.mock.calls.length;
    act(() => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2); });
    expect(postPresence).toHaveBeenCalledTimes(callsAfterIdle);
    expect(vi.getTimerCount()).toBe(0);
  });
});
