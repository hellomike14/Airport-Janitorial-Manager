import { Component, Suspense, lazy, useEffect, useRef, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, useClerk, useAuth as useClerkAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { OfflineProvider } from "./contexts/OfflineContext";
import { OfflineBanner } from "./components/OfflineBanner";
import "./i18n";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const AreasList = lazy(() => import("./pages/AreasList"));
const AreaTasks = lazy(() => import("./pages/AreaTasks"));
const Staff = lazy(() => import("./pages/Staff"));
const Assignments = lazy(() => import("./pages/Assignments"));
const Issues = lazy(() => import("./pages/Issues"));
const MyTasks = lazy(() => import("./pages/MyTasks"));
const TaskManagement = lazy(() => import("./pages/TaskManagement"));
const TaskTypes = lazy(() => import("./pages/TaskTypes"));
const InspectorReport = lazy(() => import("./pages/InspectorReport"));
const CompletedJobs = lazy(() => import("./pages/CompletedJobs"));
const GPSTracking = lazy(() => import("./pages/GPSTracking"));
const EmployeePortal = lazy(() => import("./pages/EmployeePortal"));
const PhotoShare = lazy(() => import("./pages/PhotoShare"));
const WeeklyReport = lazy(() => import("./pages/WeeklyReport"));
const SpecialRequests = lazy(() => import("./pages/SpecialRequests"));
const Employment = lazy(() => import("./pages/Employment"));
const Apply = lazy(() => import("./pages/Apply"));
const Messages = lazy(() => import("./pages/Messages"));
import { LoginRecovery } from "./components/LoginRecovery";
import { SignInPage, SignUpPage, NoStaffMatch } from "./pages/Login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
    },
  },
});

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — empty in dev (Clerk hits dev FAPI directly), auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo-mark.png`,
  },
  variables: {
    colorPrimary: "#059669",
    colorForeground: "#0f172a",
    colorMutedForeground: "#64748b",
    colorDanger: "#e11d48",
    colorBackground: "#ffffff",
    colorInput: "#f8fafc",
    colorInputForeground: "#0f172a",
    colorNeutral: "#334155",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[420px] max-w-full overflow-hidden shadow-2xl shadow-black/30",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-900 font-bold",
    headerSubtitle: "text-slate-500",
    formFieldLabel: "text-slate-700 font-semibold",
    footerActionLink: "text-emerald-700 hover:text-emerald-800 font-semibold",
    footerActionText: "text-slate-500",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-emerald-700",
    formFieldSuccessText: "text-emerald-600",
    alertText: "text-slate-700",
    // Google sign-in is not offered in this employee portal. Hide Clerk's
    // social-login controls so authentication begins with the work email form.
    socialButtonsBlockButtonText: "text-slate-700",
    socialButtonsBlockButton: "hidden",
    dividerRow: "hidden",
    formButtonPrimary: "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold",
    formFieldInput: "border-slate-200 focus:border-emerald-500",
    dividerLine: "bg-slate-200",
    otpCodeFieldInput: "border-slate-300 text-slate-900",
  },
};

// Keeps the query cache from leaking data between users when the signed-in
// Clerk user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AppRoutes() {
  return (
    <Switch>
      {/* REQUIRED — "/sign-in/*?" and "/sign-up/*?" verbatim: the /*? optional
          wildcard also matches Clerk's OAuth/verification sub-paths. */}
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route>
        <ProtectedRoutes />
      </Route>
    </Switch>
  );
}

function ProtectedRoutes() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { currentUser, staffStatus, effectiveRole, retryStaff, logout } = useAuth();

  if (!isLoaded || (isSignedIn && staffStatus === "loading")) {
    return <LoginRecovery />;
  }

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  if (staffStatus === "expired" || staffStatus === "error") {
    return <LoginRecovery kind={staffStatus} retry={retryStaff} signOut={logout} />;
  }

  if (staffStatus === "nomatch" || !currentUser) {
    return <NoStaffMatch />;
  }

  return (
    <AppLayout>
      {effectiveRole === "staff" && <OfflineBanner />}
      <Switch>
        {/* Admin-only routes */}
        {effectiveRole === "admin" && (
          <>
            <Route path="/" component={Dashboard} />
            <Route path="/tasks" component={TaskManagement} />
            <Route path="/task-types" component={TaskTypes} />
            <Route path="/areas" component={AreasList} />
            <Route path="/areas/:areaId" component={AreaTasks} />
            <Route path="/assignments" component={Assignments} />
            <Route path="/staff" component={Staff} />
            <Route path="/issues" component={Issues} />
            <Route path="/report" component={InspectorReport} />
            <Route path="/gps-tracking" component={GPSTracking} />
            <Route path="/employee-portal" component={EmployeePortal} />
            <Route path="/photo-share" component={PhotoShare} />
            <Route path="/weekly-report" component={WeeklyReport} />
            <Route path="/special-requests" component={SpecialRequests} />
            <Route path="/employment" component={Employment} />
            <Route path="/messages" component={Messages} />
          </>
        )}

        {/* Supervisor routes */}
        {effectiveRole === "supervisor" && (
          <>
            <Route path="/" component={Dashboard} />
            <Route path="/tasks" component={TaskManagement} />
            <Route path="/areas" component={AreasList} />
            <Route path="/areas/:areaId" component={AreaTasks} />
            <Route path="/assignments" component={Assignments} />
            <Route path="/issues" component={Issues} />
            <Route path="/report" component={InspectorReport} />
            <Route path="/employee-portal" component={EmployeePortal} />
            <Route path="/photo-share" component={PhotoShare} />
            <Route path="/special-requests" component={SpecialRequests} />
            <Route path="/staff" component={Staff} />
            <Route path="/employment" component={Employment} />
            <Route path="/messages" component={Messages} />
          </>
        )}

        {/* Inspector routes */}
        {effectiveRole === "inspector" && (
          <>
            <Route path="/issues" component={Issues} />
            <Route path="/completed-jobs" component={CompletedJobs} />
            <Route path="/photo-share" component={PhotoShare} />
            <Route path="/special-requests" component={SpecialRequests} />
            <Route path="/"><Redirect to="/issues" /></Route>
            <Route path="/staff"><Redirect to="/issues" /></Route>
            <Route path="/assignments"><Redirect to="/issues" /></Route>
          </>
        )}

        {/* Staff routes */}
        {effectiveRole === "staff" && (
          <>
            <Route path="/my-tasks" component={MyTasks} />
            <Route path="/issues" component={Issues} />
            <Route path="/employee-portal" component={EmployeePortal} />
            <Route path="/photo-share" component={PhotoShare} />
            <Route path="/special-requests" component={SpecialRequests} />
            <Route path="/messages" component={Messages} />
            <Route path="/"><Redirect to="/my-tasks" /></Route>
            <Route path="/areas"><Redirect to="/my-tasks" /></Route>
            <Route path="/areas/:areaId"><Redirect to="/my-tasks" /></Route>
            <Route path="/assignments"><Redirect to="/my-tasks" /></Route>
            <Route path="/staff"><Redirect to="/my-tasks" /></Route>
          </>
        )}

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={basePath || "/"}
      signUpFallbackRedirectUrl={basePath || "/"}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in with your work email",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Use the email registered with your staff profile",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <OfflineProvider>
            <AuthProvider>
              <Suspense fallback={<LoginRecovery />}>
              <Switch>
                <Route path="/apply" component={Apply} />
                <Route>
                  <AppRoutes />
                </Route>
              </Switch>
              </Suspense>
            </AuthProvider>
          </OfflineProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <LoginRecovery kind="error" /> : this.props.children; }
}

function App() {
  return (
    <PageLoadBoundary>
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
    </PageLoadBoundary>
  );
}

export default App;
