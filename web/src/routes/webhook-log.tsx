import { DeliveriesCard } from "@/components/webhooks";

export function WebhookLogPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Webhook log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every webhook delivery from all providers, newest first. Each row is
          badged with the provider that sent it.
        </p>
      </div>
      <DeliveriesCard />
    </div>
  );
}
