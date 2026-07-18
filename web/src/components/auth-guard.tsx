// Single gate for the whole app shell.
//
// `beforeLoad: requireAuth` only fires on navigation, so a token that dies
// mid-session (expired JWT, admin password rotated) left the user staring at an
// "unauthorized" error inside a chrome they no longer had access to. This
// subscribes to the token store instead: any clearToken() — including the one
// api.ts fires on a 401 — bounces straight to /login.

import { useSyncExternalStore } from "react";
import { Navigate, useMatchRoute } from "@tanstack/react-router";
import { getToken, onAuthChange } from "../api";

export function useAuthed(): boolean {
  return useSyncExternalStore(onAuthChange, () => getToken() !== null);
}

export function AuthGuard({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const authed = useAuthed();
  const matchRoute = useMatchRoute();
  const onLogin = !!matchRoute({ to: "/login" });

  if (!authed) return onLogin ? <>{fallback}</> : <Navigate to="/login" replace />;
  if (onLogin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
