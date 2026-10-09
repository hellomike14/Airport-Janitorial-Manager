import { describe, expect, it } from "vitest";
import {
  groupManagementNavItems,
  openActiveManagementSection,
  shouldGroupManagementMenu,
} from "./managementMenu";

const adminRoutes = [
  "/", "/tasks", "/messages", "/task-types", "/areas", "/assignments", "/staff",
  "/issues", "/report", "/gps-tracking", "/operations", "/employee-portal",
  "/photo-share", "/weekly-report", "/special-requests", "/employment",
];

const supervisorRoutes = [
  "/", "/tasks", "/messages", "/areas", "/assignments", "/staff", "/issues",
  "/report", "/operations", "/employee-portal", "/photo-share", "/special-requests",
  "/employment",
];

const navItems = (routes: string[]) => routes.map((href) => ({ href, label: href }));
const groupRoutes = (routes: string[]) =>
  groupManagementNavItems(navItems(routes)).map((group) => ({
    id: group.id,
    hrefs: group.items.map((item) => item.href),
  }));

describe("management menu grouping", () => {
  it("groups every admin link in the requested order", () => {
    expect(groupRoutes(adminRoutes)).toEqual([
      { id: "operation", hrefs: ["/", "/operations", "/tasks", "/task-types", "/areas", "/assignments", "/gps-tracking", "/messages"] },
      { id: "quality", hrefs: ["/issues", "/report", "/photo-share", "/weekly-report", "/special-requests"] },
      { id: "business", hrefs: ["/staff", "/employee-portal", "/employment"] },
    ]);
  });

  it("groups only supervisor links already permitted to that role", () => {
    expect(groupRoutes(supervisorRoutes)).toEqual([
      { id: "operation", hrefs: ["/", "/operations", "/tasks", "/areas", "/assignments", "/messages"] },
      { id: "quality", hrefs: ["/issues", "/report", "/photo-share", "/special-requests"] },
      { id: "business", hrefs: ["/staff", "/employee-portal", "/employment"] },
    ]);
  });

  it("leaves staff and inspector menus ungrouped", () => {
    expect(shouldGroupManagementMenu("admin")).toBe(true);
    expect(shouldGroupManagementMenu("supervisor")).toBe(true);
    expect(shouldGroupManagementMenu("staff")).toBe(false);
    expect(shouldGroupManagementMenu("inspector")).toBe(false);
  });

  it("fails explicitly if a management route has no section", () => {
    expect(() => groupManagementNavItems([{ href: "/new-management-page" }])).toThrow(
      "/new-management-page",
    );
  });

  it("reopens the section containing the active route without changing other sections", () => {
    const current = { operation: false, quality: false, business: true };
    expect(openActiveManagementSection(current, "quality")).toEqual({
      operation: false,
      quality: true,
      business: true,
    });
  });
});
