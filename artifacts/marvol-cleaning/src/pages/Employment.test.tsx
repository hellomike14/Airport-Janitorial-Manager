import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Employment from "./Employment";

const actor = vi.hoisted(() => ({ effectiveRole: "admin" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => actor }));
vi.mock("@/components/confidential/ConfidentialBoundary", () => ({
  ConfidentialBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./employment/ApplicationsTab", () => ({
  ApplicationsTab: () => <div data-testid="applications-panel" />,
}));
vi.mock("./employment/OnboardingTab", () => ({
  OnboardingTab: () => <div data-testid="onboarding-panel" />,
}));
vi.mock("./employment/QuickBooksTab", () => ({
  QuickBooksTab: () => <div data-testid="quickbooks-panel" />,
}));

beforeEach(() => {
  actor.effectiveRole = "admin";
  window.history.replaceState(null, "", "/employment");
});
afterEach(cleanup);

test("admins can open Forms and its selection is retained on reload", () => {
  const view = render(<Employment />);
  fireEvent.click(screen.getByTestId("employment-tab-forms"));
  expect(screen.getByTestId("employment-forms")).toBeTruthy();
  expect(screen.getByTestId("open-job-application").getAttribute("href")).toBe("/api/employment-forms/job-application");
  expect(screen.getByTestId("download-job-application").getAttribute("href")).toBe("/api/employment-forms/job-application?download=1");
  for (const id of ["job-application", "i-9", "w-4"]) {
    expect(screen.getByTestId(`fillable-${id}`).textContent).toBe("employment.forms.fillable");
    expect(screen.getByTestId(`open-${id}`).getAttribute("href")).toBe(`/api/employment-forms/${id}`);
    expect(screen.getByTestId(`download-${id}`).getAttribute("href")).toBe(`/api/employment-forms/${id}?download=1`);
  }
  expect(screen.getByTestId("employment-tab-forms").getAttribute("aria-pressed")).toBe("true");
  expect(new URLSearchParams(window.location.search).get("tab")).toBe("forms");
  expect(screen.queryByTestId("applications-panel")).toBeNull();
  view.unmount();
  render(<Employment />);
  expect(screen.getByTestId("employment-forms")).toBeTruthy();
});

test("supervisors cannot open Forms directly", () => {
  actor.effectiveRole = "supervisor";
  window.history.replaceState(null, "", "/employment?tab=forms");
  render(<Employment />);
  expect(screen.queryByTestId("employment-forms")).toBeNull();
  expect(screen.queryByTestId("employment-tab-forms")).toBeNull();
  expect(screen.getByTestId("onboarding-panel")).toBeTruthy();
});

vi.mock("./employment/IdentityDocuments", () => ({
  default: () => <div data-testid="identity-documents" />,
}));

test("staff remain on onboarding without HR form or photograph access", () => {
  actor.effectiveRole = "staff";
  render(<Employment />);
  expect(screen.getByTestId("onboarding-panel")).toBeTruthy();
  expect(screen.queryByTestId("employment-tab-applications")).toBeNull();
  expect(screen.queryByTestId("employment-tab-quickbooks")).toBeNull();
  expect(screen.queryByTestId("employment-tab-forms")).toBeNull();
  expect(screen.queryByTestId("identity-documents")).toBeNull();
  expect(screen.queryByTestId("open-i-9")).toBeNull();
});

test("staff cannot reach Forms with explicit tab=forms", () => {
  actor.effectiveRole = "staff";
  window.history.replaceState(null, "", "/employment?tab=forms");
  render(<Employment />);
  expect(screen.queryByTestId("identity-documents")).toBeNull();
  expect(screen.getByTestId("onboarding-panel")).toBeTruthy();
});

test("inspectors cannot open Forms", () => {
  actor.effectiveRole = "inspector";
  window.history.replaceState(null, "", "/employment?tab=forms");
  render(<Employment />);
  expect(screen.queryByTestId("employment-tab-forms")).toBeNull();
  expect(screen.queryByTestId("employment-forms")).toBeNull();
  expect(screen.queryByTestId("identity-documents")).toBeNull();
});
