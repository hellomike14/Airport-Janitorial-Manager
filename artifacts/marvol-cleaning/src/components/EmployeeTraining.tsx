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

function AttestationForm({ status, statusKey }: { status: EmployeeTrainingStatus; statusKey: readonly unknown[] }) {
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
  });
  const nameOk = name.trim() !== "" && normalizeName(name) === normalizeName(status.staff.name);
  const canSubmit = status.eligible && watched && understood && nameOk && !sign.isPending;
  return (
    <form className="space-y-3 rounded-xl border border-slate-200 p-4" data-testid="form-attestation"
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) sign.mutate(); }}>
      <h3 className="font-semibold text-slate-800">Employee attestation</h3>
      <p className="text-sm text-slate-500">
        This is your own statement. It is recorded as an employee attestation and is not proof of comprehension.
      </p>
      {!status.eligible && (
        <p className="text-sm text-amber-700" data-testid="text-not-eligible">
          Signing unlocks after the server has recorded the full video as watched
          ({Math.floor(status.watchedSeconds)} of {Math.round(status.training.duration)} seconds credited).
        </p>
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
          Could not save your attestation{sign.error instanceof Error ? `: ${sign.error.message}` : ""}. Try again.
        </p>
      )}
      <button type="submit" disabled={!canSubmit} data-testid="button-sign"
        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
        {sign.isPending ? "Saving..." : "Sign attestation"}
      </button>
    </form>
  );
}

function Player({ status, statusKey }: { status: EmployeeTrainingStatus; statusKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<string | null>(null);
  const startingRef = useRef(false);
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

  const report = useCallback((playing: boolean, seeking: boolean, forcePosition?: number) => {
    const v = videoRef.current;
    const sessionId = sessionRef.current;
    if (!v || !sessionId) return;
    const r = v.playbackRate;
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

  useEffect(() => {
    mountedRef.current = true;
    const onHide = () => { if (document.hidden) videoRef.current?.pause(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { mountedRef.current = false; document.removeEventListener("visibilitychange", onHide); stopTimer(); };
  }, []);

  const onPlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    setProblem(null);
    if (sessionRef.current) return;
    if (startingRef.current) { v.pause(); return; }
    startingRef.current = true;
    v.pause();
    try {
      const s = await startEmployeeTrainingSession();
      if (!mountedRef.current) return;
      sessionRef.current = s.sessionId;
      v.currentTime = 0;
      await report(true, false, 0);
      if (!sessionRef.current) return;
      await v.play();
    } catch (err) {
      setProblem(`Could not start a watch session${err instanceof Error ? ` (${err.message})` : ""}. Press play to retry.`);
    } finally {
      startingRef.current = false;
    }
  };

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
        onPlaying={() => { if (sessionRef.current) { report(true, false); startTimer(); } }}
        onPause={() => { stopTimer(); const v = videoRef.current; if (v && !v.ended && !v.seeking) report(false, false); }}
        onEnded={() => { stopTimer(); const v = videoRef.current; report(false, false, v?.duration ?? v?.currentTime); }}
        onSeeking={() => report(false, true)}
        onSeeked={() => { const v = videoRef.current; if (v) report(!v.paused && !v.ended, false); }}
        onRateChange={() => {
          const v = videoRef.current;
          if (v) { setRate(v.playbackRate); report(!v.paused, false); }
        }}
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
  const isManager = effectiveRole === "admin" || effectiveRole === "supervisor";
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
              <AttestationForm key={`${status.staff.id}:${status.training.version}`} status={status} statusKey={statusKey} />
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
