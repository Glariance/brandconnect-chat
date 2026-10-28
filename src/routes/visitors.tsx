import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Badge, Btn, Table } from "@/components/app-shell";
import { visitors } from "@/lib/sample-data";
import { isRealChatEnabled } from "@/lib/api";

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
  const real = isRealChatEnabled();
  return (<>
    <PageHeader
      title="Live Visitors"
      desc={real
        ? "Demo data — live visitor tracking is not connected to the API yet"
        : `${visitors.length} visitors online now`}
    />
    {real && (
      <p className="mb-4 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="status">
        Showing sample visitors for UI preview only. This list will use the Laravel API once visitor presence is implemented.
      </p>
    )}
    <Table head={["Visitor","Brand","Current page","Time on site","Location","Source",""]}
      rows={visitors.map(v => [<span className="font-medium">{v.label}</span>, v.brand, <code className="text-xs">{v.page}</code>, v.time, v.location, v.source, <div className="flex gap-2 justify-end">{v.returning && <Badge tone="primary">Returning</Badge>}<Btn variant="outline">Invite to chat</Btn></div>])} />
  </>);
}
