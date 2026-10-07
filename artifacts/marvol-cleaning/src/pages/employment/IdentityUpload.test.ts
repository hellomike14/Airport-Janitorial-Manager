import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { uploadIdentityPhoto, identityFileType } from "../../../../../lib/api-client-react/src/identity-documents-extras";

const state = vi.hoisted(() => ({ fetch: vi.fn(), failure: false, sends: 0 }));
vi.mock("../../../../../lib/api-client-react/src/custom-fetch", () => ({ customFetch: state.fetch }));

class UploadXHR {
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 200;
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  open() {}
  setRequestHeader() {}
  send() {
    state.sends++;
    queueMicrotask(() => {
      if (state.failure) this.onerror?.();
      else { this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 }); this.onload?.(); }
    });
  }
  abort() { this.onabort?.(); }
}
const input = { hireId: 3, category: "identity" as const, side: "front" as const, replacesId: null };
const file = () => new File(["synthetic"], "private-local-name.jpg", { type: "image/jpeg" });
beforeEach(() => {
  state.fetch.mockReset(); state.failure = false; state.sends = 0;
  vi.stubGlobal("XMLHttpRequest", UploadXHR);
  state.fetch.mockImplementation(async (url: string) => url.endsWith("/uploads") ? { id: "synthetic-ticket", uploadURL: "https://example.invalid/synthetic-upload" } : { id: "synthetic-ticket", status: "uploaded" });
});
afterEach(() => vi.unstubAllGlobals());

test("no transfer occurs before submit, and source filename never enters request metadata", async () => {
  expect(state.sends).toBe(0);
  const onProgress = vi.fn();
  await uploadIdentityPhoto(input, file(), { onProgress });
  expect(state.sends).toBe(1);
  const options = state.fetch.mock.calls[0][1];
  expect(options.body).not.toContain("private-local-name");
  expect(onProgress.mock.calls.map(call => call[0])).toEqual([90, 95, 100]);
});
test("uncertain completion retries the SAME ticket rather than replacing again", async () => {
  let commits = 0;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/uploads")) return { id: "synthetic-ticket", uploadURL: "https://example.invalid/synthetic-upload" };
    if (url.endsWith("/complete") && ++commits === 1) throw Object.assign(Error("Unavailable"), { status: 503 });
    return { id: "synthetic-ticket", status: "uploaded" };
  });
  await uploadIdentityPhoto(input, file());
  expect(commits).toBe(2);
  expect(state.fetch.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(3);
  expect(state.fetch.mock.calls.some(call => call[1]?.method === "DELETE")).toBe(false);
});
test("transfer failure cancels only the pending ticket and stays actionable for retry", async () => {
  state.failure = true;
  await expect(uploadIdentityPhoto(input, file())).rejects.toThrow("Check your connection and retry");
  expect(state.fetch.mock.calls.some(call => call[0].endsWith("/complete"))).toBe(false);
  expect(state.fetch).toHaveBeenLastCalledWith(expect.stringContaining("/uploads/synthetic-ticket"), { method: "DELETE" });
});
test("4xx validation failures do not retry completion or claim upload success", async () => {
  let commits = 0;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/uploads")) return { id: "synthetic-ticket", uploadURL: "https://example.invalid/synthetic-upload" };
    if (url.endsWith("/complete")) { commits++; throw Object.assign(Error("Invalid photograph"), { status: 400 }); }
    return { success: true };
  });
  await expect(uploadIdentityPhoto(input, file())).rejects.toThrow("Invalid photograph");
  expect(commits).toBe(1);
});
test("phone HEIC without MIME is recognized; arbitrary files and oversized transfers are rejected", async () => {
  expect(identityFileType(new File(["synthetic"], "phone.heic"))).toBe("image/heic");
  expect(() => identityFileType(new File(["synthetic"], "not-an-image.svg"))).toThrow();
  await expect(uploadIdentityPhoto(input, new File([new Uint8Array(8388609)], "large.jpg", { type: "image/jpeg" }))).rejects.toThrow("8 MB");
  expect(state.fetch).not.toHaveBeenCalled();
});
