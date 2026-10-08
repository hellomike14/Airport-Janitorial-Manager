import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmploymentFormsLibrary } from "./EmploymentFormsLibrary";
import { onboardingForms, onboardingIndex } from "./onboardingFormCatalog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ effectiveRole: "staff" }) }));

afterEach(cleanup);

test("the public applicant form library offers the original forms and every unrestricted onboarding PDF", () => {
  render(<EmploymentFormsLibrary variant="applicant" />);
  expect(screen.getByText("employment.apply.blankTemplates")).toBeTruthy();
  expect(screen.getByText("employment.forms.emailDestination")).toBeTruthy();
  const unrestrictedForms = onboardingForms.filter(form => !form.restricted);
  for (const id of ["job-application", "i-9", "w-4", ...unrestrictedForms.map(form => form.id)]) {
    expect(screen.getByTestId(`fill-online-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`open-${id}`).getAttribute("href")).toBe(`/api/employment-forms/${id}`);
    expect(screen.getByTestId(`download-${id}`).getAttribute("href")).toBe(`/api/employment-forms/${id}?download=1`);
    expect(screen.getByTestId(`blank-form-${id}-email`)).toBeTruthy();
    expect(screen.getByTestId(`blank-form-${id}-print-open`)).toBeTruthy();
  }
  for (const form of onboardingForms.filter(candidate => candidate.restricted)) {
    expect(screen.queryByTestId(`form-card-${form.id}`)).toBeNull();
  }
  expect(screen.getByTestId(`open-${onboardingIndex.id}`).getAttribute("href"))
    .toBe(`/api/employment-forms/${onboardingIndex.id}`);
  expect(screen.getByTestId(`download-${onboardingIndex.id}`).getAttribute("href"))
    .toBe(`/api/employment-forms/${onboardingIndex.id}?download=1`);
  expect(screen.getByTestId(`blank-form-${onboardingIndex.id}-email`)).toBeTruthy();
  expect(screen.getByTestId(`blank-form-${onboardingIndex.id}-print-open`)).toBeTruthy();
  expect(screen.queryByTestId(`fill-online-${onboardingIndex.id}`)).toBeNull();
});
