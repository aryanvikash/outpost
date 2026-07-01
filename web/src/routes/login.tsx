import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Tent, Loader2 } from "lucide-react";
import { login, hasApiBase, apiBase } from "../api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");

  const m = useMutation({
    mutationFn: () => login(password),
    onSuccess: () => navigate({ to: "/" }),
  });

  return (
    <div className="grid min-h-[70vh] place-items-center">
      <Card className="w-[380px]">
        <CardContent className="p-7">
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-primary to-violet-500 shadow-lg shadow-primary/40">
            <Tent className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin password for the API.
          </p>

          <form
            className="mt-6 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
          >
            <Label htmlFor="pw">Admin password</Label>
            <Input
              id="pw"
              type="password"
              autoFocus
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {m.isError && (
              <p className="pt-1 text-sm text-red-400">{(m.error as Error).message}</p>
            )}
            {!hasApiBase() && (
              <p className="pt-1 text-sm text-red-400">
                VITE_API_BASE_URL is not set — see web/.env.example
              </p>
            )}
            <Button type="submit" className="mt-3 w-full" disabled={m.isPending || !password}>
              {m.isPending && <Loader2 className="animate-spin" />}
              {m.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-5 truncate text-center font-mono text-[11px] text-muted-foreground/70">
            {apiBase()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
