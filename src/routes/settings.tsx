import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
const sections = [["Organization", "Name, billing contact, default timezone"], ["Widget", "Colors, launcher position, greeting, pre-chat form (off by default)"], ["Business hours", "Weekly schedule, holidays and offline behavior"], ["Security", "Allowed embed domains, file types, data retention"], ["Notifications", "Sounds, desktop alerts, email digests"]];

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · BrandConnect" },
      { name: "description", content: "Organization, widget and security settings." },
      { property: "og:title", content: "Settings · BrandConnect" },
      { property: "og:description", content: "Organization, widget and security settings." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Settings" />
    <div className="space-y-3 max-w-3xl">
      {sections.map(([n, d]) => <Card key={n} className="flex items-center justify-between p-4"><div><p className="font-medium">{n}</p><p className="text-sm text-muted-foreground">{d}</p></div><Btn variant="outline">Edit</Btn></Card>)}
    </div>
  </>);
}
