import { useNavigate } from "@tanstack/react-router";
import { LogOut, Radio, Webhook, Link2 } from "lucide-react";
import {
  apiBase,
  connectWssUrl,
  webhookUrl,
  bitbucketWebhookUrl,
  clearToken,
} from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/webhooks";

export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connection details for this dashboard and the endpoints agents and
          providers talk to.
        </p>
      </div>

      <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5 text-primary" /> Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="API base URL" value={apiBase() || "not set"} />
          <Field label="Agent connect URL" value={connectWssUrl()} />
        </CardContent>
      </Card>

      <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Webhook className="h-5 w-5 text-primary" /> Webhook endpoints
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="GitHub" value={webhookUrl()} />
          <Field label="Bitbucket" value={bitbucketWebhookUrl()} />
        </CardContent>
      </Card>

      <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-primary" /> Session
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground/90 leading-relaxed">
            You're signed in with a short-lived admin session token stored in this
            browser.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              clearToken();
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <div className="flex items-center gap-3 p-1.5 rounded-xl border border-white/5 bg-secondary/10">
        <code className="flex-1 overflow-x-auto px-3 py-2 font-mono text-xs text-primary bg-card/25 rounded-lg border border-white/5">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
