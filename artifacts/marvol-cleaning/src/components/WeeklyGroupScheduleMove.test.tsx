import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WeeklyGroupScheduleMove } from "./WeeklyGroupScheduleMove";

const fixtures = vi.hoisted(() => ({
  review: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  previewTerminalGroupScheduleMove: fixtures.review,
  useMoveTerminalGroupSchedule: (options: { mutation: { onSuccess: (value: { movedCount: number }) => void; onError: (error: { status: number }) => void } }) => ({
    isPending: false,
    mutate: (data: unknown) => fixtures.mutate(data, options.mutation),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, args?: { count?: number }) => args?.count === undefined ? key : `${key}:${args.count}` }),
}));

const groups = [["terminal-a-east", "terminal-a-east"]] as const;
const staff = [{ id: 99, name: "Target A" }, { id: 100, name: "Target B" }];
const row = { id: 1, staffId: 11, staffName: "Original", areaId: 3, areaName: "East wing", dayOfWeek: 1, startTime: "06:15", endTime: "13:45" };
const response = (snapshot: string, conflict = false) => ({ snapshot, rows: [row], conflict });
const openForm = () => {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<QueryClientProvider client={queryClient}><WeeklyGroupScheduleMove groups={groups} staff={staff} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "assignments.weeklyAction" }));
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: "terminal-a-east" } });
  fireEvent.change(selects[1], { target: { value: "99" } });
  return { selects, invalidate };
};
const review = async () => {
  fireEvent.click(screen.getByRole("button", { name: "assignments.weeklyReview" }));
  await screen.findByText(/Original → Target A/);
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test("preview shows actual shifts, confirms the reviewed snapshot, and reports success", async () => {
  fixtures.review.mockResolvedValue(response("snapshot-1"));
  const { invalidate } = openForm();
  await review();
  expect(screen.getByText(/East wing · 06:15–13:45/)).toBeTruthy();
  const confirm = screen.getByRole("button", { name: "assignments.weeklyConfirm" });
  fireEvent.click(confirm);
  expect(fixtures.mutate).toHaveBeenCalledWith({
    data: { groupKey: "terminal-a-east", staffId: 99, snapshot: "snapshot-1" },
  }, expect.any(Object));
  fixtures.mutate.mock.calls[0][1].onSuccess({ movedCount: 1 });
  await waitFor(() => expect(screen.queryByRole("button", { name: "assignments.weeklyConfirm" })).toBeNull());
  expect(screen.getByRole("status").textContent).toContain("assignments.weeklyMoved:1");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/schedules"] });
});

test("overlap disables confirmation; a 409 removes stale review and requires reviewing again", async () => {
  fixtures.review.mockResolvedValueOnce(response("overlap", true)).mockResolvedValueOnce(response("fresh"));
  openForm();
  await review();
  expect(screen.getByRole("alert").textContent).toBe("assignments.weeklyDuplicate");
  expect((screen.getByRole("button", { name: "assignments.weeklyConfirm" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "assignments.weeklyReview" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "assignments.weeklyConfirm" }));
  fixtures.mutate.mock.calls[0][1].onError({ status: 409 });
  await waitFor(() => expect(screen.queryByRole("button", { name: "assignments.weeklyConfirm" })).toBeNull());
  expect(screen.getByRole("alert").textContent).toBe("assignments.weeklyConflict");
});

test("changing target invalidates a reviewed preview before confirmation", async () => {
  fixtures.review.mockResolvedValue(response("old"));
  const { selects } = openForm();
  await review();
  fireEvent.change(selects[1], { target: { value: "100" } });
  expect(screen.queryByRole("button", { name: "assignments.weeklyConfirm" })).toBeNull();
  expect(fixtures.mutate).not.toHaveBeenCalled();
});