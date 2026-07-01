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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="API base URL" value={apiBase() || "not set"} />
          <Field label="Agent connect URL" value={connectWssUrl()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" /> Webhook endpoints
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="GitHub" value={webhookUrl()} />
          <Field label="Bitbucket" value={bitbucketWebhookUrl()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4" /> Session
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            You're signed in with a short-lived admin session token stored in this
            browser.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              clearToken();
              navigate({ to: "/login" });
            }}
          >
            <LogOut /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
