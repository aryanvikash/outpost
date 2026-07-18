import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Tent, Loader2, Eye, EyeOff, AlertCircle, Server } from "lucide-react";
import { login, hasApiBase, apiBase, ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The API answers a wrong password with a bare "unauthorized", which tells an
// operator nothing about where to go looking.
function readableError(err: unknown): string {
  if (err instanceof ApiError && err.status === 401)
    return "That password didn't match. It's the ADMIN_PASSWORD secret set on your Worker.";
  if (err instanceof TypeError)
    return "Couldn't reach the control plane. Check that the Worker is deployed and the URL below is right.";
  return (err as Error).message;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  const m = useMutation({
    mutationFn: () => login(password),
    onSuccess: () => navigate({ to: "/" }),
  });

  const configured = hasApiBase();

  return (
    <div className="theme-light relative min-h-svh bg-background text-foreground">
      <main className="animate-rise-in mx-auto flex min-h-svh w-full max-w-[400px] flex-col justify-center px-6 py-12">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-foreground">
          <Tent className="h-5 w-5 text-background" />
        </span>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in to Outpost</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter the admin password for this control plane.
        </p>

        <div className="mt-7 rounded-lg border border-border bg-card px-3.5 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            Control plane
          </div>
          <p className="mt-1 truncate font-mono text-[13px]" title={apiBase()}>
            {configured ? apiBase() : "not configured"}
          </p>
        </div>

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Label
            htmlFor="pw"
            className="text-sm font-medium normal-case tracking-normal text-foreground"
          >
            Admin password
          </Label>
          <div className="relative mt-2">
            <Input
              id="pw"
              type={show ? "text" : "password"}
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={m.isError}
              aria-describedby={m.isError ? "pw-error" : undefined}
              className="h-11 bg-card pr-11 text-[15px]"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {m.isError && (
            <p
              id="pw-error"
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              {readableError(m.error)}
            </p>
          )}

          {!configured && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              VITE_API_BASE_URL isn't set — see web/.env.example.
            </p>
          )}

          <Button
            type="submit"
            disabled={m.isPending || !password || !configured}
            className="mt-4 h-11 w-full text-[15px] transition-colors duration-150"
          >
            {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {m.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </main>
    </div>
  );
}
