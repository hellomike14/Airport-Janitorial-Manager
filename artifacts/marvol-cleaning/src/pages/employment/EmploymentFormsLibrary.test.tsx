import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmploymentFormsLibrary } from "./EmploymentFormsLibrary";
import { onboardingForms, onboardingIndex } from "./onboardingFormCatalog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ effectiveRole: "staff" }) }));

afterEach(cleanup);

test("anonymous applicants see only the three allowlisted forms without export or email actions", () => {
  render(<EmploymentFormsLibrary variant="applicant" />);
  expect(screen.getByText("employment.apply.blankTemplates")).toBeTruthy();
  expect(screen.queryByText("employment.forms.emailDestination")).toBeNull();
  for (const id of ["job-application", "i-9", "w-4"]) {
    expect(screen.getByTestId(`fill-online-${id}`)).toBeTruthy();
    expect(screen.queryByTestId(`open-${id}`)).toBeNull();
    expect(screen.queryByTestId(`download-${id}`)).toBeNull();
    expect(screen.queryByTestId(`blank-form-${id}-email`)).toBeNull();
    expect(screen.queryByTestId(`blank-form-${id}-print-open`)).toBeNull();
  }
  for (const form of onboardingForms) {
    expect(screen.queryByTestId(`form-card-${form.id}`)).toBeNull();
  }
  expect(screen.queryByTestId(`fill-online-${onboardingIndex.id}`)).toBeNull();
});

test("promoted new hires see only candidate onboarding forms, not the applicant packet or restricted templates", () => {
  render(<EmploymentFormsLibrary variant="new-hire" candidate={{
    firstName: "Candidate", lastName: "Example", email: "candidate@example.invalid", phone: null,
  }} />);
  for (const id of [
    "i-9", "w-4", "offer-acceptance", "emergency-contact", "language-accessibility",
    "orientation-acknowledgment", "video-attestation", "knowledge-check", "badge-rules-acknowledgment",
  ]) {
    expect(screen.getByTestId(`fill-online-${id}`)).toBeTruthy();
  }
  expect(screen.queryByTestId("fill-online-job-application")).toBeNull();
  expect(screen.queryByTestId(`form-card-${onboardingIndex.id}`)).toBeNull();
  for (const form of onboardingForms.filter(candidate => candidate.restricted)) {
    expect(screen.queryByTestId(`form-card-${form.id}`)).toBeNull();
  }
});
