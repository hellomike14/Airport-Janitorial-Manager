export type ManagementMenuSectionId = "operation" | "quality" | "business";
export type ManagementMenuViewMode = "admin" | "supervisor" | "staff" | "inspector";

export const MANAGEMENT_MENU_SECTIONS: readonly {
  id: ManagementMenuSectionId;
  hrefs: readonly string[];
}[] = [
  {
    id: "operation",
    hrefs: ["/", "/operations", "/tasks", "/task-types", "/areas", "/assignments", "/gps-tracking", "/messages"],
  },
  {
    id: "quality",
    hrefs: ["/issues", "/report", "/photo-share", "/weekly-report", "/special-requests"],
  },
  {
    id: "business",
    hrefs: ["/staff", "/employee-portal", "/employment"],
  },
];

export function shouldGroupManagementMenu(viewMode: ManagementMenuViewMode): boolean {
  return viewMode === "admin" || viewMode === "supervisor";
}

export function groupManagementNavItems<T extends { href: string }>(items: readonly T[]) {
  const groups = MANAGEMENT_MENU_SECTIONS.map(({ id, hrefs }) => ({
    id,
    items: hrefs.flatMap((href) => items.filter((item) => item.href === href)),
  })).filter((group) => group.items.length > 0);

  const groupedHrefs = new Set(groups.flatMap((group) => group.items.map((item) => item.href)));
  const ungroupedItems = items.filter((item) => !groupedHrefs.has(item.href));
  if (ungroupedItems.length > 0) {
    throw new Error(`Management navigation items need a section: ${ungroupedItems.map((item) => item.href).join(", ")}`);
  }

  return groups;
}

export function openActiveManagementSection(
  openSections: Record<ManagementMenuSectionId, boolean>,
  activeSection: ManagementMenuSectionId | null,
): Record<ManagementMenuSectionId, boolean> {
  if (activeSection === null || openSections[activeSection]) return openSections;
  return { ...openSections, [activeSection]: true };
}
