import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfidentialAccessProvider } from "./ConfidentialAccessContext";
import { ConfidentialBoundary } from "@/components/confidential/ConfidentialBoundary";

const m = vi.hoisted(() => ({
  actor: { currentUser: { id: 1 } as { id: number } | null, effectiveRole: "admin" },
  status: vi.fn(), configure: vi.fn(), unlock: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => m.actor }));
vi.mock("./AuthContext", () => ({ useAuth: () => m.actor }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }) }));
vi.mock("@workspace/api-client-react", () => ({
  getConfidentialAccess: m.status, configureConfidentialCode: m.configure,
  unlockConfidentialAccess: m.unlock, lockConfidentialAccess: m.lock,
}));

const iso = (ms: number) => new Date(ms).toISOString();
const st = (o: object = {}) => ({ configured: true, unlocked: false, expiresAt: null, lockedUntil: null, serverTime: iso(Date.now()), ...o });
const open = (ms = 1800000) => st({ unlocked: true, expiresAt: iso(Date.now() + ms) });
const defer = <T,>() => { let res!: (v: T) => void, rej!: (e: unknown) => void; const p = new Promise<T>((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

function App() {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}><ConfidentialAccessProvider><ConfidentialBoundary><div data-testid="private">secret</div></ConfidentialBoundary></ConfidentialAccessProvider></QueryClientProvider>;
}
const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

beforeEach(() => { vi.clearAllMocks(); m.actor.currentUser = { id: 1 }; m.actor.effectiveRole = "admin"; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("setup requires matching confirmation, then unlocks", async () => {
  m.status.mockResolvedValue(st({ configured: false }));
  m.configure.mockResolvedValue(open());
  render(<App />);
  await screen.findByText("confidential.setupTitle");
  type("confidential.newCode", "48201937"); type("confidential.confirmCode", "48201938");
  fireEvent.click(screen.getByText("confidential.setupAction"));
  expect((await screen.findByRole("alert")).textContent).toBe("confidential.errors.mismatch");
  expect(m.configure).not.toHaveBeenCalled();
  type("confidential.confirmCode", "48201937");
  fireEvent.click(screen.getByText("confidential.setupAction"));
  expect(await screen.findByTestId("private")).toBeTruthy();
  expect(m.configure).toHaveBeenCalledWith({ code: "48201937", confirmation: "48201937" });
});

test("wrong code shows error, then retry unlocks", async () => {
  m.status.mockResolvedValue(st());
  m.unlock.mockRejectedValueOnce({ data: { code: "CONFIDENTIAL_CODE_WRONG" } }).mockResolvedValueOnce(open());
  render(<App />);
  await screen.findByText("confidential.unlockTitle");
  type("confidential.code", "11223344"); fireEvent.click(screen.getByText("confidential.unlockAction"));
  expect((await screen.findByRole("alert")).textContent).toBe("confidential.errors.CONFIDENTIAL_CODE_WRONG");
  expect(screen.queryByTestId("private")).toBeNull();
  type("confidential.code", "55667788"); fireEvent.click(screen.getByText("confidential.unlockAction"));
  expect(await screen.findByTestId("private")).toBeTruthy();
});

test("load failure offers retry", async () => {
  m.status.mockRejectedValueOnce({ data: { code: "CONFIDENTIAL_UNAVAILABLE" } }).mockResolvedValue(open());
  render(<App />);
  fireEvent.click(await screen.findByText("confidential.retry"));
  expect(await screen.findByTestId("private")).toBeTruthy();
});

test("manual lock hides synchronously and stays locked when revoke is pending or rejected", async () => {
  m.status.mockResolvedValue(open());
  const d = defer<unknown>(); m.lock.mockReturnValueOnce(d.p);
  render(<App />);
  await screen.findByTestId("private");
  fireEvent.click(screen.getByText("confidential.lockNow"));
  expect(screen.queryByTestId("private")).toBeNull();
  await act(async () => { d.rej(new Error("offline")); });
  expect(screen.queryByTestId("private")).toBeNull();
  // a later poll still reports unlocked: stay hidden and retry revocation
  m.lock.mockResolvedValueOnce(st());
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(m.lock).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("private")).toBeNull();
});

test("expiry unmounts private view", async () => {
  m.status.mockResolvedValue(open(300));
  render(<App />);
  await screen.findByTestId("private");
  await waitFor(() => expect(screen.queryByTestId("private")).toBeNull(), { timeout: 2000 });
});

test("role and identity change reset immediately; non-admin never renders", async () => {
  m.status.mockResolvedValue(open());
  const { rerender } = render(<App />);
  await screen.findByTestId("private");
  m.actor.effectiveRole = "supervisor"; rerender(<App />);
  expect(screen.queryByTestId("private")).toBeNull();
  m.actor.effectiveRole = "admin"; m.actor.currentUser = { id: 2 }; rerender(<App />);
  expect(screen.queryByTestId("private")).toBeNull();
  await screen.findByTestId("private");
});

test("stale poll cannot overwrite a newer unlock", async () => {
  const poll = defer<unknown>();
  m.status.mockResolvedValueOnce(st()).mockReturnValueOnce(poll.p).mockResolvedValue(st());
  m.unlock.mockResolvedValue(open());
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<App />);
  await screen.findByText("confidential.unlockTitle");
  await act(async () => { vi.advanceTimersByTime(15000); });
  type("confidential.code", "55667788"); fireEvent.click(screen.getByText("confidential.unlockAction"));
  await screen.findByTestId("private");
  await act(async () => { poll.res(st()); });
  expect(screen.getByTestId("private")).toBeTruthy();
});
