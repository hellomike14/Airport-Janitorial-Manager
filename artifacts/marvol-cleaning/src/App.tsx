import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "./components/layout/AppLayout";

// Pages
import Dashboard from "./pages/Dashboard";
import AreasList from "./pages/AreasList";
import AreaTasks from "./pages/AreaTasks";
import Staff from "./pages/Staff";
import Assignments from "./pages/Assignments";
import Issues from "./pages/Issues";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/areas" component={AreasList} />
        <Route path="/areas/:areaId" component={AreaTasks} />
        <Route path="/staff" component={Staff} />
        <Route path="/assignments" component={Assignments} />
        <Route path="/issues" component={Issues} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
