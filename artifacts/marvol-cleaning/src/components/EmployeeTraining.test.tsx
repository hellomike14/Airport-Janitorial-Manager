import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ManagerReview } from "./EmployeeTraining";

const fixture = vi.hoisted(() => ({
  data: {
    training: { version: "fixture-version" },
    employees: [
      { staffId: 1, name: "Current fixture", active: true, formerEmployee: false, status: "pending", watchedSeconds: 0, acknowledgment: null, history: [] },
      { staffId: 2, name: "Former fixture", active: true, formerEmployee: true, status: "completed", watchedSeconds: 10, acknowledgment: null, history: [] },
      { staffId: 3, name: "Inactive current fixture", active: false, formerEmployee: false, status: "pending", watchedSeconds: 0, acknowledgment: null, history: [] },
      { staffId: 4, name: "Inactive former fixture", active: false, formerEmployee: true, status: "pending", watchedSeconds: 0, acknowledgment: null, history: [] },
    ],
  },
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: fixture.data, isLoading: false, isError: false }) }));
vi.mock("@workspace/api-client-react", () => ({ getGetEmployeeTrainingReviewQueryKey: () => ["fixture-review"] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
afterEach(cleanup);

test("training review excludes all former employees, including stale cached results", () => {
  render(<ManagerReview />);
  expect(screen.getByTestId("row-review-1")).toBeTruthy();
  expect(screen.getByTestId("row-review-3")).toBeTruthy();
  expect(screen.queryByTestId("row-review-2")).toBeNull();
  expect(screen.queryByTestId("row-review-4")).toBeNull();
  expect(screen.queryByText("Former fixture")).toBeNull();
  expect(screen.queryByText("Inactive former fixture")).toBeNull();
});
