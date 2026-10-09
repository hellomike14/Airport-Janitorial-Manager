import { useEffect, useState } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { EmploymentFormsLibrary } from "./employment/EmploymentFormsLibrary";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Candidate = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  position: string | null;
  formIds: string[];
};

export default function NewHirePortal() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`${BASE_URL}/api/new-hire/status`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("NOT_PROMOTED");
        return response.json() as Promise<Candidate>;
      })
      .then(setCandidate)
      .catch(() => { if (!controller.signal.aborted) setDenied(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isLoaded, isSignedIn]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between gap-4 rounded-2xl bg-emerald-950 px-6 py-5 text-white">
          <div>
            <p className="text-sm font-semibold text-emerald-200">Marvol Facility Services</p>
            <h1 className="mt-1 text-2xl font-bold">New-hire portal</h1>
          </div>
          <LanguageSwitcher />
        </header>

        {!isLoaded || loading ? (
          <p role="status" className="rounded-xl bg-white p-6 text-sm text-slate-600">Checking new-hire access…</p>
        ) : !isSignedIn ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-slate-700">Sign in with the verified email address on your application to continue.</p>
            <a className="mt-4 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
              href={`${BASE_URL}/sign-in`}>Sign in</a>
          </section>
        ) : denied || !candidate ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <p role="alert" className="text-slate-700">
              New-hire access is available only after a manager promotes your application. Use the application page or contact your manager.
            </p>
            <a className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              href={`${BASE_URL}/apply`}>Return to application</a>
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Welcome, {candidate.firstName}</h2>
              {candidate.position && <p className="mt-1 text-sm text-slate-600">{candidate.position}</p>}
              <p className="mt-2 text-sm text-slate-600">{candidate.email}</p>
            </section>
            <EmploymentFormsLibrary variant="new-hire" candidate={candidate} />
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">New employee training</h2>
              <p className="mt-1 text-sm text-slate-600">Watch the orientation video before your first shift.</p>
              <video className="mt-4 w-full max-w-3xl rounded-xl bg-slate-900" controls playsInline preload="metadata"
                src={`${BASE_URL}/api/employee-training/video`}>
                Your browser does not support video playback.
              </video>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
