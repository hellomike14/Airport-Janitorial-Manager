import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AttestationForm, ManagerReview, Player } from "./EmployeeTraining";

const fixture = vi.hoisted(() => ({
  mutation: { mutate: vi.fn(), isError: false, isPending: false },
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn(), getQueryData: vi.fn() },
  trainingApi: {
    startSession: vi.fn(),
    updateProgress: vi.fn(),
    acknowledge: vi.fn(),
    getStatus: vi.fn(),
    getReview: vi.fn(),
  },
  data: {
    training: { version: "fixture-version" },
    employees: [
      { staffId: 1, name: "Current fixture", active: true, formerEmployee: false, status: "pending", watchedSeconds: 0, acknowledgment: null, history: [] },
      { staffId: 2, name: "Former fixture", active: true, formerEmployee: true, status: "completed", watchedSeconds: 10, acknowledgment: null, history: [] },
      { staffId: 3, name: "Inactive current fixture", active: false, formerEmployee: false, status: "pending", watchedSeconds: 0, acknowledgment: null, history: [] },
      { staffId: 4, name: "Inactive former fixture", active: false, formerEmployee: true, status: "pending", watchedSeconds: 0, acknowledgment: null, history: [] },
    ],
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: fixture.data, isLoading: false, isError: false }),
  useMutation: () => fixture.mutation,
  useQueryClient: () => fixture.queryClient,
}));
vi.mock("@workspace/api-client-react", () => ({
  startEmployeeTrainingSession: fixture.trainingApi.startSession,
  updateEmployeeTrainingProgress: fixture.trainingApi.updateProgress,
  acknowledgeEmployeeTraining: fixture.trainingApi.acknowledge,
  getEmployeeTrainingStatus: fixture.trainingApi.getStatus,
  getEmployeeTrainingReview: fixture.trainingApi.getReview,
  getGetEmployeeTrainingReviewQueryKey: () => ["fixture-review"],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("training review excludes all former employees, including stale cached results", () => {
  render(<ManagerReview />);
  expect(screen.getByTestId("row-review-1")).toBeTruthy();
  expect(screen.getByTestId("row-review-3")).toBeTruthy();
  expect(screen.queryByTestId("row-review-2")).toBeNull();
  expect(screen.queryByTestId("row-review-4")).toBeNull();
  expect(screen.queryByText("Former fixture")).toBeNull();
  expect(screen.queryByText("Inactive former fixture")).toBeNull();
});

const attestationStatus = (eligible: boolean) => ({
  training: { version: "fixture-version", title: "Orientation", duration: 190.122993, videoUrl: "/training" },
  staff: { id: 20, name: "Jean Gardy Rigueur" },
  watchedSeconds: 178.629985,
  eligible,
  acknowledgment: null,
  history: [],
});

test("attestation form explains saved watch blockers and refreshes status without signing", () => {
  const onRefreshStatus = vi.fn();
  render(
    <AttestationForm
      status={attestationStatus(false)}
      statusKey={["employee-training", 20]}
      onRefreshStatus={onRefreshStatus}
      refreshing={false}
    />
  );
  expect(screen.getByTestId("attestation-requirements").textContent).toContain("12 more seconds");
  expect(screen.getByTestId("attestation-requirements").textContent).toContain("earliest uncredited section");
  expect(screen.getByTestId("attestation-requirements").textContent).toContain("watched the full training video");
  expect(screen.getByTestId("attestation-requirements").textContent).toContain("understand the training");
  expect(screen.getByTestId("attestation-requirements").textContent).toContain("Jean Gardy Rigueur");
  expect((screen.getByTestId("button-sign") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("button-refresh-training-status"));
  expect(onRefreshStatus).toHaveBeenCalledOnce();
  expect(fixture.mutation.mutate).not.toHaveBeenCalled();
});

test("eligible server progress does not hide local attestation requirements", () => {
  render(
    <AttestationForm
      status={attestationStatus(true)}
      statusKey={["employee-training", 20]}
      onRefreshStatus={vi.fn()}
      refreshing={false}
    />
  );
  const requirements = screen.getByTestId("attestation-requirements").textContent ?? "";
  expect(requirements).not.toContain("server has credited");
  expect(requirements).toContain("Check “I watched the full training video”");
  expect(requirements).toContain("Check “I understand the training”");
  expect(requirements).toContain("Enter the full name on your staff account");
  expect(screen.queryByTestId("button-refresh-training-status")).toBeNull();
});

test("play and resume each serialize paused then playing baselines for the active session", async () => {
  fixture.trainingApi.startSession.mockResolvedValue({
    sessionId: "28a87ef7-4bd4-4c5f-b0b9-fd6a1fac09dd",
    resumePosition: 30,
  });
  fixture.trainingApi.updateProgress.mockResolvedValue({ watchedSeconds: 0, eligible: false });
  render(<Player status={attestationStatus(false)} statusKey={["training", 20]} />);
  const video = screen.getByTestId("video-training") as HTMLVideoElement;
  let currentTime = 0;
  let paused = true;
  let playbackRate = 1;
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => currentTime, set: (value: number) => { currentTime = value; } },
    duration: { configurable: true, value: 190.122993 },
    readyState: { configurable: true, value: 1 },
    paused: { configurable: true, get: () => paused },
    seeking: { configurable: true, value: false },
    ended: { configurable: true, value: false },
    playbackRate: { configurable: true, get: () => playbackRate, set: (value: number) => { playbackRate = value; } },
  });
  video.pause = vi.fn(() => {
    paused = true;
    fireEvent.pause(video);
  });
  video.play = vi.fn(() => {
    paused = false;
    fireEvent.play(video);
    fireEvent.playing(video);
    return Promise.resolve();
  });

  paused = false;
  fireEvent.play(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(2));
  expect(fixture.trainingApi.startSession).toHaveBeenCalledOnce();
  expect(fixture.trainingApi.updateProgress.mock.calls.slice(0, 2).map(([payload]) => payload)).toEqual([
    expect.objectContaining({ position: 30, playing: false, seeking: true }),
    expect.objectContaining({ position: 30, playing: true, seeking: false }),
  ]);

  currentTime = 35;
  fireEvent.waiting(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(3));
  fireEvent.playing(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(4));
  expect(fixture.trainingApi.updateProgress.mock.calls.slice(2, 4).map(([payload]) => payload)).toEqual([
    expect.objectContaining({ position: 35, playing: false, seeking: false }),
    expect.objectContaining({ position: 35, playing: true, seeking: false }),
  ]);

  currentTime = 37;
  fireEvent.stalled(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(5));
  fireEvent.playing(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(6));
  expect(fixture.trainingApi.updateProgress.mock.calls.slice(4, 6).map(([payload]) => payload)).toEqual([
    expect.objectContaining({ position: 37, playing: false, seeking: false }),
    expect.objectContaining({ position: 37, playing: true, seeking: false }),
  ]);

  currentTime = 38;
  playbackRate = 1.5;
  fireEvent.rateChange(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(8));
  expect(fixture.trainingApi.updateProgress.mock.calls.slice(6, 8).map(([payload]) => payload)).toEqual([
    expect.objectContaining({ position: 38, playing: false, seeking: false, rate: 1 }),
    expect.objectContaining({ position: 38, playing: true, seeking: false, rate: 1.5 }),
  ]);

  currentTime = 45;
  paused = true;
  fireEvent.pause(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(9));

  paused = false;
  fireEvent.play(video);
  await waitFor(() => expect(fixture.trainingApi.updateProgress).toHaveBeenCalledTimes(11));
  expect(fixture.trainingApi.startSession).toHaveBeenCalledOnce();
  expect(fixture.trainingApi.updateProgress.mock.calls.slice(9, 11).map(([payload]) => payload)).toEqual([
    expect.objectContaining({ position: 45, playing: false, seeking: true, rate: 1.5 }),
    expect.objectContaining({ position: 45, playing: true, seeking: false, rate: 1.5 }),
  ]);
});
