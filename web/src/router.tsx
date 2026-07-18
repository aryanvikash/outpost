import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { getToken, apiBase } from "./api";
import { AuthGuard } from "@/components/auth-guard";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LoginPage } from "./routes/login";
import { DashboardPage } from "./routes/dashboard";
import { MachineDetailPage } from "./routes/machine";
import { JobPage } from "./routes/job";
import { ConnectionsPage } from "./routes/connections";
import { WebhookLogPage } from "./routes/webhook-log";
import { TriggersPage } from "./routes/triggers";
import { AlertsPage } from "./routes/alerts";
import { SettingsPage } from "./routes/settings";

function requireAuth() {
  if (!getToken()) throw redirect({ to: "/login" });
}

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <span className="ml-auto hidden max-w-[320px] truncate rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground sm:block">
            {apiBase() || "API URL not set"}
          </span>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <AuthGuard fallback={<Outlet />}>
      <AppLayout />
    </AuthGuard>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: requireAuth,
  component: DashboardPage,
});

const machineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/machines/$machineId",
  beforeLoad: requireAuth,
  component: MachineDetailPage,
});

const jobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/jobs/$jobId",
  beforeLoad: requireAuth,
  component: JobPage,
});

const connectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connections",
  beforeLoad: requireAuth,
  component: ConnectionsPage,
});

const webhookLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/webhooks",
  beforeLoad: requireAuth,
  component: WebhookLogPage,
});

const triggersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/triggers",
  beforeLoad: requireAuth,
  component: TriggersPage,
});

const alertsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alerts",
  beforeLoad: requireAuth,
  component: AlertsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: requireAuth,
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute,
  machineRoute,
  jobRoute,
  connectionsRoute,
  webhookLogRoute,
  triggersRoute,
  alertsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
