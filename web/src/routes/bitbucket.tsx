import { FolderGit2 } from "lucide-react";
import { bitbucketWebhookUrl } from "../api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BindingsCard, DeliveriesCard, CopyButton } from "@/components/webhooks";

export function BitbucketPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Bitbucket</h1>
      <WebhookCard />
      <BindingsCard />
      <DeliveriesCard />
    </div>
  );
}

function WebhookCard() {
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
