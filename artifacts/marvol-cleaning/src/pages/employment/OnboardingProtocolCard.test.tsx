import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OnboardingProtocolCard } from "./OnboardingProtocolCard";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

test("onboarding protocol exposes protected view/print and download links with proposed status", () => {
  render(<OnboardingProtocolCard />);
  const open = screen.getByTestId("open-onboarding-protocol");
  expect(open.getAttribute("href")).toBe("/api/onboarding-protocol");
  expect(open.getAttribute("target")).toBe("_blank");
  expect(screen.getByTestId("download-onboarding-protocol").getAttribute("href")).toBe("/api/onboarding-protocol?download=1");
  expect(screen.getByTestId("onboarding-protocol-status").textContent).toBe("employment.onboarding.protocol.status");
});

test("Onboarding links to the forms index and lets staff open Forms", () => {
  const onOpenForms = vi.fn();
  render(<OnboardingProtocolCard canEmailProtocol onOpenForms={onOpenForms} />);

  expect(screen.getByTestId("open-onboarding-forms-index").getAttribute("href"))
    .toBe("/api/employment-forms/onboarding-index");
  expect(screen.getByTestId("download-onboarding-forms-index").getAttribute("href"))
    .toBe("/api/employment-forms/onboarding-index?download=1");
  expect(screen.getByTestId("onboarding-forms-index-email")).toBeTruthy();
  expect(screen.getByTestId("onboarding-forms-index-print-open")).toBeTruthy();
  fireEvent.click(screen.getByTestId("browse-onboarding-forms"));
  expect(onOpenForms).toHaveBeenCalledOnce();
});
