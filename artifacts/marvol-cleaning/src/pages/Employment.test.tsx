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
  OnboardingTab: () => <div data-testid="onboarding-panel"><div data-testid="employee-training-panel" /></div>,
}));
vi.mock("./employment/QuickBooksTab", () => ({
  QuickBooksTab: () => <div data-testid="quickbooks-panel" />,
}));
vi.mock("./employment/EmploymentFormSubmissionsTab", () => ({
  EmploymentFormSubmissionsTab: () => <div data-testid="submitted-forms-panel" />,
}));
vi.mock("./employment/EmploymentFormReviewMetadataTab", () => ({
  EmploymentFormReviewMetadataTab: () => <div data-testid="employee-form-review-metadata" />,
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

vi.mock("./employment/IdentityDocuments", () => ({
  default: () => <div data-testid="identity-documents" />,
}));

test("all signed-in roles can open blank Forms without seeing Admin submissions or identity photos", () => {
  for (const role of ["staff", "supervisor", "inspector"]) {
    cleanup();
    actor.effectiveRole = role;
    window.history.replaceState(null, "", "/employment?tab=forms");
    render(<Employment />);
    expect(screen.getByTestId("employment-forms")).toBeTruthy();
    expect(screen.getByTestId("fill-online-i-9")).toBeTruthy();
    expect(screen.queryByTestId("employment-tab-applications")).toBeNull();
    expect(screen.queryByTestId("employment-tab-submitted-forms")).toBeNull();
    expect(screen.queryByTestId("submitted-forms-panel")).toBeNull();
    expect(screen.queryByTestId("identity-documents")).toBeNull();
  }
});

test("all active staff roles, including inspectors and employee administrators, can open Onboarding and see their own training", () => {
  for (const role of ["admin", "supervisor", "staff", "inspector", "employee_administrator"]) {
    cleanup();
    actor.effectiveRole = role;
    window.history.replaceState(null, "", "/employment?tab=onboarding");
    render(<Employment />);
    expect(screen.getByTestId("employment-tab-onboarding")).toBeTruthy();
    expect(screen.getByTestId("employment-tab-onboarding").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("onboarding-panel")).toBeTruthy();
    expect(screen.getByTestId("employee-training-panel")).toBeTruthy();
  }
});

test("employee administrators see review metadata only, not submitted files or identity documents", () => {
  actor.effectiveRole = "employee_administrator";
  window.history.replaceState(null, "", "/employment?tab=submitted-forms");
  render(<Employment />);
  expect(screen.getByTestId("employee-form-review-metadata")).toBeTruthy();
  expect(screen.queryByTestId("submitted-forms-panel")).toBeNull();
  expect(screen.queryByTestId("identity-documents")).toBeNull();
  expect(screen.queryByTestId("employment-tab-applications")).toBeNull();
  expect(screen.queryByTestId("employment-tab-quickbooks")).toBeNull();
});

test("admins keep completed-form review and identity photos in a separate confidential tab", () => {
  actor.effectiveRole = "admin";
  window.history.replaceState(null, "", "/employment?tab=submitted-forms");
  render(<Employment />);
  expect(screen.getByTestId("submitted-forms-panel")).toBeTruthy();
  expect(screen.getByTestId("identity-documents")).toBeTruthy();
  expect(screen.queryByTestId("employment-forms")).toBeNull();
});
