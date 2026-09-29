import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
  Link,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
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

function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-500">
      <WifiOff className="h-3.5 w-3.5" />
      You're offline — data may be stale. Actions will fail until reconnected.
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="grid place-items-center gap-3 py-20 text-center">
      <p className="text-lg font-semibold">Page not found</p>
      <p className="text-sm text-muted-foreground">The link you followed doesn't exist.</p>
      <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
        Back to machines
      </Link>
    </div>
  );
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
        <OfflineBanner />
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
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
  notFoundComponent: NotFoundPage,
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
