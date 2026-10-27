import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { triggers } from "@/lib/sample-data";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Automation · BrandConnect" },
      { name: "description", content: "Proactive popups and trigger rules." },
      { property: "og:title", content: "Automation · BrandConnect" },
      { property: "og:description", content: "Proactive popups and trigger rules." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Automation" desc="Proactive invitations with frequency caps and dismissal memory" action={<Btn>New trigger</Btn>} />
    <div className="space-y-3">
      {triggers.map(t => (
        <Card key={t.name} className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-56 flex-1">
            <p className="font-medium">{t.name} {!t.enabled && <Badge>Paused</Badge>}</p>
            <p className="text-xs text-muted-foreground">{t.brand}</p>
          </div>
          <div className="text-sm"><p className="text-xs text-muted-foreground">When</p>{t.when}</div>
          <div className="text-sm"><p className="text-xs text-muted-foreground">Then</p>{t.action}</div>
          <div className="text-sm"><p className="text-xs text-muted-foreground">Impressions → chats</p>{t.impressions} → {t.chats} ({(t.chats / t.impressions * 100).toFixed(1)}%)</div>
        </Card>
      ))}
    </div>
  </>);
}
