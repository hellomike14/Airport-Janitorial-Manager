import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmploymentFormsLibrary } from "./EmploymentFormsLibrary";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

test("the public applicant form library offers all three editable and downloadable blank forms", () => {
  render(<EmploymentFormsLibrary variant="applicant" />);
  expect(screen.getByText("employment.apply.blankTemplates")).toBeTruthy();
  expect(screen.getByText("employment.forms.emailDestination")).toBeTruthy();
  for (const id of ["job-application", "i-9", "w-4"]) {
    expect(screen.getByTestId(`fill-online-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`open-${id}`).getAttribute("href")).toBe(`/api/employment-forms/${id}`);
    expect(screen.getByTestId(`download-${id}`).getAttribute("href")).toBe(`/api/employment-forms/${id}?download=1`);
    expect(screen.getByTestId(`blank-form-${id}-email`)).toBeTruthy();
    expect(screen.getByTestId(`blank-form-${id}-print-open`)).toBeTruthy();
  }
});
