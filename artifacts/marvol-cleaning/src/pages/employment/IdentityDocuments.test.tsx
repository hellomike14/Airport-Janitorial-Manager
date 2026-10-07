import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import IdentityDocuments from "./IdentityDocuments";

const state = vi.hoisted(() => ({
  actor: { currentUser: { id: 1 }, effectiveRole: "staff" },
  context: vi.fn(), photos: vi.fn(), link: vi.fn(), upload: vi.fn(), review: vi.fn(), blob: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.actor }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@workspace/api-client-react", () => ({
  getIdentityContext: state.context, getIdentityPhotos: state.photos,
  linkIdentityHire: state.link, uploadIdentityPhoto: state.upload,
  reviewIdentityPhoto: state.review, getIdentityPhotoBlob: state.blob,
  IDENTITY_MAX_BYTES: 8 * 1024 * 1024,
  identityFileType: (file: File) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type)) throw Error("type");
    return file.type;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.actor.currentUser = { id: 1 }; state.actor.effectiveRole = "admin";
  state.context.mockResolvedValue({
    canManage: true, hires: [{ id: 9, name: "Synthetic hire", staffId: 1, staffName: "Synthetic employee" }],
    employees: [], maxBytes: 8388608, acceptedTypes: ["image/jpeg"],
  });
  state.photos.mockResolvedValue({ photos: [], events: [] });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  URL.createObjectURL = vi.fn(() => "blob:synthetic-private-preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function selectHire() {
  fireEvent.change(await screen.findByTestId("identity-hire-select"), { target: { value: "9" } });
}

test("staff, supervisors and inspectors cannot mount or request identity photographs", () => {
  for (const role of ["staff", "supervisor", "inspector"]) {
    state.actor.effectiveRole = role;
    const view = render(<IdentityDocuments />);
    expect(screen.queryByTestId("identity-documents")).toBeNull();
    view.unmount();
  }
  expect(state.context).not.toHaveBeenCalled();
});

test("unlinked hires require explicit admin linking before uploads", async () => {
  state.context.mockResolvedValue({ canManage: true, hires: [{ id: 9, name: "Synthetic hire", staffId: null }], employees: [] });
  render(<IdentityDocuments />);
  await selectHire();
  await screen.findByTestId("identity-link-panel");
  expect(screen.queryByTestId("input-upload-identity-front")).toBeNull();
  expect(state.photos).not.toHaveBeenCalled();
});

test("mobile capture is rear-camera preference and file upload never requests capture", async () => {
  render(<IdentityDocuments />);
  await selectHire();
  const camera = await screen.findByTestId("input-camera-identity-front");
  expect(camera.getAttribute("capture")).toBe("environment");
  expect(screen.getByTestId("input-upload-identity-front").getAttribute("capture")).toBeNull();
  expect(state.upload).not.toHaveBeenCalled();
  expect(screen.getByTestId("identity-i9-notice")).toBeTruthy();
});

test("desktop keeps normal file selection without camera capture", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  render(<IdentityDocuments />);
  await selectHire();
  await screen.findByTestId("input-upload-identity-front");
  expect(screen.queryByTestId("take-identity-front")).toBeNull();
  expect(screen.queryByTestId("input-camera-identity-front")).toBeNull();
});

test("preview, retake/cancel, size/type validation and error retry are deliberate", async () => {
  render(<IdentityDocuments />);
  await selectHire();
  const input = await screen.findByTestId("input-upload-identity-front");
  fireEvent.change(input, { target: { files: [new File(["bad"], "not-a-photo.svg", { type: "image/svg+xml" })] } });
  expect(screen.getByTestId("error-identity-front")).toBeTruthy();
  const file = new File(["synthetic"], "private-filename.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByTestId("pending-identity-front")).toBeTruthy();
  expect(screen.queryByText("private-filename.jpg")).toBeNull();
  expect(state.upload).not.toHaveBeenCalled();
  state.upload.mockRejectedValueOnce(Error("Transfer failed; retry"));
  fireEvent.click(screen.getByTestId("submit-identity-front"));
  await waitFor(() => expect(screen.getByTestId("error-identity-front").textContent).toContain("retry"));
  expect(state.upload).toHaveBeenCalledWith({ hireId: 9, category: "identity", side: "front", replacesId: null }, file, expect.any(Object));
  fireEvent.click(screen.getByTestId("cancel-identity-front"));
  expect(screen.queryByTestId("pending-identity-front")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test("saving front does not discard an unsent back photograph; actor change clears both", async () => {
  const view = render(<IdentityDocuments />);
  await selectHire();
  const front = await screen.findByTestId("input-upload-identity-front");
  const back = screen.getByTestId("input-upload-identity-back");
  const file = new File(["synthetic"], "fixture.jpg", { type: "image/jpeg" });
  fireEvent.change(front, { target: { files: [file] } });
  fireEvent.change(back, { target: { files: [file] } });
  state.upload.mockResolvedValue({});
  fireEvent.click(screen.getByTestId("submit-identity-front"));
  await waitFor(() => expect(screen.queryByTestId("pending-identity-front")).toBeNull());
  expect(screen.getByTestId("pending-identity-back")).toBeTruthy();
  state.actor.currentUser = { id: 2 };
  state.context.mockResolvedValue({ canManage: true, hires: [], employees: [] });
  view.rerender(<IdentityDocuments />);
  expect(screen.queryByTestId("pending-identity-back")).toBeNull();
  await screen.findByText("employment.identity.noHires");
});

test("HR must explicitly choose a review; an uploaded photo never defaults to Reviewed", async () => {
  state.actor.effectiveRole = "admin";
  state.context.mockResolvedValue({
    canManage: true, hires: [{ id: 9, name: "Synthetic hire", staffId: 1, staffName: "Synthetic employee" }],
    employees: [],
  });
  state.photos.mockResolvedValue({ photos: [{
    id: "synthetic-photo", category: "identity", side: "front", status: "uploaded",
    uploadedAt: "2026-10-07T00:00:00Z", uploadedBy: { id: 1, name: "Synthetic employee" },
    reviewedAt: null, reviewedBy: null, supersededAt: null,
  }], events: [] });
  render(<IdentityDocuments />);
  const chooser = await screen.findByTestId("identity-hire-select");
  fireEvent.change(chooser, { target: { value: "9" } });
  const save = await screen.findByTestId("review-save-synthetic-photo");
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId("review-choice-reviewed-synthetic-photo") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByTestId("review-choice-reviewed-synthetic-photo"));
  expect((save as HTMLButtonElement).disabled).toBe(false);
  expect(state.review).not.toHaveBeenCalled();
});
