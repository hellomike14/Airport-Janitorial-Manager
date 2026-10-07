import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
