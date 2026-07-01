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

      <div className="inline-flex rounded-xl border border-white/5 bg-secondary/20 p-1.5 backdrop-blur-md">
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
        "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200",
        active
          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[1.02]"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
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
    <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between pb-6 space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Github className="h-5 w-5 text-primary" /> GitHub App
        </CardTitle>
        <div className="flex items-center gap-4 text-sm font-medium">
          <a
            href="https://github.com/settings/apps/new"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            Create App ↗
          </a>
          <a
            href="https://github.com/settings/apps"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:opacity-85 transition-opacity"
          >
            Install App ↗
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground/90 leading-relaxed">
          Install a GitHub App to auto-deploy on push — installed repos deliver{" "}
          <code className="font-mono text-xs bg-secondary/30 px-1 py-0.5 rounded text-primary">push</code> events here, no per-repo webhook needed.
        </p>

        <WebhookUrlField url={hook} />

        <ol className="space-y-3 text-sm text-muted-foreground/80 mt-4">
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">1</span>
            <div>
              Set this as the App's webhook URL; subscribe to <b className="text-foreground">Push</b> events.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">2</span>
            <div>
              Permissions: <b className="text-foreground">Commit statuses → Read &amp; write</b> (for deploy feedback).
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">3</span>
            <div>
              On the Worker, set secrets <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-secondary/30 text-primary">GITHUB_WEBHOOK_SECRET</code>, <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-secondary/30 text-primary">GITHUB_APP_ID</code>, and <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-secondary/30 text-primary">GITHUB_APP_PRIVATE_KEY</code>.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">4</span>
            <div>
              Add a repo binding below, then install the App on that repo.
            </div>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

function BitbucketSetup() {
  const hook = bitbucketWebhookUrl();
  return (
    <Card className="border-white/5 bg-card/40 backdrop-blur-xl shadow-lg rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between pb-6 space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FolderGit2 className="h-5 w-5 text-primary" /> Bitbucket webhook
        </CardTitle>
        <a
          href="https://support.atlassian.com/bitbucket-cloud/docs/manage-webhooks/"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-primary hover:opacity-85 transition-opacity"
        >
          Docs ↗
        </a>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground/90 leading-relaxed">
          Add a per-repo webhook to auto-deploy on push. A{" "}
          <code className="font-mono text-xs bg-secondary/30 px-1 py-0.5 rounded text-primary">repo:push</code> delivery is matched against the
          bindings below and runs the bound action.
        </p>

        <WebhookUrlField url={hook} />

        <ol className="space-y-3 text-sm text-muted-foreground/80 mt-4">
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">1</span>
            <div>
              In Bitbucket: <b className="text-foreground">Repository settings → Webhooks → Add webhook</b>. Paste the URL above; trigger <b className="text-foreground">Repository push</b>.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">2</span>
            <div>
              Set a <b className="text-foreground">Secret</b> (a random string) on the webhook — use the same value for the Worker secret below.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">3</span>
            <div>
              On the Worker, set secret <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-secondary/30 text-primary">BITBUCKET_WEBHOOK_SECRET</code> (and optionally <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-secondary/30 text-primary">BITBUCKET_ACCESS_TOKEN</code> for build-status feedback):
              <code className="mt-2 block overflow-x-auto rounded-xl border border-white/5 bg-secondary/20 px-3.5 py-2 font-mono text-xs text-foreground/90 leading-relaxed">
                wrangler secret put BITBUCKET_WEBHOOK_SECRET
              </code>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary border border-primary/20">4</span>
            <div>
              Add a repo binding below using the <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-secondary/30 text-primary">workspace/repo</code> slug, then push to test.
            </div>
          </li>
        </ol>

        <p className="rounded-xl border border-white/5 bg-secondary/10 px-4 py-3 text-xs text-muted-foreground/80 leading-relaxed">
          Build-status feedback (pass/fail posted back to the commit) requires{" "}
          <code className="font-mono text-[11px] text-primary">BITBUCKET_ACCESS_TOKEN</code> with{" "}
          <code className="font-mono text-[11px] text-primary">repository:write</code> scope. The push → deploy flow works
          without it.
        </p>
      </CardContent>
    </Card>
  );
}

function WebhookUrlField({ url }: { url: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
        Webhook URL
      </p>
      <div className="flex items-center gap-3 p-1.5 rounded-xl border border-white/5 bg-secondary/10">
        <code className="flex-1 overflow-x-auto px-3 py-2 font-mono text-xs text-primary bg-card/25 rounded-lg border border-white/5">
          {url}
        </code>
        <CopyButton value={url} />
      </div>
    </div>
  );
}
