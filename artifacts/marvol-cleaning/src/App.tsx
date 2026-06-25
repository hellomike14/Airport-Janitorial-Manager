import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { OfflineProvider } from "./contexts/OfflineContext";
import { OfflineBanner } from "./components/OfflineBanner";
import "./i18n";

import Dashboard from "./pages/Dashboard";
import AreasList from "./pages/AreasList";
import AreaTasks from "./pages/AreaTasks";
import Staff from "./pages/Staff";
import Assignments from "./pages/Assignments";
import Issues from "./pages/Issues";
import MyTasks from "./pages/MyTasks";
import TaskManagement from "./pages/TaskManagement";
import TaskTypes from "./pages/TaskTypes";
import InspectorReport from "./pages/InspectorReport";
import CompletedJobs from "./pages/CompletedJobs";
import GPSTracking from "./pages/GPSTracking";
import EmployeePortal from "./pages/EmployeePortal";
import PhotoShare from "./pages/PhotoShare";
import WeeklyReport from "./pages/WeeklyReport";
import SpecialRequests from "./pages/SpecialRequests";
import Employment from "./pages/Employment";
import Apply from "./pages/Apply";
import Login from "./pages/Login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30,
    },
  },
});

function ProtectedRoutes() {
  const { currentUser, effectiveRole } = useAuth();

  if (!currentUser) {
    return <Login />;
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OfflineProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Switch>
                <Route path="/apply" component={Apply} />
                <Route>
                  <ProtectedRoutes />
                </Route>
              </Switch>
            </WouterRouter>
          </AuthProvider>
        </OfflineProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
