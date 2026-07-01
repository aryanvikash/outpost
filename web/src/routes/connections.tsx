import { useState } from "react";
import { Github, FolderGit2 } from "lucide-react";
import { webhookUrl, bitbucketWebhookUrl } from "../api";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BindingsCard, CopyButton } from "@/components/webhooks";

type Provider = "github" | "bitbucket";

export function ConnectionsPage() {
  const [provider, setProvider] = useState<Provider>("github");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a git provider so a push auto-deploys to a machine. Pick your
          provider, follow the setup, then add a repository binding.
        </p>
      </div>

      {/* Provider toggle — GitHub and Bitbucket are alternative ways to do the
          same thing, so one page with a switch beats two nav items. */}
      <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1">
        <ToggleButton
          active={provider === "github"}
          onClick={() => setProvider("github")}
          icon={<Github className="h-4 w-4" />}
          label="GitHub"
        />
        <ToggleButton
          active={provider === "bitbucket"}
          onClick={() => setProvider("bitbucket")}
          icon={<FolderGit2 className="h-4 w-4" />}
          label="Bitbucket"
        />
      </div>

      {provider === "github" ? <GitHubSetup /> : <BitbucketSetup />}

      <BindingsCard />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function GitHubSetup() {
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

        <WebhookUrlField url={hook} />

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

function BitbucketSetup() {
  const hook = bitbucketWebhookUrl();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4" /> Bitbucket webhook
        </CardTitle>
        <a
          href="https://support.atlassian.com/bitbucket-cloud/docs/manage-webhooks/"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          Docs ↗
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Add a per-repo webhook to auto-deploy on push. A{" "}
          <code className="font-mono text-xs">repo:push</code> delivery is matched against the
          bindings below and runs the bound action.
        </p>

        <WebhookUrlField url={hook} />

        <ol className="space-y-1.5 text-sm text-muted-foreground">
          <li>
            <span className="text-foreground">1.</span> In Bitbucket:{" "}
            <b className="text-foreground">Repository settings → Webhooks → Add webhook</b>. Paste
            the URL above; trigger <b className="text-foreground">Repository push</b>.
          </li>
          <li>
            <span className="text-foreground">2.</span> Set a <b className="text-foreground">Secret</b>{" "}
            (a random string) on the webhook — use the same value for the Worker secret below.
          </li>
          <li>
            <span className="text-foreground">3.</span> On the Worker, set secret{" "}
            <code className="font-mono text-xs">BITBUCKET_WEBHOOK_SECRET</code> (and optionally{" "}
            <code className="font-mono text-xs">BITBUCKET_ACCESS_TOKEN</code> for build-status
            feedback):
            <code className="mt-1.5 block overflow-x-auto rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-xs">
              wrangler secret put BITBUCKET_WEBHOOK_SECRET
            </code>
          </li>
          <li>
            <span className="text-foreground">4.</span> Add a repo binding below using the{" "}
            <code className="font-mono text-xs">workspace/repo</code> slug, then push to test.
          </li>
        </ol>

        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          Build-status feedback (pass/fail posted back to the commit) requires{" "}
          <code className="font-mono">BITBUCKET_ACCESS_TOKEN</code> with{" "}
          <code className="font-mono">repository:write</code> scope. The push → deploy flow works
          without it.
        </p>
      </CardContent>
    </Card>
  );
}

function WebhookUrlField({ url }: { url: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
        Webhook URL
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-xs">
          {url}
        </code>
        <CopyButton value={url} />
      </div>
    </div>
  );
}
