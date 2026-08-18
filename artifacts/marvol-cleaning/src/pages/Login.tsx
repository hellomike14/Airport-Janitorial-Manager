import React from "react";
import { SignIn, SignUp, useClerk, useUser } from "@clerk/react";
import { useTranslation } from "react-i18next";
import { MailWarning, LogOut } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-950 via-green-900 to-emerald-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl" />
      </div>

      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher variant="login" />
      </div>

      <div className="text-center mb-8 relative z-10">
        <div className="flex flex-col items-center gap-4 mb-5">
          <img
            src={`${import.meta.env.BASE_URL}logo-mark.png`}
            alt="Marvol Facility Services"
            className="w-20 h-20 object-contain drop-shadow-2xl"
          />
          <div className="bg-white/95 backdrop-blur rounded-2xl px-6 py-2.5 shadow-2xl shadow-black/30">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Marvol Enterprises"
              className="h-9 object-contain"
            />
          </div>
        </div>
        <p className="text-emerald-300 mt-1 text-sm font-medium tracking-wide uppercase">
          {t("login.mcoAirport")}
        </p>
      </div>

      <div className="relative z-10 w-full flex justify-center">{children}</div>

      <p className="text-slate-500 text-xs mt-8 relative z-10">{t("login.footer")}</p>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthShell>
      {/* path must be the full browser path — Clerk reads window.location.pathname directly */}
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthShell>
  );
}

export function SignUpPage() {
  return (
    <AuthShell>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthShell>
  );
}

/**
 * Shown when a Clerk account signed in but no active staff record shares its
 * email. The employee must ask an admin to add/fix their email on the Staff
 * page, then sign in again.
 */
export function NoStaffMatch() {
  const { t } = useTranslation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;

  return (
    <AuthShell>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
          <MailWarning className="w-7 h-7 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">
          {t("login.noStaffMatchTitle", "Account not linked to a staff record")}
        </h1>
        <p className="text-sm text-slate-500 mt-3">
          {t(
            "login.noStaffMatchBody",
            "You signed in successfully, but no staff record uses this email address. Ask an administrator to add this email to your staff profile, then sign in again."
          )}
        </p>
        {email && (
          <p className="mt-3 text-sm font-semibold text-slate-700 bg-slate-100 rounded-xl py-2 px-3 break-all">
            {email}
          </p>
        )}
        <button
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {t("layout.logout", "Log out")}
        </button>
      </div>
    </AuthShell>
  );
}
