import type { ReactNode } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
  Link,
} from "@tanstack/react-router";
import { Tent, LogOut } from "lucide-react";
import { getToken, clearToken, apiBase } from "./api";
import { Button } from "@/components/ui/button";
import { LoginPage } from "./routes/login";
import { DashboardPage } from "./routes/dashboard";
import { JobPage } from "./routes/job";
import { GitHubPage } from "./routes/github";

function requireAuth() {
  if (!getToken()) throw redirect({ to: "/login" });
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      activeProps={{ className: "rounded-md px-3 py-1.5 text-sm font-medium text-foreground bg-accent" }}
      activeOptions={{ exact: to === "/" }}
    >
      {children}
    </Link>
  );
}

const rootRoute = createRootRoute({
  component: () => {
    const authed = !!getToken();
    return (
      <div className="mx-auto max-w-6xl px-6 pb-20">
        <header className="flex items-center justify-between border-b border-border/60 py-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-lg shadow-lg shadow-primary/30">
              <Tent className="h-[18px] w-[18px] text-white" />
            </span>
            <span className="leading-tight">
              <span className="block text-[17px] font-bold tracking-tight">Outpost</span>
              <span className="block text-xs text-muted-foreground/70">control plane</span>
            </span>
          </Link>
          {authed && (
            <nav className="ml-8 flex items-center gap-1">
              <NavLink to="/">Fleet</NavLink>
              <NavLink to="/github">GitHub</NavLink>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-[320px] truncate rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground sm:block">
              {apiBase() || "API URL not set"}
            </span>
            {authed && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearToken();
                  window.location.href = "/login";
                }}
              >
                <LogOut /> Sign out
              </Button>
            )}
          </div>
        </header>
        <main className="pt-8">
          <Outlet />
        </main>
      </div>
    );
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): { machine?: string } => ({
    machine: typeof s.machine === "string" ? s.machine : undefined,
  }),
  beforeLoad: requireAuth,
  component: DashboardPage,
});

const jobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/jobs/$jobId",
  beforeLoad: requireAuth,
  component: JobPage,
});

const githubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/github",
  beforeLoad: requireAuth,
  component: GitHubPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute,
  jobRoute,
  githubRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
