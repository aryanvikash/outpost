import { Github } from "lucide-react";
import { webhookUrl } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BindingsCard, DeliveriesCard, CopyButton } from "@/components/webhooks";

export function GitHubPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">GitHub</h1>
      <AppCard />
      <BindingsCard />
      <DeliveriesCard />
    </div>
  );
}

function AppCard() {
  const hook = webhookUrl();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-4 w-4" /> GitHub App
        </CardTitle>
        <div className="flex items-center gap-3 text-sm">
          <a
            href="https://github.com/settings/apps/new"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Create App ↗
          </a>
          <a
            href="https://github.com/settings/apps"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Install App ↗
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Install a GitHub App to auto-deploy on push — installed repos deliver{" "}
          <code className="font-mono text-xs">push</code> events here, no per-repo webhook needed.
        </p>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            Webhook URL
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-xs">
              {hook}
            </code>
            <CopyButton value={hook} />
          </div>
        </div>

        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">1.</span> Set this as the App's webhook URL; subscribe to{" "}
            <b className="text-foreground">Push</b> events.
          </li>
          <li>
            <span className="text-foreground">2.</span> Permissions:{" "}
            <b className="text-foreground">Commit statuses → Read &amp; write</b> (for deploy feedback).
          </li>
          <li>
            <span className="text-foreground">3.</span> On the Worker, set secrets{" "}
            <code className="font-mono text-xs">GITHUB_WEBHOOK_SECRET</code>,{" "}
            <code className="font-mono text-xs">GITHUB_APP_ID</code>,{" "}
            <code className="font-mono text-xs">GITHUB_APP_PRIVATE_KEY</code>.
          </li>
          <li>
            <span className="text-foreground">4.</span> Add a repo binding below, then install the App on that repo.
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
