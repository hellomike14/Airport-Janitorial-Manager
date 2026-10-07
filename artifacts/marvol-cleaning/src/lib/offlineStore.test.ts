import { beforeEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({
  put: vi.fn(), get: vi.fn(), getAll: vi.fn(), delete: vi.fn(),
}));
vi.mock("idb", () => ({ openDB: vi.fn(async () => mock) }));
import { cacheApiResponse, getCachedApiResponse, getAllCachedResponses, isConfidentialCacheUrl } from "./offlineStore";
beforeEach(() => { vi.clearAllMocks(); });
test("confidential responses and legacy contact rosters never enter offline storage", async () => {
  for (const endpoint of ["staff", "staff/confidential", "staff/former", "applications", "applications/17", "employment-form-submissions", "employment-form-submissions/17", "confidential-access/status", "quickbooks/status", "auth-diagnostics", "identity-documents", "employment-forms/i-9"]) {
    const key = JSON.stringify([`/api/${endpoint}`]);
    expect(isConfidentialCacheUrl(key)).toBe(true);
    await cacheApiResponse(key, { private: true });
    expect(await getCachedApiResponse(key)).toBeNull();
  }
  for (const url of [
    "/storage/objects/uploads/completed/snapshot",
    "/api/storage/objects/uploads/temporary",
    "/storage/objects/uploads/354716d4-2967-439f-a9f3-ac4bf6ad01e8",
    "/storage/objects/hr-identity/original/photo",
  ]) expect(isConfidentialCacheUrl(url)).toBe(true);
  expect(mock.put).not.toHaveBeenCalled();
  expect(mock.get).not.toHaveBeenCalled();
  await cacheApiResponse("/api/tasks", [{ id: 1 }]);
  expect(mock.put).toHaveBeenCalledOnce();
});
test("hydration removes old confidential entries but keeps operational tasks and photos", async () => {
  const privateEntry = { url: JSON.stringify(["/api/staff"]), data: { email: "synthetic@example.invalid" }, timestamp: 1 };
  const taskEntry = { url: JSON.stringify(["/api/tasks"]), data: [{ id: 1 }], timestamp: 1 };
  mock.getAll.mockResolvedValue([privateEntry, taskEntry]);
  expect(await getAllCachedResponses()).toEqual([taskEntry]);
  expect(mock.delete).toHaveBeenCalledWith("apiCache", privateEntry.url);
  expect(isConfidentialCacheUrl("/api/photo-shares")).toBe(false);
});
