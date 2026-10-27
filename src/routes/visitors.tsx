import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { visitors } from "@/lib/sample-data";

export const Route = createFileRoute("/visitors")({
  head: () => ({
    meta: [
      { title: "Live Visitors · BrandConnect" },
      { name: "description", content: "See who is browsing each brand's site right now." },
      { property: "og:title", content: "Live Visitors · BrandConnect" },
      { property: "og:description", content: "See who is browsing each brand's site right now." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Live Visitors" desc={`${visitors.length} visitors online now`} />
    <Table head={["Visitor","Brand","Current page","Time on site","Location","Source",""]}
      rows={visitors.map(v => [<span className="font-medium">{v.label}</span>, v.brand, <code className="text-xs">{v.page}</code>, v.time, v.location, v.source, <div className="flex gap-2 justify-end">{v.returning && <Badge tone="primary">Returning</Badge>}<Btn variant="outline">Invite to chat</Btn></div>])} />
  </>);
}
