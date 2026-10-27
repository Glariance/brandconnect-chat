import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge } from "@/components/app-shell";
const items = [["Webhooks", "Send events to your own endpoints", true], ["SMTP email", "Use your own mail server for transcripts", true], ["Google Analytics", "Optional event forwarding", false], ["Zapier-style automation", "Via outbound webhooks", false], ["CSV import", "Bring existing contacts", true], ["S3-compatible storage", "For attachments", false]] as const;

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations · BrandConnect" },
      { name: "description", content: "Connect webhooks and self-hosted tools." },
      { property: "og:title", content: "Integrations · BrandConnect" },
      { property: "og:description", content: "Connect webhooks and self-hosted tools." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Integrations" desc="All optional; nothing paid is required" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([n, d, on]) => <Card key={n} className="p-4"><div className="flex items-center justify-between"><p className="font-medium">{n}</p><Badge>{on ? "Demo configuration" : "Not configured"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{d}</p></Card>)}
    </div>
  </>);
}
