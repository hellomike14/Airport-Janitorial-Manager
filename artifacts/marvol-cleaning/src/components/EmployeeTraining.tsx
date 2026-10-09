import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, Volume2, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getEmployeeTrainingStatus,
  startEmployeeTrainingSession,
  updateEmployeeTrainingProgress,
  acknowledgeEmployeeTraining,
  getEmployeeTrainingReview,
  getGetEmployeeTrainingReviewQueryKey,
  type EmployeeTrainingStatus,
  type TrainingAcknowledgment,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalTrainingPosition, shouldReportTrainingPause } from "./trainingPlayback";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const HEARTBEAT_MS = 5000;

const normalizeName = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function AckRecord({ ack, label }: { ack: TrainingAcknowledgment; label?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm space-y-1"
      data-testid={`record-ack-${ack.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-800 break-all">{label ?? "Attestation"} - version {ack.version}</span>
        <span className="text-xs text-slate-500">Recorded by server {fmtDate(ack.completedAt)}</span>
      </div>
      <p className="text-slate-600">{ack.trainingTitle}</p>
      <p className="text-slate-700">Signature: <span className="font-medium italic">{ack.signature}</span> (name on file: {ack.staffName})</p>
      <p className="text-xs text-slate-500">
        Confirmed watched: {ack.watchedConfirmation ? "yes" : "no"} / Confirmed understood: {ack.understoodConfirmation ? "yes" : "no"}
      </p>
      <p className="text-[11px] text-slate-400 break-all">Training source SHA-256: {ack.videoSha256}</p>
    </div>
  );
}

export function AttestationForm({
  status,
  statusKey,
  onRefreshStatus,
  refreshing,
}: {
  status: EmployeeTrainingStatus;
  statusKey: readonly unknown[];
  onRefreshStatus: () => void;
  refreshing: boolean;
}) {
  const qc = useQueryClient();
  const [watched, setWatched] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [name, setName] = useState("");
  const sign = useMutation({
    mutationFn: () =>
      acknowledgeEmployeeTraining({
        version: status.training.version, watched: true, understood: true, fullName: name.trim(),
      }),
    onSuccess: (result) => {
      qc.setQueryData(statusKey, result);
      void qc.invalidateQueries({ queryKey: getGetEmployeeTrainingReviewQueryKey() });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: statusKey });
    },
  });
  const nameOk = name.trim() !== "" && normalizeName(name) === normalizeName(status.staff.name);
  const blockers: string[] = [];
  if (!status.eligible) {
    const remaining = Math.max(0, status.training.duration - status.watchedSeconds);
    if (remaining > 0.75) {
      blockers.push(
        `The server has credited ${Math.floor(status.watchedSeconds)} of ${Math.round(status.training.duration)} seconds; ` +
        `${Math.ceil(remaining)} more seconds of complete, non-skipped coverage are needed. ` +
        "Your saved credit is preserved. Press Play to continue at the earliest uncredited section. " +
        "If the video already ended, refresh saved progress and replay that section."
      );
    } else {
      blockers.push(
        "The server has not confirmed continuous coverage from the beginning through the end. " +
        "A small uncredited gap may remain. Your saved credit is preserved; press Play to replay from the earliest gap without seeking."
      );
    }
  }
  if (!watched) blockers.push("Check “I watched the full training video” to confirm your own statement.");
  if (!understood) blockers.push("Check “I understand the training” to confirm your own statement.");
  if (!name.trim()) {
    blockers.push(`Enter the full name on your staff account: ${status.staff.name}.`);
  } else if (!nameOk) {
    blockers.push(
      `Your signature must match the full staff-account name: ${status.staff.name}. ` +
      "Case and repeated spaces are ignored; spelling and name parts must match."
    );
  }
  const canSubmit = blockers.length === 0 && !sign.isPending;
  return (
    <form className="space-y-3 rounded-xl border border-slate-200 p-4" data-testid="form-attestation"
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) sign.mutate(); }}>
      <h3 className="font-semibold text-slate-800">Employee attestation</h3>
      <p className="text-sm text-slate-500">
        This is your own statement. It is recorded as an employee attestation and is not proof of comprehension.
      </p>
      {blockers.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          role="status" aria-live="polite" data-testid="attestation-requirements">
          <p className="font-semibold">Complete these requirements before signing:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
          {!status.eligible && (
            <button type="button" onClick={onRefreshStatus} disabled={refreshing}
              className="mt-2 underline font-medium disabled:opacity-60" data-testid="button-refresh-training-status">
              {refreshing ? "Refreshing saved progress…" : "Refresh saved progress"}
            </button>
          )}
        </div>
      )}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1 accent-emerald-600" checked={watched}
          onChange={(e) => setWatched(e.target.checked)} data-testid="check-watched" />
        I watched the full training video
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1 accent-emerald-600" checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)} data-testid="check-understood" />
        I understand the training
      </label>
      <div>
        <label htmlFor="training-signature" className="text-sm font-medium text-slate-700 block mb-1">
          Type your full name as signature ({status.staff.name})
        </label>
        <input id="training-signature" value={name} onChange={(e) => setName(e.target.value)}
          autoComplete="off" data-testid="input-signature"
          className="w-full max-w-sm px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none" />
      </div>
      {sign.isError && (
        <p role="alert" className="text-sm text-red-700" data-testid="text-sign-error">
          The server did not confirm this attestation. Your existing records are preserved. Refresh the saved progress and review the requirements before retrying.
        </p>
      )}
      <button type="submit" disabled={!canSubmit} data-testid="button-sign"
        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
        {sign.isPending ? "Saving..." : "Sign attestation"}
      </button>
    </form>
  );
}

export function Player({ status, statusKey }: { status: EmployeeTrainingStatus; statusKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const allowNextPlayRef = useRef(false);
  const suppressPauseRef = useRef(false);
  const programmaticSeekRef = useRef(false);
  const baselineReadyRef = useRef(false);
  const waitingPositionRef = useRef<number | null>(null);
  const reportedRateRef = useRef(1);
  const mountedRef = useRef(true);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [failed, setFailed] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const version = status.training.version;
  const statusKeyRef = useRef(statusKey);
  statusKeyRef.current = statusKey;

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const report = useCallback((playing: boolean, seeking: boolean, forcePosition?: number, forceRate?: number) => {
    const v = videoRef.current;
    const sessionId = sessionRef.current;
    if (!v || !sessionId) return;
    const r = forceRate ?? v.playbackRate;
    if (!(r >= 0.25 && r <= 2)) {
      v.pause();
      setProblem(`Playback speed ${r}x is not supported. Use a speed between 0.25x and 2x.`);
      return;
    }
    const payload = { sessionId, version, position: Math.max(0, forcePosition ?? v.currentTime), playing, seeking, rate: r };
    queueRef.current = queueRef.current.then(async () => {
      if (!mountedRef.current || sessionRef.current !== sessionId) return;
      try {
        const res = await updateEmployeeTrainingProgress(payload);
        qc.setQueryData(statusKeyRef.current, (old: EmployeeTrainingStatus | undefined) =>
          old?.training.version === version ? { ...old, watchedSeconds: res.watchedSeconds, eligible: res.eligible } : old);
      } catch (err) {
        sessionRef.current = null;
        videoRef.current?.pause();
        setProblem(`Watch progress could not be saved${err instanceof Error ? ` (${err.message})` : ""}. Video paused; press play to start a new session. Previously saved progress is retained.`);
      }
    });
    return queueRef.current;
  }, [version, qc]);

  const startTimer = () => {
    stopTimer();
    timerRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && !v.seeking) report(true, false);
    }, HEARTBEAT_MS);
  };

  const seekToPosition = async (video: HTMLVideoElement, position: number) => {
    if (!Number.isFinite(position) || position < 0) throw new Error("The saved resume position is invalid.");
    if (position > 0 && video.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => finish(new Error("The video metadata did not load in time.")), 15000);
        const cleanup = () => {
          window.clearTimeout(timeout);
          video.removeEventListener("loadedmetadata", onMetadata);
          video.removeEventListener("error", onError);
        };
        const finish = (error?: Error) => {
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const onMetadata = () => finish();
        const onError = () => finish(new Error("The training video could not be loaded."));
        video.addEventListener("loadedmetadata", onMetadata, { once: true });
        video.addEventListener("error", onError, { once: true });
        if (video.readyState >= 1) onMetadata();
      });
    }
    if (Number.isFinite(video.duration) && position > video.duration + 0.25) {
      throw new Error("The saved progress does not match this video’s duration. Contact a manager; your saved progress is preserved.");
    }
    const target = Number.isFinite(video.duration) ? Math.min(position, video.duration) : position;
    if (Math.abs(video.currentTime - target) <= 0.05) return video.currentTime;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error("The video could not seek to the saved position.")), 15000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      const finish = (error?: Error) => {
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onSeeked = () => finish();
      const onError = () => finish(new Error("The training video could not be loaded."));
      programmaticSeekRef.current = true;
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      try {
        video.currentTime = target;
        if (!video.seeking && Math.abs(video.currentTime - target) <= 0.05) finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("The saved position could not be selected."));
      }
    }).finally(() => { programmaticSeekRef.current = false; });
    return video.currentTime;
  };

  const onPlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (allowNextPlayRef.current) {
      allowNextPlayRef.current = false;
      return;
    }
    if (startingRef.current) {
      suppressPauseRef.current = true;
      v.pause();
      return;
    }
    setProblem(null);
    startingRef.current = true;
    baselineReadyRef.current = false;
    waitingPositionRef.current = null;
    stopTimer();
    suppressPauseRef.current = true;
    v.pause();
    try {
      if (!sessionRef.current) {
        const session = await startEmployeeTrainingSession();
        if (!mountedRef.current) return;
        sessionRef.current = session.sessionId;
        await seekToPosition(v, session.resumePosition);
      }
      if (!mountedRef.current || !sessionRef.current) return;
      const baseline = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      await report(false, true, baseline);
      if (!sessionRef.current) return;
      await report(true, false, baseline);
      if (!sessionRef.current) return;
      baselineReadyRef.current = true;
      allowNextPlayRef.current = true;
      await v.play();
    } catch (err) {
      allowNextPlayRef.current = false;
      setProblem(`Could not resume the training video${err instanceof Error ? ` (${err.message})` : ""}. Your saved progress is preserved; press Play to retry.`);
    } finally {
      startingRef.current = false;
    }
  };

  const onPlaying = () => {
    const v = videoRef.current;
    if (!v || !sessionRef.current) return;
    const waitingPosition = waitingPositionRef.current;
    if (baselineReadyRef.current && waitingPosition === null) {
      baselineReadyRef.current = false;
      startTimer();
      return;
    }
    baselineReadyRef.current = false;
    waitingPositionRef.current = null;
    if (waitingPosition !== null) {
      void report(true, false, waitingPosition)?.then(() => startTimer());
      return;
    }
    const position = v.currentTime;
    void report(false, true, position)?.then(() =>
      report(true, false, position)?.then(() => startTimer()));
  };

  const onWaiting = () => {
    const v = videoRef.current;
    if (!v || !sessionRef.current) return;
    stopTimer();
    waitingPositionRef.current = v.currentTime;
    void report(false, false, waitingPositionRef.current);
  };

  const onStalled = () => {
    const v = videoRef.current;
    if (!v || !sessionRef.current) return;
    const position = v.currentTime;
    stopTimer();
    void report(false, false, position)?.then(async () => {
      if (v.paused || v.seeking || v.ended || v.readyState <= 2) {
        waitingPositionRef.current = position;
        return;
      }
      await report(true, false, position);
      startTimer();
    });
  };

  const onEnded = () => {
    stopTimer();
    const v = videoRef.current;
    if (!v || !sessionRef.current) return;
    const position = finalTrainingPosition(v.currentTime, v.duration);
    if (position === null) {
      setProblem("The video ended without a usable playback position. Your saved progress is preserved; press Play to retry.");
      return;
    }
    const finalReport = report(false, false, position);
    if (!finalReport) return;
    void finalReport.then(async () => {
      const latest = qc.getQueryData<EmployeeTrainingStatus>(statusKeyRef.current);
      if (!mountedRef.current || sessionRef.current === null || latest?.eligible) return;
      try {
        const session = await startEmployeeTrainingSession();
        if (!mountedRef.current) return;
        sessionRef.current = session.sessionId;
        const resumePosition = await seekToPosition(v, session.resumePosition);
        baselineReadyRef.current = false;
        waitingPositionRef.current = null;
        await report(false, true, resumePosition);
        if (!sessionRef.current) return;
        setProblem(
          `Some sections were not fully credited. Your saved progress is preserved. ` +
          `The video is positioned at ${Math.floor(resumePosition)} seconds, the earliest uncredited section. ` +
          "Press Play and let it play without seeking."
        );
      } catch (err) {
        setProblem(
          `The server did not confirm full coverage. Your saved progress is preserved. ` +
          `Refresh saved progress and press Play to resume${err instanceof Error ? ` (${err.message})` : ""}.`
        );
      }
    });
  };

  const onSeeked = () => {
    const v = videoRef.current;
    if (!v) return;
    if (programmaticSeekRef.current) {
      programmaticSeekRef.current = false;
      return;
    }
    const position = v.currentTime;
    const playing = !v.paused && !v.ended;
    void report(playing, false, position)?.then(() => {
      if (playing) startTimer();
    });
  };

  const onRateChange = () => {
    const v = videoRef.current;
    if (!v) return;
    const nextRate = v.playbackRate;
    setRate(nextRate);
    if (nextRate === reportedRateRef.current) return;
    const previousRate = reportedRateRef.current;
    if (!sessionRef.current) {
      if (nextRate < 0.25 || nextRate > 2 || !Number.isFinite(nextRate)) {
        setProblem(`Playback speed ${nextRate}x is not supported. Use a speed between 0.25x and 2x.`);
        suppressPauseRef.current = true;
        v.pause();
      } else {
        reportedRateRef.current = nextRate;
      }
      return;
    }
    const position = v.currentTime;
    stopTimer();
    void report(false, false, position, previousRate)?.then(async () => {
      if (nextRate < 0.25 || nextRate > 2) {
        setProblem(`Playback speed ${nextRate}x is not supported. Use a speed between 0.25x and 2x.`);
        suppressPauseRef.current = true;
        v.pause();
        return;
      }
      reportedRateRef.current = nextRate;
      if (!v.paused && !v.seeking && !v.ended) {
        await report(true, false, position, nextRate);
        startTimer();
      } else {
        await report(false, true, position, nextRate);
      }
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    const onHide = () => { if (document.hidden) videoRef.current?.pause(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { mountedRef.current = false; document.removeEventListener("visibilitychange", onHide); stopTimer(); };
  }, []);

  const changeRate = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = value;
    if (v.playbackRate !== value) setProblem(`This browser does not support ${value}x playback.`);
    else setRate(value);
  };

  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        aria-label={status.training.title}
        aria-describedby="employee-training-help"
        className="w-full max-w-4xl aspect-video rounded-xl bg-black"
        data-testid="video-training"
        onError={() => setFailed(true)}
        onLoadedData={() => setFailed(false)}
        onVolumeChange={() => setVolume(videoRef.current?.muted ? 0 : videoRef.current?.volume ?? 1)}
        onPlay={onPlay}
        onPlaying={onPlaying}
        onPause={() => {
          stopTimer();
          if (suppressPauseRef.current) {
            suppressPauseRef.current = false;
            return;
          }
          const v = videoRef.current;
          if (v && shouldReportTrainingPause({
            currentTime: v.currentTime,
            ended: v.ended,
            seeking: v.seeking,
          })) report(false, false);
        }}
        onEnded={onEnded}
        onSeeking={() => {
          if (programmaticSeekRef.current) return;
          stopTimer();
          waitingPositionRef.current = null;
          report(false, true);
        }}
        onSeeked={onSeeked}
        onWaiting={onWaiting}
        onStalled={onStalled}
        onRateChange={onRateChange}
      >
        <source src={`${BASE_URL}${status.training.videoUrl}`} type='video/mp4; codecs="avc1.640032,mp4a.40.2"' />
        <source src={`${BASE_URL}${status.training.videoUrl}?format=webm`} type='video/webm; codecs="vp9,opus"' />
        Your browser does not support video playback. Please use a current browser.
      </video>
      {failed && (
        <div role="alert" className="text-sm text-red-700" data-testid="alert-video-error">
          The training video could not load. Check your connection and try again.
          <button type="button" className="ml-2 underline font-medium" data-testid="button-retry-video"
            onClick={() => { setFailed(false); videoRef.current?.load(); }}>
            Retry video
          </button>
        </div>
      )}
      {problem && (
        <div role="alert" className="flex items-start gap-2 text-sm text-red-700" data-testid="alert-progress">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {problem}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <label htmlFor="training-volume" className="flex items-center gap-2">
          <Volume2 className="h-4 w-4" aria-hidden="true" /> Volume
        </label>
        <input id="training-volume" aria-label="Training video volume" type="range" min="0" max="1" step="0.05"
          value={volume} className="w-32 accent-emerald-600"
          onChange={(event) => {
            const value = Number(event.target.value);
            setVolume(value);
            if (videoRef.current) { videoRef.current.muted = value === 0; videoRef.current.volume = value; }
          }} />
        <label htmlFor="training-rate" className="ml-2">Speed</label>
        <select id="training-rate" value={rate} onChange={(e) => changeRate(Number(e.target.value))}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm" data-testid="select-rate">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}x</option>)}
        </select>
        <span className="text-xs text-slate-500">
          iPhone and iPad do not let web pages change volume. Use your device's volume buttons.
        </span>
      </div>
    </div>
  );
}

export function ManagerReview() {
  const q = useQuery({ queryKey: getGetEmployeeTrainingReviewQueryKey(), queryFn: ({ signal }) => getEmployeeTrainingReview({ signal }),
    refetchOnMount: "always", refetchInterval: 30000 });
  return (
    <div className="space-y-3 border-t border-slate-200 pt-4" data-testid="section-training-review">
      <h3 className="font-semibold text-slate-800">Manager review</h3>
      {q.isLoading && <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />}
      {q.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load the review. <button type="button" className="underline" onClick={() => q.refetch()}>Retry</button>
        </p>
      )}
      {q.data && (
        <>
          <p className="text-sm text-slate-500 break-all">
            Current version {q.data.training.version}. Records are employee attestations, not proof of comprehension.
          </p>
          <ul className="space-y-2">
            {q.data.employees.filter((e) => !e.formerEmployee).map((e) => (
              <li key={e.staffId} className="rounded-xl border border-slate-200 p-3 space-y-2" data-testid={`row-review-${e.staffId}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {e.name}{!e.active ? " (inactive)" : ""}
                  </span>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                    e.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                    data-testid={`status-review-${e.staffId}`}>
                    {e.status === "completed" ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {e.status === "completed" ? "Completed" : "Pending"}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Watch credit {Math.floor(e.watchedSeconds)}s, server eligibility: {e.eligible ? "eligible" : "not yet eligible"}
                </p>
                {e.acknowledgment && <AckRecord ack={e.acknowledgment} label="Current version" />}
                {e.history.filter((h) => h.id !== e.acknowledgment?.id).map((h) => (
                  <AckRecord key={h.id} ack={h} label={h.version === q.data.training.version ? "Record" : "Prior version"} />
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function EmployeeTraining() {
  const { currentUser, effectiveRole } = useAuth();
  const userId = currentUser?.id;
  const statusKey = ["employee-training", "status", userId] as const;
  const isManager = effectiveRole === "admin" || effectiveRole === "supervisor" || effectiveRole === "employee_administrator";
  const q = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => getEmployeeTrainingStatus({ signal }),
    enabled: userId !== undefined,
    refetchOnMount: "always",
    staleTime: 5000,
  });
  const status = q.data && q.data.staff.id === userId ? q.data : undefined;

  return (
    <section aria-labelledby="employee-training-title"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <GraduationCap className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />
        <div>
          <h2 id="employee-training-title" className="text-lg font-semibold text-slate-800">
            {status?.training.title ?? "New Employee Training"}
          </h2>
          <p id="employee-training-help" className="text-sm text-slate-500">
            Watch the MFS orientation video from start to finish. Seeking forward earns no watch credit. Use the player to play, pause, seek, or enter fullscreen.
          </p>
        </div>
      </div>
      {q.isLoading && <div className="aspect-video max-w-4xl rounded-xl bg-slate-100 animate-pulse" />}
      {q.isError && (
        <p role="alert" className="text-sm text-red-700" data-testid="alert-status-error">
          Training status could not load. <button type="button" className="underline font-medium" onClick={() => q.refetch()}>Retry</button>
        </p>
      )}
      {status && (
        <>
          <Player key={`${status.staff.id}:${status.training.version}`} status={status} statusKey={statusKey} />
          {status.acknowledgment ? (
            <div className="space-y-2" data-testid="section-current-ack">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 break-all">
                <CheckCircle2 className="h-4 w-4" /> Attestation on file for version {status.training.version}
              </p>
              <AckRecord ack={status.acknowledgment} label="Current version" />
            </div>
          ) : (
            <>
              {status.history.length > 0 && (
                <p className="text-sm text-amber-700" data-testid="text-fresh-required">
                  You signed an earlier version. Version {status.training.version} needs a new attestation.
                </p>
              )}
              <AttestationForm
                key={`${status.staff.id}:${status.training.version}`}
                status={status}
                statusKey={statusKey}
                onRefreshStatus={() => { void q.refetch(); }}
                refreshing={q.isFetching}
              />
            </>
          )}
          {status.history.filter((h) => h.id !== status.acknowledgment?.id).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Earlier records</h3>
              {status.history.filter((h) => h.id !== status.acknowledgment?.id).map((h) => (
                <AckRecord key={h.id} ack={h} label="Prior record" />
              ))}
            </div>
          )}
        </>
      )}
      {isManager && <ManagerReview />}
    </section>
  );
}
